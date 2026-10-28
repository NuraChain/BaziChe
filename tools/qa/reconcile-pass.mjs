/**
 * The database and NuraChain checked against each other, over the real api, the built server and a
 * local chain: disagreements made on purpose (a row changed by hand, a contract called straight from
 * a hardhat account, a contract's coin taken away), and each one recorded, raised and resolved.
 *
 *   PGDATABASE=<the server's database> QA_BASE=http://localhost:5400 QA_RPC=http://127.0.0.1:8745 \
 *   QA_SHOP=<the shop> QA_MARKETS=<the markets contract> QA_LOG=<a file holding the server's output> \
 *   node tools/qa/reconcile-pass.mjs
 *
 * The server runs built, on a database nobody else uses, with every contract tools/qa/vault-deploy.mjs
 * deployed on a NEW node (the pass moves its clock past the vault's wait at its end), NURA_REFEREE_KEY
 * the referee and ADMIN_WALLET_ADDRESS the owner's: hardhat's published #6 unless QA_OWNER_KEY names
 * another. The reconciliation pass runs once
 * a minute, so each part waits up to ninety seconds for what it should see; PGDATABASE names the
 * server's database because rows are changed by hand there.
 */
import { readFileSync } from 'node:fs';

import { createPublicClient, createWalletClient, http, toHex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { hardhat } from 'viem/chains';

import { squareNamed } from '../../backend/src/domains/match/chess/board.ts';
import { databaseName, sql } from './db.mjs';
import { tableBody } from './tables.mjs';
import { VAULT_ADMIN_KEY, marketsArtifact, shopArtifact, vaultArtifact } from './vault-deploy.mjs';
import { signInWallet } from './wallets.mjs';

const BASE = process.env.QA_BASE ?? 'http://localhost:5300';

const RPC = process.env.QA_RPC ?? 'http://127.0.0.1:8645';

const SHOP = process.env.QA_SHOP;

const MARKETS = process.env.QA_MARKETS;

const LOG = process.env.QA_LOG;

const OWNER_KEY = process.env.QA_OWNER_KEY ?? '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e';

const WEI = 10n ** 18n;

const PASS_WITHIN_MS = 90_000;

const MOVED_WITHIN_MS = 60_000;

const STAKE = (10n * WEI).toString();

let checks = 0;
let failures = 0;

const ok = (label, condition, detail = '') =>
{
    checks += 1;

    if (condition)
    {
        console.log(`  PASS  ${ label }`);
        return true;
    }

    failures += 1;
    console.log(`  FAIL  ${ label }${ detail === '' ? '' : ` — ${ detail }` }`);
    return false;
};

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const until = async (ms, look) =>
{
    const end = Date.now() + ms;

    for (;;)
    {
        const found = await look();

        if (found !== null && found !== undefined && found !== false)
        {
            return found;
        }

        if (Date.now() > end)
        {
            return null;
        }

        await pause(1000);
    }
};

const tag = () => Math.floor(Math.random() * 100000);

const said = (answer) => `${ answer.status } ${ answer.body?.error?.code ?? '' } ${ (answer.text ?? '').slice(0, 160) }`;

/** Somebody's requests, from the country the proxy would say they are in. */
const session = () =>
{
    let cookie = '';

    const call = async (method, path, body) =>
    {
        const response = await fetch(`${ BASE }/api${ path }`, {
            method,
            headers: { 'content-type': 'application/json', ...(cookie === '' ? {} : { cookie }) },
            body: body === undefined ? undefined : JSON.stringify(body)
        });

        for (const line of response.headers.getSetCookie?.() ?? [])
        {
            if (line.startsWith('nura.session=') || line.startsWith('__Host-nura.session='))
            {
                cookie = line.split(';')[0];
            }
        }

        const text = await response.text();
        let parsed = null;

        try
        {
            parsed = text === '' ? null : JSON.parse(text);
        }
        catch
        {
            parsed = null;
        }

        return { status: response.status, body: parsed, text };
    };

    return { get: (path) => call('GET', path), post: (path, body) => call('POST', path, body) };
};

const node = async (method, params = []) =>
{
    const answer = await (await fetch(RPC, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
    })).json();

    if (answer.error !== undefined)
    {
        throw new Error(`${ method }: ${ answer.error.message }`);
    }

    return answer.result;
};

