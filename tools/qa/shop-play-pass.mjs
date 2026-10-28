/**
 * Two real browsers and the shop, on the built server and a local chain: one player buys looks from
 * the look's sheet with the wallet in their page, puts them on, and sits down at Ludo with the
 * other, who sees them on the buyer's things and their own things Classic.
 *
 *   QA_BASE=http://localhost:5300 QA_SHOP=<the shop> node tools/qa/shop-play-pass.mjs
 *
 * The server and the node are set up as `shop-pass.mjs` wants them (QA_RPC, http://127.0.0.1:8645).
 * Each page's wallet is an EIP-1193 provider the pass puts in the page, which answers from a key the
 * pass keeps in memory, the way an extension would: it sends the purchase to the node and passes every
 * read through. The buyer is on a desk in English and the other player on a phone in Persian.
 */
import { createPublicClient, createWalletClient, decodeFunctionData, http, toHex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { hardhat } from 'viem/chains';

import { BASE, clearTables, launch, recorder, waitFor, walletSeat } from './seats.mjs';
import { shopArtifact } from './vault-deploy.mjs';

const RPC = process.env.QA_RPC ?? 'http://127.0.0.1:8645';

const SHOP = process.env.QA_SHOP ?? '';

const WEI = 10n ** 18n;

const PAWNS = 'pawns.storm';

const FRAME = 'decoration.gold';

const ABI = shopArtifact().abi;

const chain = { ...hardhat, rpcUrls: { default: { http: [RPC] } } };

const reader = createPublicClient({ chain, transport: http(RPC) });

const { record, finish } = recorder('shop-play-pass');

const node = async (method, params = []) =>
{
    const response = await fetch(RPC, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
    });
    const answer = await response.json();

    if (answer.error !== undefined)
    {
        throw new Error(answer.error.message);
    }

    return answer.result;
};

const providerFor = (account) =>
{
    const client = createWalletClient({ account, chain, transport: http(RPC) });
    const sent = [];

    const answer = async (method, params) =>
    {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts')
        {
            return [account.address];
        }

        if (method === 'eth_chainId')
        {
            return toHex(chain.id);
        }

        if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain')
        {
            return null;
        }

        if (method === 'wallet_getPermissions' || method === 'wallet_requestPermissions')
        {
            return [{ parentCapability: 'eth_accounts' }];
        }

        if (method === 'personal_sign')
        {
            return account.signMessage({ message: /^0x[0-9a-f]*$/i.test(params[0]) ? { raw: params[0] } : params[0] });
        }

        if (method === 'eth_sendTransaction')
        {
            const [asked] = params;

            sent.push(asked);

            return client.sendTransaction({
                to: asked.to,
                data: asked.data,
                value: BigInt(asked.value ?? '0x0'),
                ...(asked.gasPrice === undefined ? {} : { gasPrice: BigInt(asked.gasPrice) })
            });
        }

        return node(method, params);
    };

    return { answer, sent };
};

const player = async (browser, name, language, viewport) =>
{
    const account = privateKeyToAccount(generatePrivateKey());
    const seated = await walletSeat(browser, name, viewport, account);
    const wallet = providerFor(account);

    await seated.context.addCookies([{ name: 'locale', value: language, url: BASE }]);
    await seated.context.exposeFunction('nuraWallet', (method, params) => wallet.answer(method, params));
    await seated.context.addInitScript(() =>
    {
        window.ethereum = {
            request: ({ method, params }) => window.nuraWallet(method, params ?? []),
            on: () => undefined,
            removeListener: () => undefined
        };
    });
    await node('hardhat_setBalance', [account.address, toHex(500n * WEI)]);

    const refused = [];

    seated.page.on('response', (response) =>
    {
        if (response.status() >= 400)
        {
            refused.push(`${ response.status() } ${ response.request().method() } ${ new URL(response.url()).pathname }`);
        }
    });

    return { ...seated, label: `${ name } (${ language }, ${ viewport.width })`, account, address: account.address.toLowerCase(), wallet, refused };
};

const chosenOf = async (who) => (await who.api('GET', '/shop/collection')).body?.chosen ?? [];

/** Buys `item` from its sheet: the price the sheet offers, the one transaction the wallet is asked to send, and the sheet's own word that it arrived. */
const buy = async (who, item, price) =>
{
    await who.page.goto(`${ BASE }/app/shop?item=${ item }`);

    const sheet = who.page.locator(`[data-look-sheet="${ item }"]`);
    const button = sheet.getByRole('button', { name: `Buy for ${ price } NURA` });

    record(`${ item }: the sheet offers it for ${ price } NURA`, await button.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false));

    const before = who.wallet.sent.length;
    const pressedAt = Date.now();

    await button.click();

    const done = await waitFor(async () => await sheet.locator('[data-buy-step="done"]').count() > 0, 60_000);
    const asked = who.wallet.sent.slice(before);

    record(`${ item }: the wallet was asked to send one transaction, to the shop, carrying the price`,
        asked.length === 1 && asked[0].to.toLowerCase() === SHOP.toLowerCase() && BigInt(asked[0].value) === BigInt(price) * WEI,
        JSON.stringify(asked.map((one) => ({ to: one.to, value: one.value }))));
    record(`${ item }: the sheet says it is theirs`, done === true, `${ ((Date.now() - pressedAt) / 1000).toFixed(1) } s after the press`);

    if (asked.length === 1)
    {
        const { args } = decodeFunctionData({ abi: ABI, data: asked[0].data });
        const sale = await reader.readContract({ address: SHOP, abi: ABI, functionName: 'saleOf', args: [args[0].order] });

        record(`${ item }: the shop holds the sale to them at that price`, sale[0].toLowerCase() === who.address && sale[4] === BigInt(price) * WEI, JSON.stringify(sale.map(String)));
    }

    const use = sheet.getByRole('button', { name: 'Use it' });

    await use.click({ timeout: 10_000 }).catch(() => undefined);

    const worn = await waitFor(async () => (await chosenOf(who)).some((one) => one.item === item), 10_000);

    record(`${ item }: Use it puts it on`, worn === true, JSON.stringify(await chosenOf(who)));
};

