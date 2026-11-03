import { HttpError } from '@azerothjs/http';
import type { DataSource } from 'typeorm';
import { getAddress, type Address, type Hex } from 'viem';

import { isSignature, type ForwardRequest, type ProfileSponsor } from '../../chain/sponsor.ts';
import type { ProfileSponsorAsk } from '../../schemas.ts';

/** The writes to their profile the server pays for one account in a day (UTC). */
export const SPONSORED_A_DAY = 3;

/**
 * The writes it pays for everybody together in a day. Making an account costs nothing, so without
 * this a person with many of them could empty the sponsor's wallet three writes at a time.
 */
export const SPONSORED_ALL_A_DAY = 300;

/** The most gas one write may ask for, and so the most one write can cost the sponsor. */
export const SPONSOR_GAS_MOST = 3_000_000n;

/** How long a request stays good to sign and send, in seconds. */
export const SPONSOR_WINDOW_SECONDS = 600;

export const SPONSOR_REFUSALS = {
    'sponsor-off': 404,
    'sponsor-nothing': 404,
    'sponsor-pays': 409,
    'sponsor-limit': 409,
    'sponsor-request': 422,
    'sponsor-signature': 422,
    'sponsor-refused': 409
} as const satisfies Record<string, 404 | 409 | 422>;

export type SponsorRefusal = keyof typeof SPONSOR_REFUSALS;

const refused = (word: SponsorRefusal, message: string) => new HttpError(SPONSOR_REFUSALS[word], message, { code: word, expose: true });

/** The write a person's profile needs now, built by the server from what it holds of them, never from what anybody sends. */
export type CallFor = (userId: string) => Promise<{ owner: Address; to: Address; data: Hex } | null>;

export interface SponsorInput
{
    gas: string;
    deadline: number;
    signature: string;
}

const today = `(now() at time zone 'utc')::date`;

/**
 * The server paying the gas of a write to somebody's Nura Profile, when their wallet cannot.
 *
 * The request they sign is the server's own: from their own wallet, to the registry, carrying no
 * NURA, the very write `publish` would hand their wallet, with the gas it takes and a deadline. On
 * the way back only the gas, the deadline and the signature are taken from them; the rest is built
 * again, so a signature over anything else fails the forwarder's `verify` and costs nothing.
 *
 * Paid only for somebody whose wallet holds less than the write costs, at most `SPONSORED_A_DAY`
 * times a day each and `SPONSORED_ALL_A_DAY` for everybody. Counted, checked and sent under one
 * lock, so two at once can neither pass the limits together nor send from the key with one nonce:
 * a send that fails takes its count back with it.
 */
export function createProfileSponsorship(db: DataSource, sponsor: ProfileSponsor, callFor: CallFor)
{
    const nowSeconds = () => Math.floor(Date.now() / 1000);

    const asked = async (userId: string) =>
    {
        if (!sponsor.configured)
        {
            throw refused('sponsor-off', 'The server pays for no profile.');
        }

        const call = await callFor(userId);

        if (call === null)
        {
            throw refused('sponsor-nothing', 'There is nothing to write to your profile.');
        }

        return call;
    };

    const paysItself = async (owner: Address, gas: bigint) =>
        await sponsor.balanceOf(owner) >= gas * await sponsor.gasPrice();

    /** The gas the server names for a write: what the chain says it takes, and a margin. */
    const gasFor = async (call: { owner: Address; data: Hex }) => await sponsor.estimate(call.owner, call.data) * 6n / 5n + 25_000n;

    const used = async (runner: Pick<DataSource, 'query'>, userId: string) =>
    {
        const [row] = await runner.query(
            `select coalesce((select count from profile_sponsorships where user_id = $1 and day = ${ today }), 0)::int as mine,
                    coalesce((select sum(count) from profile_sponsorships where day = ${ today }), 0)::int as everybody`,
            [userId]
        ) as { mine: number; everybody: number }[];

        return row.mine >= SPONSORED_A_DAY || row.everybody >= SPONSORED_ALL_A_DAY;
    };

    return {
        async ask(userId: string): Promise<ProfileSponsorAsk>
        {
            if (!sponsor.configured)
            {
                return { sponsored: false, why: 'off' };
            }

            const call = await asked(userId);
            const gas = await gasFor(call);

            if (gas > SPONSOR_GAS_MOST)
            {
                return { sponsored: false, why: 'heavy' };
            }

            if (await paysItself(call.owner, gas))
            {
                return { sponsored: false, why: 'pays' };
            }

            if (await used(db, userId))
            {
                return { sponsored: false, why: 'limit' };
            }

            const deadline = nowSeconds() + SPONSOR_WINDOW_SECONDS;
            const typedData = await sponsor.typedData({ from: call.owner, to: call.to, gas, nonce: await sponsor.nonceOf(call.owner), deadline, data: call.data });

            return { sponsored: true, typedData, gas: gas.toString(), deadline };
        },

        async send(userId: string, input: SponsorInput)
        {
            const gas = /^\d{1,10}$/.test(input.gas) ? BigInt(input.gas) : 0n;
            const now = nowSeconds();

            if (gas === 0n || gas > SPONSOR_GAS_MOST || !Number.isInteger(input.deadline) || input.deadline <= now || input.deadline > now + SPONSOR_WINDOW_SECONDS || !isSignature(input.signature))
            {
                throw refused('sponsor-request', 'That is not a request the server made.');
            }

            const call = await asked(userId);
            const needed = await gasFor(call);

            // Judged on the gas the server names, never on what came back: a wallet that can pay
            // for the write must not buy the server's payment by signing for far more gas.
            if (gas > needed * 2n)
            {
                throw refused('sponsor-request', 'That is not a request the server made.');
            }

            if (await paysItself(call.owner, needed))
            {
                throw refused('sponsor-pays', 'Your wallet can pay for this itself.');
            }

            const request: ForwardRequest = { from: getAddress(call.owner), to: call.to, gas, nonce: await sponsor.nonceOf(call.owner), deadline: input.deadline, data: call.data };
            const signature = input.signature;

            return await db.transaction(async (tx) =>
            {
                // `pg_advisory_xact_lock`: one write paid for at a time, everywhere, until this one is sent.
                await tx.query(`select pg_advisory_xact_lock(hashtext('baziche:profile-sponsor'))`);

                if (await used(tx, userId))
                {
                    throw refused('sponsor-limit', 'The server has paid for as many of these as it does today.');
                }

                // `ON CONFLICT DO UPDATE SET count = count + 1`: the day's first write makes its row.
                await tx.query(
                    `insert into profile_sponsorships (user_id, day, count) values ($1, ${ today }, 1)
                     on conflict (user_id, day) do update set count = profile_sponsorships.count + 1`,
                    [userId]
                );

                const relayed = await sponsor.relay(request, signature);

                if (!relayed.ok)
                {
                    throw relayed.refusal === 'signature'
                        ? refused('sponsor-signature', 'That signature is not over this write.')
                        : refused('sponsor-refused', 'Your profile would refuse this write.');
                }

                return { hash: relayed.hash };
            });
        }
    };
}