const chain = { ...hardhat, rpcUrls: { default: { http: [RPC] } } };

const reader = createPublicClient({ chain, transport: http(RPC) });

const owner = createWalletClient({ account: privateKeyToAccount(VAULT_ADMIN_KEY), chain, transport: http(RPC) });

/** Somebody with a wallet the pass keeps, NURA in it, the terms of paid play and what a market is read. */
const person = async (name, account = privateKeyToAccount(generatePrivateKey())) =>
{
    const who = session();

    who.name = `${ name } ${ tag() }`;
    who.account = account;
    who.address = account.address.toLowerCase();
    who.wallet = createWalletClient({ account, chain, transport: http(RPC) });
    who.handle = (await signInWallet(who.post, who.name, account)).handle;
    await node('hardhat_setBalance', [account.address, toHex(1_000n * WEI)]);
    await who.post('/vault/terms', { adult: true });
    await who.post('/markets/disclosure');

    return who;
};

const send = async (who, call) =>
{
    const hash = await who.wallet.sendTransaction({
        to: call.to,
        data: call.data,
        value: BigInt(call.value),
        ...(call.gasPrice === undefined ? {} : { gasPrice: BigInt(call.gasPrice) })
    });

    return { hash, mined: (await reader.waitForTransactionReceipt({ hash })).status };
};

const asOwner = async (address, abi, functionName, args) =>
    reader.waitForTransactionReceipt({ hash: await owner.writeContract({ address, abi, functionName, args }) });

/** A uuid as the contracts key it: 32 bytes. */
const idOf = (uuid) => `0x${ uuid.replaceAll('-', '').toLowerCase().padStart(64, '0') }`;

/** Every disagreement the server keeps about a record, oldest first, as its owner reads them. */
const checksAbout = async (staff, record) =>
{
    const rows = [];
    let cursor;

    do
    {
        const page = await staff.get(`/admin/checks?list=all${ cursor === undefined ? '' : `&cursor=${ encodeURIComponent(cursor) }` }`);

        rows.push(...(page.body?.rows ?? []));
        cursor = page.body?.cursor;
    }
    while (cursor !== undefined);

    return rows.filter((one) => one.record === record).reverse();
};

/** Waits for the server to keep a disagreement of `kind` about a record, resolved as `how` (or open, for null). */
const recorded = (staff, record, kind, how) => until(PASS_WITHIN_MS, async () =>
{
    const found = (await checksAbout(staff, record)).find((one) => one.kind === kind && (how === null ? one.resolvedAt === undefined : one.resolution === how));

    return found ?? null;
});

/** Whether the server's own log said `event` about the record: a warning, as the reconciler says each. */
const logged = (event, record) =>
{
    if (LOG === undefined || LOG === '')
    {
        return null;
    }

    return readFileSync(LOG, 'utf8').split('\n').some((line) => line.includes(event) && line.includes(record) && /warn/i.test(line));
};

const loggedOk = (label, event, record) =>
{
    const found = logged(event, record);

    return found === null ? console.log(`  SKIP  ${ label } — QA_LOG names no file of the server's output`) : ok(label, found);
};

