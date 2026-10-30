/**
 * Voice messages between two real browsers, each with Chromium's fake microphone fed a speech-like
 * signal this pass writes (`voice-signal.mjs`), so what is recorded, sealed, uploaded, fetched,
 * opened and played is a real recording from the browser's own MediaRecorder.
 *
 *   npm run build && API_RATE_MAX=20000 PORT=5300 PUBLIC_ORIGIN=http://localhost:5300 npm start
 *   QA_BASE=http://localhost:5300 PGDATABASE=<the server's database> node tools/qa/voice-message-pass.mjs
 *
 * `dana.w` records in her thread with the person the seed gave her and the other browser plays what
 * arrives, everything asserted where it happens: the recorder's row, its bars and its clock, a pause
 * with what was said opened to be heard, more recorded into the same message, the line at the press
 * and its file going up as ciphertext; the message arriving in the other browser with no reload,
 * played, at each speed, moved through, its dot gone on both sides, and played again after a reload;
 * answered with a voice message of its own that quotes it; a stranger answered 404 for the file; an
 * upload that fails and is tried again; a press too short to send; both pages at 390 in Persian; and a
 * voice message recorded into a table's chat on the phone, said on its sender's plate and in the
 * desktop's way to the chat, and played there. Screenshots go to `tools/qa/out/voice-message/`.
 */
import { mkdirSync } from 'node:fs';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { privateKeyToAccount } from 'viem/accounts';

import { WALLET_FIXTURES } from '../../backend/src/db/wallet-fixtures.ts';
import { sql as run } from './db.mjs';
import { tableBody } from './tables.mjs';
import { chainUnreached } from './unreached.mjs';
import { speechLike, writeWav } from './voice-signal.mjs';

function cachedChromium()
{
    const home = process.env.LOCALAPPDATA ?? process.env.HOME ?? '';
    const cache = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(home, 'ms-playwright');
    if (!existsSync(cache)) { return undefined; }
    const builds = readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name))
        .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const build of builds)
    {
        for (const rel of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome'])
        {
            const candidate = join(cache, build, rel);
            if (existsSync(candidate)) { return candidate; }
        }
    }
    return undefined;
}

const BASE = process.env.QA_BASE ?? 'http://localhost:5300';

const OUT = join(import.meta.dirname, 'out', 'voice-message');

/** How long a ring, a read and a render may take before the other browser is expected to agree. */
const SETTLE_MS = 3000;

mkdirSync(OUT, { recursive: true });

const SPEECH = join(OUT, 'speech.wav');

writeWav(SPEECH, speechLike(20));

