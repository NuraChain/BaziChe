/**
 * Photos, an album, a video and a file between two enrolled browsers on the BUILT server:
 *
 *   PGDATABASE=<the server's database> QA_BASE=http://localhost:5300 node tools/qa/media-pass.mjs
 *
 * `dana.w` sends into her direct thread with `omid.k`, each in a browser of their own that adds
 * itself through the seal notice's own Connect wallet, as the chat pass's do; both accounts are
 * emptied of devices and sealed lines first, because a seeded device is one whose private half
 * nobody holds (PGDATABASE names the server's database for that). Everything is pressed on the page:
 *
 * - a photo with a caption, chosen through the paperclip's photo picker and sent from its sheet:
 *   drawn as a photo in the other browser with no reload, its caption under it, and opened in the
 *   viewer;
 * - three photos at once, one bubble of three tiles;
 * - a video, drawn as a video with its length;
 * - a PDF through the file picker, drawn by its name and size, and saved at its bytes;
 * - the room's gallery holding what was sent;
 * - a stranger asking for one of the files is answered as nothing;
 * - neither console says anything.
 *
 * The photos and the video are made by the browser itself (a canvas, and a canvas recorded), so the
 * pass carries no media of its own.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { privateKeyToAccount } from 'viem/accounts';

import { WALLET_FIXTURES } from '../../backend/src/db/wallet-fixtures.ts';
import { sql as run } from './db.mjs';
import { BASE, launch, recorder, seat, waitFor } from './seats.mjs';

const OUT = join(import.meta.dirname, 'out', 'media');

mkdirSync(OUT, { recursive: true });

const { record, finish } = recorder('media pass');

const browser = await launch();

/**
 * Emptied as the chat pass empties them, so both browsers can seal and open: their devices, every
 * line sealed by one of them (the files a run before this one sent among them), and what keeps them;
 * and the files they uploaded, which count against an account's day of uploads.
 */
const emptied = (handles) =>
{
    const names = handles.map((one) => `'${ one }'`).join(', ');

    run([
        'delete from conversation_epochs',
        "delete from messages where kind = 'text'",
        `delete from messages where sender_device_id in (select d.id from devices d join users u on u.id = d.user_id where u.handle in (${ names }))`,
        `delete from chat_files where uploader_id in (select id from users where handle in (${ names }))`,
        `delete from epoch_archive where user_id in (select id from users where handle in (${ names }))`,
        `delete from recovery_vaults where user_id in (select id from users where handle in (${ names }))`,
        `delete from devices where user_id in (select id from users where handle in (${ names }))`
    ].join('; '));
};

/** A wallet in the page as an extension puts one there, so Connect wallet can add this browser. */
const walleted = async (who) =>
{
    const fixture = WALLET_FIXTURES.find((one) => one.handle === who.handle);
    const wallet = privateKeyToAccount(fixture.privateKey);

    await who.context.addInitScript((address) =>
    {
        const provider = {
            async request({ method, params })
            {
                if (method === 'eth_requestAccounts' || method === 'eth_accounts') { return [address]; }
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
            detail: { info: { uuid: 'nura-media-pass', name: 'MetaMask', icon: '', rdns: 'io.metamask' }, provider }
        }));

        window.addEventListener('eip6963:requestProvider', announce);
        announce();
    }, wallet.address);
    await who.context.exposeFunction('__walletSign', (message) => wallet.signMessage({ message }));
};

/** Adds the browser through the seal notice's Connect wallet, when the notice offers it. */
const enrol = async (who, room) =>
{
    await who.page.goto(`${ BASE }/app/chats/${ room }`);

    const connect = who.page.getByRole('button', { name: /^Connect wallet$/i }).first();

    if (await connect.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false))
    {
        await connect.click();
    }

    return await waitFor(async () => (await who.page.locator('[data-keyless]').count()) === 0, 20_000);
};

/** Pictures and a video drawn by the browser, written out for the pickers. */
const media = async (page) =>
{
    const made = await page.evaluate(async () =>
    {
        const picture = (hue, label) =>
        {
            const canvas = document.createElement('canvas');

            canvas.width = 640;
            canvas.height = 480;

            const ink = canvas.getContext('2d');

            ink.fillStyle = `hsl(${ hue } 60% 45%)`;
            ink.fillRect(0, 0, 640, 480);
            ink.fillStyle = '#fff';
            ink.font = 'bold 72px sans-serif';
            ink.fillText(label, 60, 260);

            return canvas.toDataURL('image/png').split(',')[1];
        };

        const video = await new Promise((resolve) =>
        {
            const canvas = document.createElement('canvas');

            canvas.width = 320;
            canvas.height = 240;

            const ink = canvas.getContext('2d');
            const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: 'video/webm' });
            const parts = [];
            let frame = 0;

            const draw = setInterval(() =>
            {
                frame += 1;
                ink.fillStyle = `hsl(${ frame * 9 } 60% 45%)`;
                ink.fillRect(0, 0, 320, 240);
            }, 33);

            recorder.ondataavailable = (event) => parts.push(event.data);
            recorder.onstop = async () =>
            {
                clearInterval(draw);

                const bytes = new Uint8Array(await new Blob(parts, { type: 'video/webm' }).arrayBuffer());
                let text = '';

                for (const byte of bytes)
                {
                    text += String.fromCharCode(byte);
                }

                resolve(btoa(text));
            };
            recorder.start();
            setTimeout(() => recorder.stop(), 1600);
        });

        return { pictures: [[200, 'One'], [20, 'Two'], [120, 'Three'], [280, 'Four']].map(([hue, label]) => picture(hue, label)), video };
    });

    const files = made.pictures.map((data, index) =>
    {
        const path = join(OUT, `photo-${ index + 1 }.png`);

        writeFileSync(path, Buffer.from(data, 'base64'));
        return path;
    });
    const video = join(OUT, 'clip.webm');
    const pdf = join(OUT, 'notes.pdf');

    writeFileSync(video, Buffer.from(made.video, 'base64'));
    writeFileSync(pdf, '%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

    return { photos: files, video, pdf };
};