/** A live chess game between two people made for it, both first moves made so neither clock calls it off. */
const chessGame = async (label) =>
{
    const players = [await person(`${ label } A`), await person(`${ label } B`)];
    const table = await players[0].post('/tables/', tableBody({ game: 'chess', seats: 2, mode: 'live', privacy: 'public', clock: '10+0' }));

    await players[1].post(`/tables/${ table.body.id }/seat`);

    for (const one of players)
    {
        await one.post(`/tables/${ table.body.id }/ready`, { ready: true });
    }

    const started = await players[0].post(`/tables/${ table.body.id }/start`);
    const id = started.body.id;
    const bySeat = new Map();

    for (const one of players)
    {
        bySeat.set((await one.get(`/matches/${ id }`)).body.mine, one);
    }

    const white = bySeat.get((await players[0].get(`/matches/${ id }`)).body.view.white);
    const black = players.find((one) => one !== white);
    let keys = 0;

    const moved = async (by, from, to) =>
    {
        keys += 1;

        return by.post(`/matches/${ id }/play`, { key: `${ id }-${ keys }`, rev: (await by.get(`/matches/${ id }`)).body.rev, play: { kind: 'chess', verb: 'move', from: squareNamed(from), to: squareNamed(to) } });
    };

    await moved(white, 'e2', 'e4');
    await moved(black, 'e7', 'e5');

    return {
        id,
        players,
        resign: async () =>
        {
            keys += 1;

            return players[0].post(`/matches/${ id }/resign`, { key: `${ id }-${ keys }` });
        }
    };
};

/** A paid Ludo table at ten NURA between two people who put twenty in the vault, both Readies signed, the stakes locked. */
const paidGame = async (label) =>
{
    const players = [await person(`${ label } A`), await person(`${ label } B`)];

    for (const one of players)
    {
        const call = await one.post('/vault/deposit', { amount: (20n * WEI).toString() });

        await send(one, call.body);
    }

    const table = await players[0].post('/tables/', tableBody({ game: 'ludo', seats: 2, mode: 'live', privacy: 'public', stake: STAKE }));

    await players[1].post(`/tables/${ table.body.id }/seat`);

    for (const one of players)
    {
        const terms = await one.post(`/tables/${ table.body.id }/stake`);
        const typed = JSON.parse(terms.body.typedData);
        const signature = await one.account.signTypedData({
            domain: typed.domain,
            types: { Stake: typed.types.Stake },
            primaryType: 'Stake',
            message: { ...typed.message, amount: BigInt(typed.message.amount), deadline: BigInt(typed.message.deadline) }
        });

        await one.post(`/tables/${ table.body.id }/ready`, { ready: true, signature });
    }

    const begun = await until(MOVED_WITHIN_MS, async () =>
    {
        const seen = (await players[0].get(`/tables/${ table.body.id }`)).body;

        return seen?.matchId !== undefined && seen.money?.state === 'open' ? seen : null;
    });

    if (begun === null)
    {
        throw new Error(`the stakes of ${ label }'s table never locked`);
    }

    const escrow = sql(`select id from escrows where table_id = '${ table.body.id }' and state = 'open'`);

    return { tableId: table.body.id, matchId: begun.matchId, escrow, players };
};

/**
 * Plays whoever is on turn in a live Ludo game once their turn is nearly up: the turn sweep forfeits a
 * seat after three misses in a row, which would end, and pay out, a game the pass needs still played
 * minutes later. Answers how to stop.
 */
const keepGoing = (game) =>
{
    const byHandle = new Map(game.players.map((who) => [who.handle, who]));
    let stopped = false;
    let plays = 0;

    const keep = async () =>
    {
        while (!stopped)
        {
            const seen = (await game.players[0].get(`/matches/${ game.matchId }`)).body;

            if (seen === null || seen.finishedAt !== undefined)
            {
                return;
            }

            const actor = byHandle.get(seen.players.find((row) => row.seat === seen.turn)?.who);

            if (actor !== undefined && (seen.remainingMs ?? 0) < 12_000)
            {
                const own = (await actor.get(`/matches/${ game.matchId }`)).body;
                const play = own.view.die === undefined ? { kind: 'ludo', verb: 'roll' } : { kind: 'ludo', verb: 'move', piece: own.view.moves[0] };

                plays += 1;
                await actor.post(`/matches/${ game.matchId }/play`, { key: `keep-${ plays }-${ game.matchId.slice(0, 8) }`, rev: own.rev, play });
            }

            await pause(2000);
        }
    };

    const running = keep().catch((error) => console.log(`        the game stopped being kept going: ${ error.message }`));

    return async () =>
    {
        stopped = true;
        await running;
    };
};

const stateOf = (table, id) => sql(`select state from ${ table } where id = '${ id }'`);