const executablePath = cachedChromium();
const browser = await chromium.launch({
    ...(executablePath === undefined ? {} : { executablePath }),
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${ SPEECH }`]
});

const results = [];
const record = (name, ok, detail) =>
{
    results.push({ name, ok, detail });
    console.log(`  ${ ok ? 'PASS' : 'FAIL' }  ${ name }${ detail ? ' — ' + detail : '' }`);
};

/** Both accounts with no device and no lines, so each enrols as itself and every line here is this run's. */
function emptyBothAccounts(handles)
{
    const names = handles.map((one) => `'${ one }'`).join(', ');

    run([
        'delete from conversation_epochs',
        'delete from voice_plays',
        "delete from messages where kind in ('text', 'voice', 'deleted', 'reaction', 'edit')",
        'delete from voice_notes',
        `delete from epoch_archive where user_id in (select id from users where handle in (${ names }))`,
        `delete from recovery_vaults where user_id in (select id from users where handle in (${ names }))`,
        `delete from devices where user_id in (select id from users where handle in (${ names }))`
    ].join('; '));
}

/** A browser signed in as a fixture, its wallet injected, its microphone Chromium's fake one. */
async function seat(handle, { viewport = { width: 1280, height: 900 }, locale = 'en' } = {})
{
    const fixture = WALLET_FIXTURES.find((one) => one.handle === handle);

    if (fixture === undefined)
    {
        throw new Error(`voice-message-pass: no wallet fixture called ${ handle }`);
    }

    const wallet = privateKeyToAccount(fixture.privateKey);
    const context = await browser.newContext({ viewport, locale: locale === 'fa' ? 'fa-IR' : 'en-US', permissions: ['microphone'] });

    await context.addCookies([{ name: 'locale', value: locale, url: BASE }]);
    await context.addInitScript(() =>
    {
        const provider = {
            async request({ method, params })
            {
                if (method === 'eth_requestAccounts' || method === 'eth_accounts') { return [window.__walletAddress]; }
                if (method === 'eth_chainId') { return '0x1'; }
                if (method === 'personal_sign') { return window.__walletSign(params[0]); }
                if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') { return null; }
                throw Object.assign(new Error(`unsupported ${ method }`), { code: 4200 });
            },
            on() {},
            removeListener() {}
        };

        window.ethereum = provider;

        const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
            detail: { info: { uuid: 'nura-test', name: 'MetaMask', icon: '', rdns: 'io.metamask' }, provider }
        }));

        window.addEventListener('eip6963:requestProvider', announce);
        announce();
    });
    await context.addInitScript((address) => { window.__walletAddress = address; }, wallet.address);
    await context.exposeFunction('__walletSign', (message) => wallet.signMessage({ message }));

    const issued = await context.request.post(`${ BASE }/api/auth/challenge`, { data: { address: wallet.address } });

    if (!issued.ok())
    {
        throw new Error(`voice-message-pass: no challenge for ${ handle } (${ issued.status() }). Is the api running?`);
    }

    const challenge = await issued.json();
    const signedIn = await context.request.post(`${ BASE }/api/auth/wallet`, {
        data: { address: wallet.address, nonce: challenge.nonce, signature: await wallet.signMessage({ message: challenge.message }) }
    });

    if (!signedIn.ok())
    {
        throw new Error(`voice-message-pass: could not sign in as ${ handle } (${ signedIn.status() })`);
    }

    const page = await context.newPage();
    const errors = [];

    page.on('console', (event) =>
    {
        if (event.type() !== 'error' || event.text().includes('favicon') || chainUnreached(event, handle))
        {
            return;
        }

        const where = event.location()?.url ?? '';

        // The one request this pass refuses on purpose: the upload [6] aborts.
        if (event.text().includes('ERR_FAILED') && where.includes('/api/chat/voice/'))
        {
            return;
        }

        errors.push(`${ handle }: ${ event.text().slice(0, 160) } ${ where }`);
    });
    page.on('pageerror', (error) => errors.push(`${ handle }: ${ String(error).slice(0, 160) }`));

    return { handle, context, page, errors, request: context.request };
}

const button = (who, name) => who.page.getByRole('button', { name, exact: true }).first();

async function enrol(who)
{
    const offered = who.page.getByRole('button', { name: /^Connect wallet$/i }).first();

    if (!await offered.isVisible().catch(() => false))
    {
        return false;
    }

    await offered.click();
    await who.page.waitForTimeout(SETTLE_MS * 2);
    return true;
}

const until = async (check, timeout = 8000) =>
{
    const end = Date.now() + timeout;

    while (Date.now() < end)
    {
        if (await check())
        {
            return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return false;
};

const phase = (who) => who.page.evaluate(() => document.querySelector('[data-recorder]')?.getAttribute('data-recorder') ?? null);

const clockOf = (who, scope) => who.page.evaluate((within) => document.querySelector(`${ within } [data-clock]`)?.textContent?.trim() ?? '', scope);

const seconds = (clock) =>
{
    const [minutes, rest] = clock.replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).split(':').map(Number);

    return minutes * 60 + rest;
};

const voices = (who) => who.page.evaluate(() => [...document.querySelectorAll('[data-voice]')].map((node) => ({
    id: node.getAttribute('data-voice'),
    play: node.querySelector('[data-play]')?.getAttribute('data-play') ?? null,
    clock: node.querySelector('[data-clock]')?.textContent?.trim() ?? '',
    fresh: node.querySelector('[data-fresh]') !== null,
    played: Number(node.querySelector('[data-played]')?.getAttribute('data-played') ?? '0'),
    speed: node.querySelector('[data-speed]')?.textContent?.trim() ?? null,
    fault: node.querySelector('[data-fault]')?.getAttribute('data-fault') ?? null
})));

const recordFor = async (who, ms) =>
{
    await button(who, 'Record a voice message').click();
    await until(async () => await phase(who) === 'recording', 6000);
    await who.page.waitForTimeout(ms);
};

const sender = await seat('dana.w');
let listener = null;
let stranger = null;

try
{
    // ---------------------------------------------------------------- 1. a thread both can seal in
    console.log('\n[1] a sealed thread both browsers can write in');

    const threads = await (await sender.request.get(`${ BASE }/api/chat/`)).json();
    const direct = (threads.conversations ?? []).find((one) => one.kind === 'direct');

    if (direct === undefined)
    {
        throw new Error('voice-message-pass: no direct conversation; has seedWalletFixtures run?');
    }

    const other = (direct.members ?? []).map((one) => one.handle ?? one).find((one) => one !== 'dana.w');

    emptyBothAccounts(['dana.w', other]);

    listener = await seat(other);

    await sender.page.goto(`${ BASE }/app/chats/${ direct.id }`, { waitUntil: 'networkidle' });
    await listener.page.goto(`${ BASE }/app/chats/${ direct.id }`, { waitUntil: 'networkidle' });
    await sender.page.waitForTimeout(SETTLE_MS);

    const enrolled = await enrol(sender) && await enrol(listener);

    record('both browsers enrolled through the real button', enrolled);

    await sender.page.reload({ waitUntil: 'networkidle' });
    await listener.page.reload({ waitUntil: 'networkidle' });
    await sender.page.waitForTimeout(SETTLE_MS);

    record('an empty composer offers the microphone where Send is', await button(sender, 'Record a voice message').isVisible());

    // ---------------------------------------------------------------- 2. recording
    console.log('\n[2] a voice message recorded, paused, heard, recorded into again and sent');

    const uploads = [];

    sender.page.on('request', (request) =>
    {
        if (request.method() === 'PUT' && request.url().includes('/api/chat/voice/'))
        {
            uploads.push({ url: request.url(), type: request.headers()['content-type'], body: request.postDataBuffer() });
        }
    });

    await recordFor(sender, 2500);

    record('the composer is the recorder’s row, recording', await phase(sender) === 'recording');

    const firstBars = await sender.page.evaluate(() => document.querySelector('[data-live] path')?.getAttribute('d') ?? '');

    await sender.page.waitForTimeout(400);

    const laterBars = await sender.page.evaluate(() => document.querySelector('[data-live] path')?.getAttribute('d') ?? '');
    const loud = [...laterBars.matchAll(/v([\d.]+)/g)].map((one) => Number(one[1])).filter((length) => length > 2).length;

    record('the bars move with what the microphone hears', firstBars !== laterBars && loud > 3, `${ loud } bars above silence`);
    record('the clock counts the recording', seconds(await clockOf(sender, '[data-recorder]')) >= 2, await clockOf(sender, '[data-recorder]'));

    await sender.page.screenshot({ path: join(OUT, 'recording-1280-en.png') });

    await button(sender, 'Pause recording').click();

    const opened = await until(async () => await sender.page.evaluate(() => document.querySelector('[data-preview]')?.hasAttribute('disabled') === false), 6000);
    const pausedAt = seconds(await clockOf(sender, '[data-recorder]'));

    record('paused, what was said is opened to be heard', opened && await phase(sender) === 'paused');
    record('its length is the recording’s own', pausedAt >= 2 && pausedAt <= 4, `${ pausedAt } s`);

    await button(sender, 'Hear what you recorded').click();
    record('the preview plays', await until(async () => await sender.page.evaluate(() => document.querySelector('[data-preview]')?.getAttribute('data-preview') === 'playing'), 4000));

    await sender.page.screenshot({ path: join(OUT, 'paused-1280-en.png') });

    await button(sender, 'Record more').click();
    record('it records into the same message again', await until(async () => await phase(sender) === 'recording', 4000));
    await sender.page.waitForTimeout(1500);

    const before = (await voices(sender)).length;

    await button(sender, 'Send the voice message').click();

    record('the field is back once it is sent', await until(async () => await sender.page.evaluate(() => document.querySelector('main textarea') !== null), 6000));
    record('the voice message is in the sender’s thread at the press', await until(async () => (await voices(sender)).length === before + 1, 4000));
    record('its file went up as ciphertext, never as a recording', await until(async () => uploads.length === 1, 6000)
        && uploads[0].type === 'application/octet-stream'
        && uploads[0].body !== null
        && !(uploads[0].body[0] === 0x1a && uploads[0].body[1] === 0x45 && uploads[0].body[2] === 0xdf && uploads[0].body[3] === 0xa3),
        `${ uploads[0]?.body?.length ?? 0 } bytes`);

    const sent = (await voices(sender)).at(-1);
    const sentSeconds = seconds(sent?.clock ?? '0:00');

    record('it is as long as both stretches recorded', sentSeconds >= 3 && sentSeconds <= 6, sent?.clock);
    record('the sender sees it as nobody has played it yet', sent?.fresh === true);
    record('its mark says the server has it', await until(async () => await sender.page.evaluate((id) => document.querySelector(`[data-message="${ id }"] [data-status]`)?.getAttribute('data-status') === 'sent', sent?.id), 6000));

    // ---------------------------------------------------------------- 3. arriving, played
    console.log('\n[3] the other browser plays it as it arrives');

    record('it arrives in the other browser with no reload', await until(async () => (await voices(listener)).some((one) => one.id === sent?.id), 8000));

    const arrived = (await voices(listener)).find((one) => one.id === sent?.id);

    record('with its length and the dot of a message not played', arrived?.clock === sent?.clock && arrived?.fresh === true, `${ arrived?.clock }, dot ${ arrived?.fresh }`);

    await listener.page.screenshot({ path: join(OUT, 'arrived-1280-en.png') });

    const fetched = listener.page.waitForResponse((response) => response.url().includes('/api/chat/voice/') && response.request().method() === 'GET');

    await listener.page.locator(`[data-voice="${ sent?.id }"] [data-play]`).click();

    const file = await fetched;

    record('its file is fetched when it is first played', file.status() === 200, String(file.status()));
    record('it plays', await until(async () => (await voices(listener)).find((one) => one.id === sent?.id)?.play === 'playing', 6000));

    await listener.page.waitForTimeout(1200);

    const moving = (await voices(listener)).find((one) => one.id === sent?.id);

    record('its place moves along the waveform as it plays', (moving?.played ?? 0) > 0.1, `${ moving?.played }`);
    record('its dot goes as it plays', moving?.fresh === false);

    for (const rate of ['1.5×', '2×', '1×'])
    {
        await listener.page.locator(`[data-voice="${ sent?.id }"] [data-speed]`).click();
        record(`the speed chip says ${ rate }`, (await voices(listener)).find((one) => one.id === sent?.id)?.speed === rate);
    }

    const track = listener.page.locator(`[data-voice="${ sent?.id }"] [role="slider"]`);
    const box = await track.boundingBox();

    await listener.page.mouse.click(box.x + box.width * 0.85, box.y + box.height / 2);
    await listener.page.waitForTimeout(250);

    const moved = (await voices(listener)).find((one) => one.id === sent?.id);

    record('a press on the waveform moves it there', (moved?.played ?? 0) >= 0.8, `${ moved?.played }`);
    record('the sender’s dot goes once it has been played', await until(async () => (await voices(sender)).find((one) => one.id === sent?.id)?.fresh === false, 8000));

    await listener.page.reload({ waitUntil: 'networkidle' });
    await listener.page.waitForTimeout(SETTLE_MS);

    const kept = (await voices(listener)).find((one) => one.id === sent?.id);

    record('after a reload it is there, played', kept !== undefined && kept.fresh === false);

    await listener.page.locator(`[data-voice="${ sent?.id }"] [data-play]`).click();
    record('and plays again', await until(async () => (await voices(listener)).find((one) => one.id === sent?.id)?.play === 'playing', 6000));
    await listener.page.locator(`[data-voice="${ sent?.id }"] [data-play]`).click();

    // ---------------------------------------------------------------- 4. answered
    console.log('\n[4] answered with a voice message of its own');

    await listener.page.locator(`[data-voice="${ sent?.id }"] [data-clock]`).click({ button: 'right' });

    const menu = listener.page.getByRole('menu');
    const offered = await menu.getByRole('menuitem').allTextContents().catch(() => []);

    record('a right click opens its menu, with Reply and no Copy', offered.some((one) => one.includes('Reply')) && !offered.some((one) => one.includes('Copy')), offered.map((one) => one.trim()).filter(Boolean).join(', '));

    await menu.getByRole('menuitem', { name: 'Reply', exact: true }).click();

    const quoteOf = (who) => who.page.evaluate(() =>
    {
        const head = [...document.querySelectorAll('main span')].find((node) => node.textContent?.startsWith('Replying to') === true);

        return head?.parentElement?.textContent ?? '';
    });

    const quote = `Voice message (${ sent?.clock })`;

    record('Reply quotes it as a voice message with its length', await until(async () => (await quoteOf(listener)).includes(quote), 3000), await quoteOf(listener));

    const answers = (await voices(sender)).length;

    await recordFor(listener, 1500);
    record('the quote stays above the recorder', (await quoteOf(listener)).includes(quote));
    await button(listener, 'Send the voice message').click();

    const answerArrived = await until(async () => (await voices(sender)).length === answers + 1, 8000);
    const answer = (await voices(sender)).at(-1);
    const quoted = answer === undefined
        ? ''
        : await sender.page.evaluate((id) => document.querySelector(`[data-voice="${ id }"]`)?.closest('[data-message]')?.textContent ?? '', answer.id);

    record('the answer arrives as a voice message quoting the first', answerArrived && quoted.includes(quote), `${ answer?.clock ?? 'none' }`);
    record('the reply is let go of once the answer is sent', await until(async () => (await quoteOf(listener)) === '', 3000));

    // ---------------------------------------------------------------- 5. a stranger
    console.log('\n[5] the file to somebody not in the room');

    const outsider = WALLET_FIXTURES.map((one) => one.handle).find((one) => one !== 'dana.w' && one !== other);

    stranger = await seat(outsider);

    const fileId = new URL(uploads[0].url).pathname.split('/').at(-1);
    const asked = await stranger.request.get(`${ BASE }/api/chat/voice/${ fileId }`);

    record('is answered as a file that is not there', asked.status() === 404, `${ outsider }: ${ asked.status() }`);

    // ---------------------------------------------------------------- 6. an upload that fails
    console.log('\n[6] an upload that fails, tried again');

    const heard = (await voices(listener)).length;

    let refused = 0;

    await sender.page.route('**/api/chat/voice/**', async (route) =>
    {
        if (route.request().method() === 'PUT' && refused === 0)
        {
            refused += 1;
            await route.abort('failed');
            return;
        }
        await route.continue();
    });

    await recordFor(sender, 1800);
    await button(sender, 'Send the voice message').click();

    const unsent = await until(async () => await sender.page.evaluate(() => [...document.querySelectorAll('[data-message]')].some((row) => row.textContent?.includes('Not sent') === true)), 8000);

    record('a file that did not go up leaves the line Not sent', unsent);

    await sender.page.getByRole('button', { name: 'Try again', exact: true }).last().click();

    record('Try again puts it up and sends it', await until(async () => !await sender.page.evaluate(() => [...document.querySelectorAll('[data-message]')].some((row) => row.textContent?.includes('Not sent') === true)), 8000));
    record('and the other browser has it', await until(async () => (await voices(listener)).length === heard + 1, 8000));

    await sender.page.unroute('**/api/chat/voice/**');

    // ---------------------------------------------------------------- 7. a press too short
    console.log('\n[7] a press too short to send');

    const count = (await voices(sender)).length;

    await button(sender, 'Record a voice message').click();
    await until(async () => await phase(sender) === 'recording', 6000);
    await sender.page.waitForTimeout(300);
    await button(sender, 'Send the voice message').click();

    record('is dropped with a sentence', await until(async () => (await sender.page.textContent('body'))?.includes('That was too short to send.') === true, 6000));
    record('and nothing is sent', (await voices(sender)).length === count);

    // ---------------------------------------------------------------- 8. a phone in Persian
    console.log('\n[8] 390 in Persian');

    await listener.context.addCookies([{ name: 'locale', value: 'fa', url: BASE }]);
    await listener.page.setViewportSize({ width: 390, height: 844 });
    await listener.page.reload({ waitUntil: 'networkidle' });
    await listener.page.waitForTimeout(SETTLE_MS);

    const persian = await voices(listener);
    const wide = await listener.page.evaluate(() => document.documentElement.scrollWidth);

    record('the clock is in Persian digits', persian.length > 0 && /^[۰-۹]+:[۰-۹]{2}$/.test(persian[0].clock), persian[0]?.clock);
    record('and the player still runs left to right', await listener.page.evaluate(() => document.querySelector('[data-voice]')?.getAttribute('dir') === 'ltr'));
    record('nothing is wider than the phone', wide <= 390, `${ wide }px`);

    await listener.page.screenshot({ path: join(OUT, 'thread-390-fa.png') });

    await listener.page.getByRole('button', { name: 'ضبط پیام صوتی', exact: true }).click();
    await until(async () => await phase(listener) === 'recording', 6000);
    await listener.page.waitForTimeout(1200);
    await listener.page.screenshot({ path: join(OUT, 'recording-390-fa.png') });

    record('the recorder fits the phone', await listener.page.evaluate(() => document.documentElement.scrollWidth) <= 390);

    await listener.page.getByRole('button', { name: 'پاک کردن ضبط', exact: true }).click();
    record('deleted, the field is back', await until(async () => await listener.page.evaluate(() => document.querySelector('main textarea') !== null), 4000));

    // ---------------------------------------------------------------- 9. at a table
    console.log('\n[9] at a table: recorded into its chat on the phone, said on the plate and beside the board');

    const made = await sender.request.post(`${ BASE }/api/tables/`, { data: tableBody({ game: 'ludo', seats: 2, mode: 'turns' }) });
    const tableId = made.ok() ? (await made.json()).id : '';

    await listener.request.post(`${ BASE }/api/tables/${ tableId }/seat`);
    await listener.request.post(`${ BASE }/api/tables/${ tableId }/ready`, { data: { ready: true } });
    await sender.request.post(`${ BASE }/api/tables/${ tableId }/ready`, { data: { ready: true } });

    const started = await sender.request.post(`${ BASE }/api/tables/${ tableId }/start`);

    record('a game of Ludo for the two of them, a move a day', made.ok() && started.ok(), `${ made.status() } ${ started.status() }`);

    await sender.page.goto(`${ BASE }/app/play/${ tableId }`, { waitUntil: 'networkidle' });
    await listener.page.goto(`${ BASE }/app/play/${ tableId }`, { waitUntil: 'networkidle' });
    await listener.page.waitForTimeout(SETTLE_MS);

    await listener.page.getByRole('button', { name: 'نشون دادن چت', exact: true }).first().click();

    const tableMic = listener.page.getByRole('button', { name: 'ضبط پیام صوتی', exact: true }).first();

    record('the phone’s table chat offers the microphone', await until(async () => await tableMic.isVisible().catch(() => false), 6000));

    const spoken = (await voices(listener)).length;

    await tableMic.click();
    await until(async () => await phase(listener) === 'recording', 6000);
    await listener.page.waitForTimeout(1500);
    await listener.page.getByRole('button', { name: 'فرستادن پیام صوتی', exact: true }).click();

    record('it is in the table’s chat at the press', await until(async () => (await voices(listener)).length === spoken + 1, 4000));

    const said = (await voices(listener)).at(-1);
    const length = said === undefined ? '' : said.clock.replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
    const bubble = () => sender.page.evaluate(() => [...document.querySelectorAll('.table-plate-bubble')].map((node) => node.textContent?.trim() ?? ''));

    record('the desktop’s plate says it in a bubble', await until(async () => (await bubble()).includes(`Voice message (${ length })`), 8000), (await bubble()).join(' | '));

    const pill = sender.page.getByRole('button', { name: 'Show chat', exact: true }).first();
    const preview = async () => (await pill.textContent().catch(() => '')) ?? '';

    record('the way to the chat says who sent what', await until(async () => (await preview()).includes(`: Voice message (${ length })`), 8000), (await preview()).trim());

    await sender.page.screenshot({ path: join(OUT, 'table-1280-en.png') });
    await listener.page.screenshot({ path: join(OUT, 'table-390-fa.png') });

    await pill.click();

    const atTable = sender.page.locator(`[data-voice="${ said?.id }"] [data-play]`);

    record('opened, it is in the desktop’s table chat', await until(async () => await atTable.isVisible().catch(() => false), 6000));

    await atTable.click();
    record('and plays there', await until(async () => (await voices(sender)).find((one) => one.id === said?.id)?.play === 'playing', 6000));
    record('nothing on the phone is wider than the phone', await listener.page.evaluate(() => document.documentElement.scrollWidth) <= 390);

    await sender.page.screenshot({ path: join(OUT, 'table-chat-1280-en.png') });
    await atTable.click();

    await listener.request.post(`${ BASE }/api/tables/${ tableId }/leave`, { data: { forfeit: true } });
    await sender.request.post(`${ BASE }/api/tables/${ tableId }/leave`, { data: { forfeit: true } });

    // ---------------------------------------------------------------- 10. consoles
    console.log('\n[10] consoles');

    const errors = [...sender.errors, ...listener.errors, ...stranger.errors];

    record('no console error in either browser', errors.length === 0, errors.slice(0, 3).join(' | '));
}
catch (error)
{
    record('the pass ran to its end', false, String(error).slice(0, 300));
}
finally
{
    await browser.close();
}

const failed = results.filter((one) => !one.ok);

console.log(`\n${ results.length - failed.length } of ${ results.length } checks passed`);
process.exitCode = failed.length === 0 ? 0 : 1;
