/**
 * Markets over the real api, the built server and a local chain: people watching live games back
 * their outcomes with NURA in `ArcadeMarkets`, each placing a ticket the server signed from their
 * own wallet, and the server settles or calls off each market from its game's result. Every stake,
 * share and refund is read back from the contract and from the wallets.
 *
 *   QA_BASE=http://localhost:5300 QA_MARKETS=<the markets contract> node tools/qa/market-pass.mjs
 *
 * The server runs built, on a database nobody else uses, with NURA_RPC_URL, NURA_CHAIN_ID=31337,
 * NURA_VAULT_ADDRESS and NURA_REFEREE_KEY (the referee `vault-deploy.mjs` made the markets'
 * operator) and NURA_MARKETS_ADDRESS. QA_RPC
 * is the node, and a new one each run: hardhat gives every block a second of its own, so a few runs
 * put its clock ahead of this machine's by more than a market's window. Four chess games are opened
 * together, so the ninety seconds each market takes positions for, and the minute of its dispute
 * window, are waited out once for all of them.
 */
import { createPublicClient, createWalletClient, http, toHex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { hardhat } from 'viem/chains';

import { MARKET_REFUSALS } from '../../backend/src/domains/market/refusals.ts';
import { squareNamed } from '../../backend/src/domains/match/chess/board.ts';
import { tableBody } from './tables.mjs';
import { VAULT_ADMIN_KEY, marketsArtifact } from './vault-deploy.mjs';
import { signInWallet } from './wallets.mjs';

const BASE = process.env.QA_BASE ?? 'http://localhost:5300';

const RPC = process.env.QA_RPC ?? 'http://127.0.0.1:8645';

const MARKETS = process.env.QA_MARKETS;

const WEI = 10n ** 18n;

const CONFIRMED_WITHIN_MS = 20_000;

const RESOLVED_WITHIN_MS = 30_000;

const ABI = marketsArtifact().abi;

let checks = 0;
let failures = 0;

const ok = (label, condition, detail = '') =>
{
    checks += 1;

    if (condition)
    {
        console.log(`  PASS  ${ label }${ detail === '' || detail.length > 100 ? '' : ` — ${ detail }` }`);
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

        await pause(300);
    }
};

const tag = () => Math.floor(Math.random() * 100000);

const said = (answer) => `${ answer.status } ${ answer.body?.error?.code ?? '' } ${ (answer.text ?? '').slice(0, 160) }`;

const refusedAs = (label, answer, word) =>
    ok(label, answer.status === MARKET_REFUSALS[word] && answer.body?.error?.code === word, said(answer));

/** A position's or a market's id as the contract keys it: its uuid as 32 bytes. */
const idOf = (uuid) => `0x${ uuid.replaceAll('-', '').toLowerCase().padStart(64, '0') }`;

/** Somebody's requests, with their session's cookie. */
const session = () =>
{
    let cookie = '';

    const call = async (method, path, body) =>
    {
        const response = await fetch(`${ BASE }/api${ path }`, {
            method,
            headers: {
                'content-type': 'application/json',
                ...(cookie === '' ? {} : { cookie })
            },
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

    return {
        get: (path) => call('GET', path),
        post: (path, body) => call('POST', path, body)
    };
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

const read = (functionName, args = []) => reader.readContract({ address: MARKETS, abi: ABI, functionName, args });

const balance = (address) => reader.getBalance({ address });

/** Somebody with a wallet the pass keeps, NURA in it, the terms of paid play and what a market is read, unless asked otherwise. */
const person = async (name, options = {}) =>
{
    const who = session();
    const account = privateKeyToAccount(generatePrivateKey());

    who.name = `${ name } ${ tag() }`;
    who.account = account;
    who.address = account.address;
    who.wallet = createWalletClient({ account, chain, transport: http(RPC) });
    who.handle = (await signInWallet(who.post, who.name, account)).handle;
    await node('hardhat_setBalance', [account.address, toHex(options.holds ?? 2_000n * WEI)]);

    if (options.terms !== false)
    {
        await who.post('/vault/terms', { adult: true });
    }

    if (options.disclosed !== false)
    {
        await who.post('/markets/disclosure');
    }

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
    const receipt = await reader.waitForTransactionReceipt({ hash });

    return { hash, mined: receipt.status, spent: receipt.gasUsed * receipt.effectiveGasPrice };
};

/** A live game of chess between two people made for it, both first moves made so neither side's clock calls it off. */
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

    const view = (await players[0].get(`/matches/${ id }`)).body;
    const white = bySeat.get(view.view.white);
    const black = bySeat.get(1 - view.view.white);
    let keys = 0;

    const move = async (by, from, to) =>
    {
        keys += 1;

        return by.post(`/matches/${ id }/play`, { key: `${ id }-${ keys }`, rev: (await by.get(`/matches/${ id }`)).body.rev, play: { kind: 'chess', verb: 'move', from: squareNamed(from), to: squareNamed(to) } });
    };

    await move(white, 'e2', 'e4');
    await move(black, 'e7', 'e5');

    const resign = async (by) =>
    {
        keys += 1;

        return by.post(`/matches/${ id }/resign`, { key: `${ id }-${ keys }` });
    };

    return { id, tableId: table.body.id, players, white, black, whiteSeat: view.view.white, resign, ok: started.status === 200 };
};

/** A position placed from the bettor's own wallet with the call the server composed, and handed in. */
const back = async (who, market, outcome, nura) =>
{
    const paying = await who.post(`/markets/${ market }/positions`, { outcome, amount: (nura * WEI).toString() });

    if (paying.status !== 200)
    {
        return { paying, sent: null };
    }

    const sent = await send(who, paying.body.call);

    await who.post(`/markets/positions/${ paying.body.position.id }/sent`, { hash: sent.hash });

    return { paying, sent, id: paying.body.position.id };
};

const positionOf = (who, id) => who.get(`/markets/positions/${ id }`).then((answer) => answer.body);

const confirmed = (who, id) => until(CONFIRMED_WITHIN_MS, async () =>
{
    const position = await positionOf(who, id);

    return position?.state === 'confirmed' ? position : null;
});

const marketAs = (who, match) => who.get(`/markets/matches/${ match }`).then((answer) => answer.body?.market ?? null);

const resolved = (who, match, state) => until(RESOLVED_WITHIN_MS, async () =>
{
    const market = await marketAs(who, match);

    return market?.state === state ? market : null;
});

/** A claim composed for the positions named, sent from the bettor's wallet, handed in and read back as claimed. */
const claim = async (who, ids) =>
{
    const call = await who.post('/markets/claims', { positions: ids });

    if (call.status !== 200)
    {
        return { call, paid: null };
    }

    const before = await balance(who.address);
    const sent = await send(who, call.body);

    await who.post('/markets/claims/sent', { hash: sent.hash, positions: ids });

    const claimedAll = await until(CONFIRMED_WITHIN_MS, async () =>
    {
        const positions = await Promise.all(ids.map((id) => positionOf(who, id)));

        return positions.every((one) => one?.claimedAt !== undefined) ? positions : null;
    });
    const after = await balance(who.address);

    return { call, sent, claimed: claimedAll, received: after - before + sent.spent };
};

const admin = createWalletClient({ account: privateKeyToAccount(VAULT_ADMIN_KEY), chain, transport: http(RPC) });

async function main()
{
    if (MARKETS === undefined)
    {
        throw new Error('QA_MARKETS names the markets contract vault-deploy.mjs put on the node');
    }

    // Hardhat mines only for a transaction, so its newest block is as old as the last one sent; a
    // chain with validators makes a block every few seconds, and the server reads its clock so.
    await node('evm_setIntervalMining', [1000]);

    console.log('\n[1] who may take a position');

    const fresh = await person('Fresh', { disclosed: false });
    const untermed = await person('Untermed', { terms: false });

    ok('markets are open, with their limits in wei', (await fresh.get('/markets')).body?.open === true);
    ok('somebody who has not read what a market is is asked to', (await fresh.get('/markets')).body?.may === 'market-disclosure');
    ok('somebody without the terms of paid play is asked for them', (await untermed.get('/markets')).body?.may === 'market-terms');
    ok('read once, the disclosure lets them', (await fresh.post('/markets/disclosure')).body?.may === 'yes');

    console.log('\n[2] four games, and a market on each');

    const games = [];

    for (const label of ['Settled', 'Early', 'Overturned', 'Lonely'])
    {
        const game = await chessGame(label);

        ok(`${ label }: the game starts and both first moves are made`, game.ok);
        games.push({ label, ...game });
    }

    const [settledGame, earlyGame, overturnedGame, lonelyGame] = games;
    const bettors = await Promise.all(['Ana', 'Bo', 'Cy', 'Di', 'Ed', 'Fay', 'Gus'].map((name) => person(name)));
    const [ana, bo, cy, di, ed, fay, gus] = bettors;
    const market = await marketAs(ana, settledGame.id);

    ok('a market on a live game: a seat each and a draw, by handle', market?.outcomes?.length === 3
        && market.outcomes[2].choice.kind === 'draw'
        && market.outcomes.slice(0, 2).every((one) => one.choice.kind === 'seat' && settledGame.players.some((player) => player.handle === one.choice.who)), JSON.stringify(market?.outcomes));

    const markets = new Map();

    for (const game of games)
    {
        markets.set(game.label, await marketAs(ana, game.id));
    }

    console.log('\n[3] refusals, each in its own word');

    refusedAs('a player of the game', await settledGame.white.post(`/markets/${ market.id }/positions`, { outcome: 0, amount: WEI.toString() }), 'market-playing');
    refusedAs('an outcome the market does not have', await ana.post(`/markets/${ market.id }/positions`, { outcome: 3, amount: WEI.toString() }), 'market-outcome');
    refusedAs('more than a position may be', await ana.post(`/markets/${ market.id }/positions`, { outcome: 0, amount: (501n * WEI).toString() }), 'market-amount');

    console.log('\n[4] unequal stakes on every outcome, placed from the bettors\' own wallets');

    const winnerSeat = 1 - settledGame.whiteSeat;
    const loserSeat = settledGame.whiteSeat;
    const stakes = [[ana, winnerSeat, 10n], [bo, winnerSeat, 25n], [cy, winnerSeat, 7n], [di, loserSeat, 40n], [ed, 2, 5n]];
    const placed = [];

    for (const [who, outcome, nura] of stakes)
    {
        placed.push({ who, outcome, nura, ...(await back(who, market.id, outcome, nura)) });
    }

    const atOnce = await Promise.all([back(fay, market.id, loserSeat, 3n), back(gus, market.id, winnerSeat, 13n)]);

    placed.push({ who: fay, outcome: loserSeat, nura: 3n, ...atOnce[0] }, { who: gus, outcome: winnerSeat, nura: 13n, ...atOnce[1] });

    // The other markets take their stakes now: every window is still open, and the waits below
    // can outlast one on a slow run.
    const early = markets.get('Early');
    const overturned = markets.get('Overturned');
    const lonely = markets.get('Lonely');
    const earlyStakes = [await back(ana, early.id, 0, 6n), await back(bo, early.id, 1, 4n)];
    const overturnStakes = [await back(cy, overturned.id, 0, 8n), await back(di, overturned.id, 1, 12n)];
    const lonelyStake = await back(fay, lonely.id, 0, 9n);
    const settling = await Promise.all(placed.map((one) => confirmed(one.who, one.id)));

    for (const [index, one] of placed.entries())
    {
        const held = await read('positionOf', [idOf(one.id)]);

        ok(`${ one.who.name.split(' ')[0] }: ${ one.nura } NURA on outcome ${ one.outcome }, held by the contract as placed`, settling[index] !== null
            && held[1].toLowerCase() === one.who.address.toLowerCase() && Number(held[2]) === one.outcome && held[3] === one.nura * WEI);
    }

    const pool = placed.reduce((sum, one) => sum + one.nura * WEI, 0n);
    const onChain = await read('marketOf', [idOf(market.id)]);
    const shown = await marketAs(ana, settledGame.id);

    ok('the pool the market shows is the pool the contract holds', BigInt(shown.pool) === pool && onChain.pool === pool, `${ shown.pool } ${ onChain.pool }`);
    ok('so is each outcome\'s', shown.outcomes.every((one, index) => BigInt(one.pool) === placed.filter((p) => p.outcome === index).reduce((sum, p) => sum + p.nura * WEI, 0n)));
    ok('and the bettors counted', shown.bettors === placed.length && Number(onChain.bettors) === placed.length);
    ok('a bettor\'s own positions are in the market they read', shown.mine.length === 1 && shown.mine[0].state === 'confirmed');

    const limited = await person('Max', { holds: 3_000n * WEI });

    const maxed = [await back(limited, market.id, 0, 500n), await back(limited, market.id, 1, 500n)];

    refusedAs('a bettor past a thousand NURA in one market', await limited.post(`/markets/${ market.id }/positions`, { outcome: 2, amount: WEI.toString() }), 'market-limit');
    placed.push({ who: limited, outcome: 0, nura: 500n, ...maxed[0] }, { who: limited, outcome: 1, nura: 500n, ...maxed[1] });

    console.log('\n[5] the other three markets: called off early, overturned, and one with one bettor');

    await Promise.all([
        confirmed(ana, earlyStakes[0].id),
        confirmed(bo, earlyStakes[1].id),
        confirmed(cy, overturnStakes[0].id),
        confirmed(di, overturnStakes[1].id),
        confirmed(fay, lonelyStake.id)
    ]);
    await earlyGame.resign(earlyGame.black);

    const cancelled = await resolved(ana, earlyGame.id, 'cancelled');

    ok('a game that ended before its market closed calls the market off, on the chain too', cancelled !== null && Number((await read('marketOf', [idOf(early.id)])).state) === 4);

    console.log('\n[6] the close');

    const closes = Math.max(...[market, overturned, lonely].map((one) => new Date(one.closesAt).getTime()));

    await pause(Math.max(0, closes - Date.now() + 2000));
    refusedAs('once a market has closed it takes nothing', await ed.post(`/markets/${ market.id }/positions`, { outcome: 0, amount: WEI.toString() }), 'market-closed');

    await settledGame.resign(settledGame.white);
    await overturnedGame.resign(overturnedGame.white);
    await lonelyGame.resign(lonelyGame.white);

    const settled = await resolved(ana, settledGame.id, 'settled');
    const settledOnChain = await read('marketOf', [idOf(market.id)]);

    ok('the game ended after the close: the market is settled on the outcome that happened', settled !== null && settled.outcome === winnerSeat, JSON.stringify(settled?.outcome));
    ok('the chain holds the same, its winners claiming at the end of the dispute window', Number(settledOnChain.state) === 2 && Number(settledOnChain.winner) === winnerSeat && new Date(settled.claimableAt).getTime() === Number(settledOnChain.claimableAt) * 1000);

    const lonelyEnd = await resolved(fay, lonelyGame.id, 'refunded');

    ok('a market with one bettor gives the stake back', lonelyEnd !== null && Number((await read('marketOf', [idOf(lonely.id)])).state) === 3);

    const overturnedSettled = await resolved(cy, overturnedGame.id, 'settled');

    ok('the third market is settled too', overturnedSettled !== null);

    const adminDone = overturnedSettled === null
        ? null
        : await reader.waitForTransactionReceipt({ hash: await admin.writeContract({ address: MARKETS, abi: ABI, functionName: 'overturn', args: [idOf(overturned.id)] }) });
    const overturnedEnd = adminDone === null ? null : await resolved(cy, overturnedGame.id, 'cancelled');

    ok('the owner overturns it in its window, and the server hears it: called off', adminDone?.status === 'success' && overturnedEnd !== null && overturnedEnd.claimableAt === undefined);

    console.log('\n[7] claims');

    const winners = placed.filter((one) => one.outcome === winnerSeat);
    const losers = placed.filter((one) => one.outcome !== winnerSeat);
    const early1 = await claim(ana, [winners[0].id]);

    refusedAs('a winner waits out the dispute window', early1.call, 'market-unclaimable');
    refusedAs('a loser has nothing to claim', (await claim(losers[0].who, [losers[0].id])).call, 'market-unclaimable');

    const refund = await claim(ana, [earlyStakes[0].id]);

    ok('a stake back is claimable at once, and pays the stake to the wei', refund.call.status === 200 && refund.received === 6n * WEI, `${ refund.received }`);

    await pause(Math.max(0, new Date(settled.claimableAt).getTime() - Date.now() + 4000));

    const backing = winners.reduce((sum, one) => sum + one.nura * WEI, 0n);
    const total = placed.reduce((sum, one) => sum + one.nura * WEI, 0n);
    let paid = 0n;

    for (const [index, one] of winners.entries())
    {
        const position = (await positionOf(one.who, one.id));
        const done = await claim(one.who, [one.id]);
        const share = (total * one.nura * WEI) / backing;

        paid += done.received ?? 0n;
        ok(`${ one.who.name.split(' ')[0] } is paid ${ index === winners.length - 1 ? 'what is left' : 'their share' }, read off the claim's receipt`, (done.claimed ?? null) !== null
            && done.claimed[0].paid !== undefined
            && BigInt(done.claimed[0].paid) === done.received
            && (index === winners.length - 1 || done.received === share)
            && position?.payout !== undefined
            && BigInt(position.payout) === share, `${ done.received } ${ share }`);
    }

    ok('the winners were paid the whole pool, to the wei', paid === total, `${ paid } of ${ total }`);
    ok('a position claimed is not claimable again', (await winners[0].who.post('/markets/claims', { positions: [winners[0].id] })).status === MARKET_REFUSALS['market-unclaimable']);

    const lonelyBack = await claim(fay, [lonelyStake.id]);
    const overturnBack = await claim(di, [overturnStakes[1].id]);

    ok('a lonely stake comes back', lonelyBack.received === 9n * WEI);
    ok('an overturned market gives every stake back', overturnBack.received === 12n * WEI);

    console.log('\n[8] a claim the wallet replaced');

    // Mining waits, so each claim lies in the node until the wallet sends another transaction at its
    // nonce for more gas: the claim again (sped up), or nothing to itself (cancelled).
    await node('evm_setIntervalMining', [0]);
    await node('evm_setAutomine', [false]);

    const gas = await reader.getGasPrice();
    const replaceClaim = async (who, id, replacement) =>
    {
        const call = (await who.post('/markets/claims', { positions: [id] })).body;
        const nonce = await reader.getTransactionCount({ address: who.address, blockTag: 'pending' });
        const before = await balance(who.address);
        const first = await who.wallet.sendTransaction({ to: call.to, data: call.data, value: BigInt(call.value), gasPrice: gas * 2n, nonce });

        await who.post('/markets/claims/sent', { hash: first, positions: [id] });

        // Its own gas: estimated against the waiting state, a second claim reverts AlreadyClaimed.
        const second = await who.wallet.sendTransaction({ ...replacement(call), gasPrice: gas * 4n, gas: 300_000n, nonce });

        return { first, second, before };
    };

    const spedUp = await replaceClaim(bo, earlyStakes[1].id, (call) => ({ to: call.to, data: call.data, value: BigInt(call.value) }));
    const dropped = await replaceClaim(cy, overturnStakes[0].id, () => ({ to: cy.address, value: 0n }));

    await node('evm_mine');
    await node('evm_setAutomine', [true]);
    await node('evm_setIntervalMining', [1000]);

    const [spedReceipt, cancelReceipt] = await Promise.all([spedUp.second, dropped.second].map((hash) => reader.waitForTransactionReceipt({ hash })));
    const firstGone = await Promise.all([spedUp.first, dropped.first].map((hash) => reader.getTransaction({ hash }).then(() => false, () => true)));

    ok('the node holds nothing under either first hash once its replacement is mined', firstGone.every(Boolean) && spedReceipt.status === 'success' && cancelReceipt.status === 'success');

    const waitingOn = await positionOf(bo, earlyStakes[1].id);

    ok('a hash that names nothing is given time: the claim is still on its way at first', waitingOn?.claimHash === spedUp.first.toLowerCase() && waitingOn?.claimedAt === undefined);

    const written = await until(100_000, async () =>
    {
        const now = await positionOf(bo, earlyStakes[1].id);

        return now?.claimedAt === undefined ? null : now;
    });
    const spedGot = (await balance(bo.address)) - spedUp.before + spedReceipt.gasUsed * spedReceipt.effectiveGasPrice;

    ok('a claim sped up is written down as claimed from what the contract holds, a stake back at its stake', written !== null && written.paid === (4n * WEI).toString() && spedGot === 4n * WEI, `${ written?.paid } ${ spedGot }`);

    const freed = await until(30_000, async () =>
    {
        const now = await positionOf(cy, overturnStakes[0].id);

        return now !== null && now !== undefined && now.claimHash === undefined && now.claimedAt === undefined ? now : null;
    });

    ok('a claim cancelled in the wallet is claimable again, since the contract paid nothing', freed !== null);

    const again = await claim(cy, [overturnStakes[0].id]);

    ok('and claimed again it pays the stake back', again.call.status === 200 && again.received === 8n * WEI, `${ again.received }`);
    ok('the contract still holds what it owes, and its books say so', await read('solvent'));
}

main()
    .catch((error) =>
    {
        failures += 1;
        console.error(error);
    })
    .finally(() =>
    {
        console.log(`\nmarket pass: ${ failures === 0 ? 'clean' : `${ failures } FAILED` }, ${ checks } checks`);
        process.exit(failures === 0 ? 0 : 1);
    });