async function main()
{
    if (SHOP === undefined || SHOP === '' || MARKETS === undefined || MARKETS === '')
    {
        throw new Error('QA_SHOP and QA_MARKETS name the contracts tools/qa/vault-deploy.mjs deployed, as the server was started with them');
    }

    const began = Date.now();

    console.log(`the reconcile pass, against ${ BASE } on ${ databaseName() }`);
    await node('evm_setIntervalMining', [1000]);

    const staff = await person('Owner', privateKeyToAccount(OWNER_KEY));
    const account = (await staff.get('/auth/me')).body?.account;

    if (account?.staff !== 'owner')
    {
        throw new Error(`the server does not name ${ staff.address } as its owner: start it with ADMIN_WALLET_ADDRESS set to it, or hand QA_OWNER_KEY the key of the one it names`);
    }

    const moderator = await person('Moderator');

    await staff.post('/admin/staff', { handle: moderator.handle, role: 'moderator', reason: 'Watches the tables at night' });

    const vault = (await staff.get('/vault')).body?.vault;

    console.log('\nthe records the money moves through');

    const buyer = await person('Buyer');
    const kept1 = await buyer.post('/shop/orders', { item: 'dice.glow' });
    const kept2 = await buyer.post('/shop/orders', { item: 'back.glow' });

    for (const made of [kept1, kept2])
    {
        const sent = await send(buyer, made.body.call);

        await buyer.post(`/shop/orders/${ made.body.order.id }/sent`, { hash: sent.hash });
    }

    const refunded = kept1.body.order.id;
    const lapsed = kept2.body.order.id;
    const delivered = await until(MOVED_WITHIN_MS, () => stateOf('shop_orders', refunded) === 'paid' && stateOf('shop_orders', lapsed) === 'paid');

    ok('two looks are bought and delivered', delivered === true);

    const host = await person('Host');
    const guest = await person('Guest');
    const watcher = await person('Watcher');
    const opened = await host.post('/tables/quick', { game: 'ludo', seats: 2, mode: 'turns', voice: 'off' });

    await guest.post('/tables/quick', { game: 'ludo', seats: 2, mode: 'turns', voice: 'off' });

    const match = await until(10_000, async () => (await host.get(`/tables/${ opened.body?.id }`)).body?.matchId ?? null);
    const given = await watcher.post('/donations', { match, to: host.handle, amount: (5n * WEI).toString() });
    const gift = await send(watcher, given.body.call);

    await watcher.post(`/donations/${ given.body.donation.id }/sent`, { hash: gift.hash });

    const prepared = await watcher.post('/donations', { match, to: guest.handle, amount: (3n * WEI).toString() });
    const late = given.body.donation.id;
    const ghost = prepared.body.donation.id;

    ok('a gift is given, and another written and never sent', await until(MOVED_WITHIN_MS, () => stateOf('donations', late) === 'confirmed') === true && stateOf('donations', ghost) === 'prepared');

    const paid = await paidGame('Paid');

    await paid.players[0].post(`/matches/${ paid.matchId }/resign`, { key: `resign-${ tag() }` });
    ok('a game played for NURA is paid out', await until(MOVED_WITHIN_MS, () => stateOf('escrows', paid.escrow) === 'settled') === true);

    const playing = await paidGame('Reclaimed');
    const letGo = keepGoing(playing);

    ok('another is locked and being played', stateOf('escrows', playing.escrow) === 'open');

    const early = await chessGame('Early');
    const bettor = await person('Bettor');
    const market = (await bettor.get(`/markets/matches/${ early.id }`)).body?.market;
    const placing = await bettor.post(`/markets/${ market?.id }/positions`, { outcome: 0, amount: (5n * WEI).toString() });
    const placed = await send(bettor, placing.body.call);
    const position = placing.body.position.id;

    await bettor.post(`/markets/positions/${ position }/sent`, { hash: placed.hash });
    await until(MOVED_WITHIN_MS, () => stateOf('market_positions', position) === 'confirmed');
    await early.resign();

    ok('a market whose game ended inside its window is called off, its stake back to claim', await until(MOVED_WITHIN_MS, () => stateOf('markets', market.id) === 'cancelled') === true);

    console.log('\nthe two sides made to disagree');

    const shopAbi = shopArtifact().abi;
    const marketsAbi = marketsArtifact().abi;
    const vaultAbi = vaultArtifact().abi;
    const shopCoin = await reader.getBalance({ address: SHOP });

    await asOwner(SHOP, shopAbi, 'refund', [idOf(refunded)]);
    sql(`update shop_orders set state = 'expired', paid_at = null, delivered = null where id = '${ lapsed }'; delete from owned_items where order_id = '${ lapsed }'`);
    sql(`update donations set state = 'expired', confirmed_at = null where id = '${ late }'`);
    sql(`update donations set state = 'confirmed', confirmed_at = now() where id = '${ ghost }'`);

    const winners = Number(sql(`select winners from escrows where id = '${ paid.escrow }'`));

    sql(`update escrows set winners = ${ winners === 1 ? 2 : 1 } where id = '${ paid.escrow }'`);
    sql(`update markets set state = 'expired' where id = '${ market.id }'`);
    await bettor.wallet.writeContract({ address: MARKETS, abi: marketsAbi, functionName: 'claim', args: [[idOf(position)]] });
    await node('hardhat_setBalance', [SHOP, '0x0']);

    console.log('\nrecorded, put right or kept for a person');

    const refund = await recorded(staff, refunded, 'order-state', null);

    ok('a look the owner refunded on the shop is kept for a person: delivered here, refunded there', refund?.db?.state === 'paid' && refund?.chain?.state === 'refunded', JSON.stringify(refund));

    const putOrder = await recorded(staff, lapsed, 'order-state', 'put-right');

    ok('an order the shop sold that ran out here is delivered again through the shop worker, and kept as put right', putOrder !== null && stateOf('shop_orders', lapsed) === 'paid' && sql(`select count(*) from owned_items where order_id = '${ lapsed }'`) === '1', JSON.stringify(putOrder));

    const putGift = await recorded(staff, late, 'donation-state', 'put-right');

    ok('a gift the contract holds as it was prepared is confirmed again through the donation worker', putGift !== null && stateOf('donations', late) === 'confirmed');

    const counted = await recorded(staff, ghost, 'donation-state', null);

    ok('a gift counted here that the contract does not hold is kept for a person', counted?.db?.state === 'confirmed' && counted?.chain?.state === 'none', JSON.stringify(counted));

    const seats = await recorded(staff, paid.escrow, 'escrow-winners', null);

    ok('a payment written here to seats the vault did not pay is kept for a person, read off its receipt', seats !== null && seats.db.seats !== seats.chain.seats, JSON.stringify(seats));

    const expired = await recorded(staff, market.id, 'market-state', null);

    ok('a market written here in a state the contract does not hold is kept for a person', expired?.db?.state === 'expired' && expired?.chain?.state === 'cancelled', JSON.stringify(expired));

    const claimed = await recorded(staff, position, 'position-claim', 'put-right');
    const claimedRow = sql(`select claimed_at is not null, paid::text from market_positions where id = '${ position }'`);

    ok('a stake back claimed straight from the wallet is written down as claimed, at its stake', claimed !== null && claimedRow === `t|${ 5n * WEI }`, claimedRow);

    const books = await recorded(staff, 'shop', 'solvency', null);

    ok('a shop whose coin was taken away is kept for a person, with what it holds and owes', books !== null && books.chain.held === '0' && BigInt(books.chain.owed) > 0n, JSON.stringify(books));

    const overview = (await staff.get('/admin/overview')).body;
    const open = (await staff.get('/admin/checks')).body;

    ok('the overview counts the open ones for the owner, as the list does', overview?.checks === open?.open && open.open >= 5, `${ overview?.checks } ${ open?.open }`);
    ok('a moderator is shown no count, and the list is a page that is not there', (await moderator.get('/admin/overview')).body?.checks === undefined && (await moderator.get('/admin/checks')).status === 404);
    loggedOk('the server said each as a warning when it found it', 'chain and database disagree', refunded);
    loggedOk('and when it put one right', 'chain and database agree again', lapsed);

    console.log('\nresolved');

    const closing = await staff.post(`/admin/checks/${ refund.id }/close`, { reason: 'The owner refunded it on purpose' });

    ok('the owner closes the refund with a reason', closing.status === 200 && closing.body?.check?.resolution === 'staff', said(closing));

    const logRow = (await staff.get('/admin/log?kind=check')).body?.rows?.[0];

    ok('and the staff\'s log says who closed which, and why', logRow?.details?.check === refund.id && logRow?.reason === 'The owner refunded it on purpose');
    ok('closing it again is refused in its own word', (await staff.post(`/admin/checks/${ refund.id }/close`, { reason: 'Again' })).body?.error?.code === 'staff-check-closed');

    const closedSaid = logged('chain and database disagreement closed', refunded);

    if (closedSaid === null)
    {
        console.log('  SKIP  the server said the close as a line of its own — QA_LOG names no file of the server\'s output');
    }
    else
    {
        ok('the server said the close as a line of its own, and never that the two agree again', closedSaid && !logged('chain and database agree again', refunded));
    }

    sql(`update donations set state = 'expired', confirmed_at = null where id = '${ ghost }'`);
    sql(`update escrows set winners = ${ winners } where id = '${ paid.escrow }'`);
    sql(`update markets set state = 'cancelled' where id = '${ market.id }'`);
    await node('hardhat_setBalance', [SHOP, toHex(shopCoin)]);

    ok('a gift mended by hand agrees again', await recorded(staff, ghost, 'donation-state', 'agreed') !== null);
    ok('a payment mended by hand agrees again', await recorded(staff, paid.escrow, 'escrow-winners', 'agreed') !== null);
    ok('a market mended by hand agrees again', await recorded(staff, market.id, 'market-state', 'agreed') !== null);
    ok('the shop given its coin back agrees again', await recorded(staff, 'shop', 'solvency', 'agreed') !== null);
    loggedOk('the server said each as a warning when it agreed again', 'chain and database agree again', ghost);

    const checkedAt = (await staff.get('/admin/checks')).body?.checkedAt;

    await until(PASS_WITHIN_MS, async () => (await staff.get('/admin/checks')).body?.checkedAt !== checkedAt);

    const still = await checksAbout(staff, refunded);

    ok('the refund a person closed stays closed while the two sides say what they said', still.length === 1 && still[0].resolution === 'staff', JSON.stringify(still));

    console.log('\na game\'s stakes taken back on the chain while it is played here');

    const wait = (await staff.get('/vault')).body?.reclaimAfter ?? 259_200;

    await node('evm_increaseTime', [wait + 60]);
    await node('evm_mine');

    const call = await playing.players[0].post('/vault/reclaim', { id: playing.escrow });
    const taken = call.status === 200 ? await send(playing.players[0], call.body) : null;

    ok('a player takes the stakes back once the vault\'s wait has passed', taken?.mined === 'success', said(call));

    const back = await recorded(staff, playing.escrow, 'escrow-state', null);

    ok('a game the vault holds as taken back while it is played here is kept for a person', back?.db?.state === 'open' && back?.chain?.state === 'reclaimed', JSON.stringify(back));

    await letGo();
    await playing.players[0].post(`/matches/${ playing.matchId }/resign`, { key: `resign-${ tag() }` });

    ok('once the game ends the stake worker finds the stakes taken back', await until(MOVED_WITHIN_MS, () => stateOf('escrows', playing.escrow) === 'reclaimed') === true);
    ok('and the next pass finds the two agree', await recorded(staff, playing.escrow, 'escrow-state', 'agreed') !== null);

    const vaultSolvent = await reader.readContract({ address: vault, abi: vaultAbi, functionName: 'solvent' });

    ok('the vault holds what it owes at the end', vaultSolvent === true);

    const took = `${ Math.round((Date.now() - began) / 1000) } s`;

    console.log(failures === 0 ? `\nreconcile pass: clean, ${ checks } checks in ${ took }` : `\nreconcile pass: ${ failures } of ${ checks } FAILED in ${ took }`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) =>
{
    console.error(error);
    process.exit(1);
});