/** Sends what the picker named is handed, from the sheet it opens, with a caption. */
const send = async (page, picker, files, caption) =>
{
    await page.locator(`input[data-attach="${ picker }"]`).setInputFiles(files);

    const sheet = page.locator('[data-file-sheet]');

    await sheet.waitFor({ timeout: 10_000 });
    await page.waitForFunction(() => !document.querySelector('[data-file-sheet] button[aria-busy="true"]')
        && [...document.querySelectorAll('[data-file-sheet] button')].some((one) => one.textContent?.trim() === 'Send' && !one.disabled), undefined, { timeout: 30_000 });

    if (caption !== '')
    {
        await sheet.locator('textarea').fill(caption);
    }

    await sheet.getByRole('button', { name: 'Send', exact: true }).click();
    await sheet.waitFor({ state: 'detached', timeout: 15_000 }).catch(() => undefined);
};

try
{
    emptied(['dana.w', 'omid.k']);

    const dana = await seat(browser, 'dana.w', { width: 1280, height: 900 });
    const omid = await seat(browser, 'omid.k', { width: 1280, height: 900 });
    const sara = await seat(browser, 'sara.k', { width: 1280, height: 900 });

    await walleted(dana);
    await walleted(omid);

    await dana.api('POST', '/social/requests', { id: 'omid.k' });
    await omid.api('POST', '/social/requests', { id: 'dana.w' });

    const room = (await dana.api('POST', '/chat/direct', { id: 'omid.k' })).body?.id;

    record('their conversation', typeof room === 'string');
    record('dana\'s browser is added through Connect wallet', await enrol(dana, room));
    record('and omid\'s', await enrol(omid, room));

    const made = await media(dana.page);

    await send(dana.page, 'media', [made.photos[0]], 'The first one');

    record('a photo arrives in the other browser as a photo', await waitFor(async () => (await omid.page.locator('[data-file][data-as="photo"]').count()) > 0, 20_000));
    record('with its caption', await waitFor(async () => (await omid.page.locator('main').textContent() ?? '').includes('The first one'), 10_000));

    await omid.page.locator('[data-file][data-as="photo"]').first().click();
    await omid.page.locator('[data-file][data-as="photo"] button').first().click().catch(() => undefined);

    record('and opens in the viewer', await waitFor(async () => (await omid.page.locator('[data-viewer]').count()) > 0, 10_000));

    await omid.page.keyboard.press('Escape');

    await send(dana.page, 'media', made.photos.slice(1), '');

    record('three photos at once are one bubble of three', await waitFor(async () => await omid.page.evaluate(() => [...document.querySelectorAll('[data-album]')].some((album) => album.querySelectorAll('[data-tile]').length === 3)), 20_000), await omid.page.evaluate(() => [...document.querySelectorAll('[data-album]')].map((album) => album.querySelectorAll('[data-tile]').length).join(',')));

    await send(dana.page, 'media', [made.video], '');

    record('a video arrives as a video', await waitFor(async () => (await omid.page.locator('[data-file][data-as="video"]').count()) > 0, 30_000));

    await send(dana.page, 'file', [made.pdf], '');

    const named = await waitFor(async () => (await omid.page.locator('[data-file][data-as="file"]').count()) > 0 && (await omid.page.locator('[data-file][data-as="file"]').last().textContent() ?? '').includes('notes.pdf'), 20_000);

    record('a file arrives by its name', named);

    const row = omid.page.locator('[data-file][data-as="file"]').last();

    if (await row.locator('[data-save]').count() === 0)
    {
        await row.locator('[data-download]').first().click();
        await row.locator('[data-save]').waitFor({ timeout: 20_000 }).catch(() => undefined);
    }

    const saving = omid.page.waitForEvent('download', { timeout: 20_000 });

    await row.locator('[data-save]').first().click();

    const download = await saving.catch(() => null);
    const kept = download === null ? null : join(OUT, 'saved.pdf');

    if (download !== null)
    {
        await download.saveAs(kept);
    }

    record('and is saved at its bytes', kept !== null && statSync(kept).size === statSync(made.pdf).size && readFileSync(kept).equals(readFileSync(made.pdf)), kept === null ? 'no download' : `${ statSync(kept).size } of ${ statSync(made.pdf).size }`);

    const fileId = await row.getAttribute('data-file');
    const asked = await sara.api('GET', `/chat/files/${ fileId }`);

    record('a stranger asking for it is answered as nothing', asked.status === 404, String(asked.status));

    await omid.page.locator('header [data-head-gallery] button').click();

    record('the room\'s gallery holds what was sent', await waitFor(async () => (await omid.page.locator('[data-gallery] [data-shelf-item]').count()) >= 4, 15_000), String(await omid.page.locator('[data-gallery] [data-shelf-item]').count()));

    record('neither console says anything', dana.errors.length === 0 && omid.errors.length === 0, [...dana.errors, ...omid.errors].join(' | '));
}
catch (error)
{
    record('the pass ran to its end', false, String(error).split('\n')[0]);
}
finally
{
    await browser.close();
    finish();
}