/** Every pawn on a board, by what it is drawn from. */
const pawnsOf = (who) => who.page.locator('.lp .lp-pawn').evaluateAll((all) => all.map((one) => one.getAttribute('src') ?? ''));

const drawn = (sources) => ({
    storm: sources.filter((source) => source.startsWith('/pawns/storm-')).length,
    classic: sources.filter((source) => source.startsWith('/board/pawn-')).length
});

const main = async () =>
{
    if (SHOP === '')
    {
        throw new Error('QA_SHOP names the shop contract the server sells through');
    }

    const browser = await launch();
    let buyer = null;
    let other = null;

    try
    {
        buyer = await player(browser, 'dana', 'en', { width: 1280, height: 900 });
        other = await player(browser, 'mina', 'fa', { width: 390, height: 844 });

        console.log('\nthe shop');

        const state = (await buyer.api('GET', '/shop')).body;
        const priceOf = (item) => String(BigInt(state?.items?.find((one) => one.id === item)?.price ?? '0') / WEI);

        record('the shop is open, and the buyer may buy', state?.may === 'yes', JSON.stringify({ may: state?.may }));
        record('the other player wears nothing', (await chosenOf(other)).length === 0);

        await buy(buyer, PAWNS, priceOf(PAWNS));
        await buy(buyer, FRAME, priceOf(FRAME));

        console.log('\na game of Ludo');

        await clearTables(buyer, other);
        await buyer.page.goto(`${ BASE }/app`);

        const opened = await buyer.api('POST', '/tables/quick', { game: 'ludo', seats: 2, voice: 'off' });
        const tableId = opened.body?.id;
        const joined = await other.api('POST', '/tables/quick', { game: 'ludo', seats: 2, voice: 'off' });

        record('both are seated at one table', typeof tableId === 'string' && joined.body?.id === tableId, JSON.stringify({ opened: opened.status, joined: joined.status }));

        let matchId = null;

        await waitFor(async () => (matchId = (await buyer.api('GET', `/tables/${ tableId }`)).body?.matchId ?? null) !== null, 15_000);

        record('the game starts', typeof matchId === 'string');

        const view = (await other.api('GET', `/matches/${ matchId }`)).body;
        const seatOf = (who) => view?.players?.find((one) => one.who === who.handle);

        record('the game carries the buyer\'s pawns on their seat', seatOf(buyer)?.look?.pawns === PAWNS, JSON.stringify(seatOf(buyer)?.look));
        record('and nothing on the other player\'s', seatOf(other) !== undefined && Object.keys(seatOf(other).look ?? {}).length === 0, JSON.stringify(seatOf(other)?.look));

        await Promise.all([buyer, other].map((who) => who.page.goto(`${ BASE }/app/play/${ tableId }`)));

        for (const who of [buyer, other])
        {
            const ready = await waitFor(async () => (await pawnsOf(who)).length === 8, 20_000);
            const counted = drawn(await pawnsOf(who));

            record(`${ who.label }: the buyer's four pawns are drawn in Storm and the other four Classic`, ready === true && counted.storm === 4 && counted.classic === 4, JSON.stringify(counted));
        }

        const frames = await other.page.locator('[data-deco]').evaluateAll((all) => all.map((one) => one.getAttribute('data-deco')));

        record(`${ other.label }: the buyer's plate wears the Gold frame, and nobody else wears one`, frames.includes('gold') && frames.every((one) => one === 'gold'), JSON.stringify(frames));

        await buyer.api('POST', '/shop/chosen', { slot: 'ludo.pawns' });
        await other.page.reload();
        await waitFor(async () => (await pawnsOf(other)).length === 8, 20_000);

        const kept = drawn(await pawnsOf(other));

        record(`${ other.label }: a look taken off during the game changes nothing until the next game`, kept.storm === 4 && kept.classic === 4, JSON.stringify(kept));

        await buyer.page.screenshot({ path: 'tools/qa/out/shop-play-buyer.png' }).catch(() => undefined);
        await other.page.screenshot({ path: 'tools/qa/out/shop-play-other.png' }).catch(() => undefined);

        for (const who of [buyer, other])
        {
            record(`${ who.label }: the console says nothing`, who.errors.length === 0, who.errors.slice(0, 3).join(' | '));
            record(`${ who.label }: nothing it asked for was refused`, who.refused.length === 0, who.refused.slice(0, 3).join(' | '));
        }
    }
    finally
    {
        for (const who of [buyer, other].filter((one) => one !== null))
        {
            await who.page.goto('about:blank').catch(() => undefined);
        }

        await clearTables(...[buyer, other].filter((one) => one !== null)).catch(() => undefined);
        await browser.close();
        finish();
    }
};

await main();
