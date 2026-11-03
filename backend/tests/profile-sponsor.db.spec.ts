import 'reflect-metadata';

import { HttpError, errorResponse } from '@azerothjs/http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import type { Address, Hex } from 'viem';

import type { ForwardRequest, ProfileSponsor, Relayed } from '../src/chain/sponsor.ts';
import { entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { createProfileSponsorship, SPONSOR_GAS_MOST, SPONSOR_WINDOW_SECONDS, SPONSORED_A_DAY, SPONSORED_ALL_A_DAY, type CallFor } from '../src/domains/identity/sponsor.ts';
import { rowsOf } from '../src/lib/rows.ts';

/**
 * The server paying a profile's gas, against a real Postgres and a sponsor that answers as told:
 * who it pays for, the request it has them sign, what it takes back from them, and the limits it
 * counts under one lock, a refused send taking its count back with it.
 */

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

const OWNER: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const REGISTRY: Address = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const DATA: Hex = '0xb6b3a5c1';
const SIGNATURE: Hex = `0x${ '11'.repeat(65) }`;
const HASH: Hex = `0x${ 'ab'.repeat(32) }`;

let db: DataSource;
let seq = 0;

const fakeSponsor = () =>
{
    const relayed: { request: ForwardRequest; signature: Hex }[] = [];
    const state = { configured: true, balance: 0n, price: 1_000_000_000n, estimate: 200_000n, nonce: 7n, relay: 'ok' as 'ok' | Exclude<Relayed, { ok: true }>['refusal'], slow: 0 };
    const sponsor: ProfileSponsor = {
        get configured()
        {
            return state.configured;
        },
        address: '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720',
        balanceOf: async () => state.balance,
        gasPrice: async () => state.price,
        estimate: async () => state.estimate,
        nonceOf: async () => state.nonce,
        typedData: async (request) => JSON.stringify({ ...request, gas: request.gas.toString(), nonce: request.nonce.toString() }),
        async relay(request, signature)
        {
            await new Promise((resolve) => setTimeout(resolve, state.slow));
            relayed.push({ request, signature });
            return state.relay === 'ok' ? { ok: true, hash: HASH } : { ok: false, refusal: state.relay };
        }
    };

    return { sponsor, state, relayed };
};

const writing: CallFor = async () => ({ owner: OWNER, to: REGISTRY, data: DATA });

const makeUser = async () =>
{
    seq += 1;
    return rowsOf<{ id: string }>(await db.query(`insert into users (handle, display_name, hue) values ($1, 'Sponsored', 1) returning id`, [`sp${ seq }x${ Math.floor(Math.random() * 100000) }`]))[0].id;
};

const word = async (work: Promise<unknown>) =>
{
    const thrown = await work.then(() => null, (error: unknown) => error);

    if (!(thrown instanceof HttpError))
    {
        return thrown === null ? null : String(thrown);
    }

    const response = errorResponse(thrown);
    const body = await response.json() as { error: { code: string } };

    return `${ response.status } ${ body.error.code }`;
};

const counted = async (userId: string) =>
    rowsOf<{ n: number }>(await db.query(`select coalesce(sum(count), 0)::int as n from profile_sponsorships where user_id = $1`, [userId]))[0].n;

const good = () => ({ gas: '265000', deadline: Math.floor(Date.now() / 1000) + 300, signature: SIGNATURE });

describe.skipIf(!active)('the server paying a profile\'s gas, against a real database', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: ['error'] });
        await db.initialize();
        await syncSchema(db);
    }, 60_000);

    beforeEach(async () =>
    {
        await db.query('delete from profile_sponsorships');
        await db.query('delete from users');
    });

    afterAll(async () =>
    {
        if (db?.isInitialized)
        {
            await db.destroy();
        }
    });

    it('asks somebody whose wallet cannot pay to sign the server\'s own request: their write, to the registry, with the gas it takes and a deadline', async () =>
    {
        const { sponsor } = fakeSponsor();
        const me = await makeUser();
        const before = Math.floor(Date.now() / 1000);
        const asked = await createProfileSponsorship(db, sponsor, writing).ask(me);

        expect(asked).toMatchObject({ sponsored: true, gas: (200_000n * 6n / 5n + 25_000n).toString() });

        const deadline = asked.sponsored ? asked.deadline : 0;

        expect(deadline).toBeGreaterThanOrEqual(before + SPONSOR_WINDOW_SECONDS);
        expect(deadline).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + SPONSOR_WINDOW_SECONDS);
        expect(JSON.parse(asked.sponsored ? asked.typedData : '{}')).toEqual({ from: OWNER, to: REGISTRY, gas: '265000', nonce: '7', deadline, data: DATA });
    });

    it('pays for nobody while it is not set up, for nobody whose wallet can pay, and for no write heavier than it pays for', async () =>
    {
        const { sponsor, state } = fakeSponsor();
        const me = await makeUser();
        const sponsorship = createProfileSponsorship(db, sponsor, writing);

        state.balance = 265_000n * state.price;
        expect(await sponsorship.ask(me)).toEqual({ sponsored: false, why: 'pays' });
        expect(await word(sponsorship.send(me, good()))).toBe('409 sponsor-pays');
        expect(await word(sponsorship.send(me, { ...good(), gas: '520000' })), 'a wallet that can pay signed for more gas than it holds').toBe('409 sponsor-pays');
        expect(await word(sponsorship.send(me, { ...good(), gas: '531000' })), 'signed for more than twice the gas the write takes').toBe('422 sponsor-request');

        state.balance = 0n;
        state.estimate = SPONSOR_GAS_MOST;
        expect(await sponsorship.ask(me)).toEqual({ sponsored: false, why: 'heavy' });

        state.configured = false;
        expect(await sponsorship.ask(me)).toEqual({ sponsored: false, why: 'off' });
        expect(await word(sponsorship.send(me, good()))).toBe('404 sponsor-off');
        expect(await word(createProfileSponsorship(db, fakeSponsor().sponsor, async () => null).ask(me)), 'somebody with nothing to write').toBe('404 sponsor-nothing');
        expect(await counted(me)).toBe(0);
    });

    it('sends the write it builds itself, with only the gas, the deadline and the signature taken from the request, and counts it', async () =>
    {
        const { sponsor, relayed } = fakeSponsor();
        const me = await makeUser();
        const input = good();

        expect(await createProfileSponsorship(db, sponsor, writing).send(me, input)).toEqual({ hash: HASH });
        expect(relayed).toEqual([{ request: { from: OWNER, to: REGISTRY, gas: 265_000n, nonce: 7n, deadline: input.deadline, data: DATA }, signature: SIGNATURE }]);
        expect(await counted(me)).toBe(1);
    });

    it('takes nothing that is not a request it made: no gas, too much, a deadline gone or too far, a signature that is none', async () =>
    {
        const { sponsor, relayed } = fakeSponsor();
        const me = await makeUser();
        const sponsorship = createProfileSponsorship(db, sponsor, writing);
        const now = Math.floor(Date.now() / 1000);

        for (const bad of [
            { ...good(), gas: '0' },
            { ...good(), gas: (SPONSOR_GAS_MOST + 1n).toString() },
            { ...good(), gas: '1e6' },
            { ...good(), deadline: now - 1 },
            { ...good(), deadline: now + SPONSOR_WINDOW_SECONDS + 60 },
            { ...good(), signature: `0x${ '11'.repeat(64) }zz` }
        ])
        {
            expect(await word(sponsorship.send(me, bad)), JSON.stringify(bad)).toBe('422 sponsor-request');
        }

        expect(relayed).toEqual([]);
        expect(await counted(me)).toBe(0);
    });

    it(`pays for ${ SPONSORED_A_DAY } writes a day for each account and no more, and says so before it asks for a signature`, async () =>
    {
        const { sponsor, relayed } = fakeSponsor();
        const me = await makeUser();
        const other = await makeUser();
        const sponsorship = createProfileSponsorship(db, sponsor, writing);

        for (let at = 0; at < SPONSORED_A_DAY; at += 1)
        {
            await sponsorship.send(me, good());
        }

        expect(await word(sponsorship.send(me, good()))).toBe('409 sponsor-limit');
        expect(await sponsorship.ask(me)).toEqual({ sponsored: false, why: 'limit' });
        expect(relayed).toHaveLength(SPONSORED_A_DAY);
        expect(await counted(me)).toBe(SPONSORED_A_DAY);
        expect(await sponsorship.ask(other), 'one account\'s limit was another\'s').toMatchObject({ sponsored: true });

        await db.query(`update profile_sponsorships set day = day - 1 where user_id = $1`, [me]);
        expect(await sponsorship.ask(me), 'yesterday\'s writes counted today').toMatchObject({ sponsored: true });
    });

    it(`pays for ${ SPONSORED_ALL_A_DAY } writes a day for everybody together, so many accounts cannot empty its wallet`, async () =>
    {
        const { sponsor, relayed } = fakeSponsor();
        const crowd = await Promise.all(Array.from({ length: SPONSORED_ALL_A_DAY / 3 }, () => makeUser()));
        const me = await makeUser();

        for (const one of crowd)
        {
            await db.query(`insert into profile_sponsorships (user_id, day, count) values ($1, (now() at time zone 'utc')::date, 3)`, [one]);
        }

        expect(await createProfileSponsorship(db, sponsor, writing).ask(me)).toEqual({ sponsored: false, why: 'limit' });
        expect(await word(createProfileSponsorship(db, sponsor, writing).send(me, good()))).toBe('409 sponsor-limit');
        expect(relayed).toEqual([]);
    }, 60_000);

    it('takes its count back for a signature that is not over the write, or a write the profile would refuse', async () =>
    {
        const { sponsor, state } = fakeSponsor();
        const me = await makeUser();
        const sponsorship = createProfileSponsorship(db, sponsor, writing);

        state.relay = 'signature';
        expect(await word(sponsorship.send(me, good()))).toBe('422 sponsor-signature');

        state.relay = 'reverted';
        expect(await word(sponsorship.send(me, good()))).toBe('409 sponsor-refused');

        expect(await counted(me)).toBe(0);
    });

    it('pays for no more than its limit when the same account sends many at once', async () =>
    {
        const { sponsor, state, relayed } = fakeSponsor();
        const me = await makeUser();
        const sponsorship = createProfileSponsorship(db, sponsor, writing);

        state.slow = 50;

        const outcomes = await Promise.all(Array.from({ length: SPONSORED_A_DAY + 3 }, () => word(sponsorship.send(me, good()))));

        expect(outcomes.filter((one) => one === null)).toHaveLength(SPONSORED_A_DAY);
        expect(outcomes.filter((one) => one === '409 sponsor-limit')).toHaveLength(3);
        expect(relayed).toHaveLength(SPONSORED_A_DAY);
        expect(await counted(me)).toBe(SPONSORED_A_DAY);
    }, 60_000);
});
