#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchChrome } from '../chrome.mjs';
import { GAMES } from '../../frontend/src/data/games.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORLD = join(ROOT, 'frontend', 'public', 'world');
const BASE = process.env.QA_BASE ?? 'http://localhost:5300';

export const POSTERS = [
    { file: 'poster-portrait.webp', width: 390, height: 844, scale: 2, locale: 'en', budget: 90 * 1024 },
    { file: 'poster-wide-ltr.webp', width: 1920, height: 1080, scale: 1, locale: 'en', budget: 130 * 1024 },
    { file: 'poster-wide-rtl.webp', width: 1920, height: 1080, scale: 1, locale: 'fa', budget: 130 * 1024 }
];

const TABLE_STILLS = GAMES.map(({ id }) => ({
    game: id, file: `card-${ id }.webp`, width: 1080, height: 720, scale: 1,
    outputWidth: 720, outputHeight: 480, locale: 'en', budget: 32 * 1024
}));

function filesUnder(directory)
{
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? filesUnder(join(directory, entry.name)) : [join(directory, entry.name)]);
}

export function inputs()
{
    return [
        join(WORLD, 'showcase-desktop.glb'),
        join(WORLD, 'showcase-phone.glb'),
        join(ROOT, 'frontend', 'src', 'data', 'games.ts'),
        ...filesUnder(join(ROOT, 'frontend', 'src', 'world'))
    ].map((path) => relative(ROOT, path).replaceAll('\\', '/')).sort();
}

export function fingerprint()
{
    const hash = createHash('sha256');
    for (const input of inputs())
    {
        hash.update(input);
        hash.update(readFileSync(join(ROOT, input)));
    }
    const stage = readFileSync(join(ROOT, 'frontend', 'src', 'components', 'world', 'world-canvas.component.azeroth'), 'utf8');
    hash.update(stage.split('\n').filter((line) => line.includes('--subject-') || line.includes('/world/poster-')).join('\n'));
    return hash.digest('hex');
}

// Let CSS cast the large floor shadow in the active theme, so it stays smooth at any display size.
// Contact shadows on pieces and boards still come from the original GLB materials.
function photoScene(source, game)
{
    const jsonSize = source.readUInt32LE(12);
    const scene = JSON.parse(source.subarray(20, 20 + jsonSize).toString('utf8'));
    const roots = scene.scenes[scene.scene ?? 0];
    if (game)
    {
        roots.nodes = roots.nodes.filter((index) => scene.nodes[index].name === game);
        if (roots.nodes.length !== 1) throw new Error(`Expected one showcase root for ${ game }`);
    }
    for (const index of roots.nodes)
    {
        const table = scene.nodes[index];
        table.children = table.children.filter((child) => !scene.nodes[child].name.startsWith('decal-floor-'));
    }
    const json = Buffer.from(JSON.stringify(scene));
    const size = Math.ceil(json.length / 4) * 4;
    const header = Buffer.from(source.subarray(0, 20));
    header.writeUInt32LE(source.length - jsonSize + size, 8);
    header.writeUInt32LE(size, 12);
    return Buffer.concat([header, json, Buffer.alloc(size - json.length, 0x20), source.subarray(20 + jsonSize)]);
}

async function capture(browser, poster)
{
    const context = await browser.newContext({
        viewport: { width: poster.width, height: poster.height },
        deviceScaleFactor: poster.scale
    });
    await context.addCookies([{ name: 'locale', value: poster.locale, url: BASE }]);
    const page = await context.newPage();
    await page.route('**/world/showcase-*.glb', (route) =>
    {
        const filename = new URL(route.request().url()).pathname.split('/').pop();
        return route.fulfill({ contentType: 'model/gltf-binary', body: photoScene(readFileSync(join(WORLD, filename)), poster.game) });
    });
    await page.addInitScript((singleTable) =>
    {
        const style = document.createElement('style');
        // Capture only the table and its shadow. The page supplies the dark or light studio.
        style.textContent = `
            html { scrollbar-width: none; }
            .world-canvas { inline-size: 100% !important; inset-inline: 0 !important; }
            html, body, #root, #root *:has(.world-canvas) { background: transparent !important; }
            .scene-overlay, .site-header, .scrim, .world-poster, .landing-scene-still { visibility: hidden !important; }
        `;
        if (singleTable)
        {
            style.textContent += '.world-stage { --subject-x: 0.5 !important; --subject-y: 0.40 !important; }';
        }
        document.addEventListener('DOMContentLoaded', () => document.head.append(style));
    }, Boolean(poster.game));
    await page.goto(`${ BASE }/`, { waitUntil: 'load' });
    await page.waitForSelector('.world-canvas.is-live', { timeout: 30000 });
    if (poster.game)
    {
        await page.locator(`#tour-${ poster.game }`).evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForSelector(`.world-stage[data-shot="${ poster.game }"]`);
    }
    await page.waitForTimeout(poster.game ? 2300 : 1500);
    const png = await page.locator('.world-canvas').screenshot({ scale: 'device', animations: 'disabled', omitBackground: true });
    await context.close();
    return png;
}

async function encode(browser, png, poster)
{
    const page = await browser.newPage();
    const result = await page.evaluate(async ({ source, limit, width, height }) =>
    {
        const image = new Image();
        image.src = source;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = width ?? image.naturalWidth;
        canvas.height = height ?? image.naturalHeight;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        if ([[0, 0], [canvas.width - 1, 0], [0, canvas.height - 1], [canvas.width - 1, canvas.height - 1]].every(([x, y]) => context.getImageData(x, y, 1, 1).data[3] !== 0))
        {
            throw new Error('The poster includes an opaque backdrop. Capture the isolated studio canvas.');
        }
        for (let step = 18; step >= 8; step -= 1)
        {
            const quality = step / 20;
            const url = canvas.toDataURL('image/webp', quality);
            const bytes = Math.floor((url.length - 'data:image/webp;base64,'.length) * 0.75);
            if (bytes <= limit)
            {
                return { url, quality, width: canvas.width, height: canvas.height };
            }
        }
        return null;
    }, { source: `data:image/png;base64,${ png.toString('base64') }`, limit: poster.budget, width: poster.outputWidth, height: poster.outputHeight });
    await page.close();
    return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
{
    for (const set of ['desktop', 'phone'])
    {
        const served = await fetch(`${ BASE }/world/showcase-${ set }.glb`).then((response) => response.arrayBuffer()).catch(() => null);
        const local = readFileSync(join(WORLD, `showcase-${ set }.glb`));
        if (served === null || !local.equals(Buffer.from(served)))
        {
            console.error(`  ${ BASE } does not serve this checkout's showcase-${ set }.glb - build, restart the server, then capture`);
            process.exit(1);
        }
    }

    const browser = await launchChrome({ headless: false, args: ['--use-angle=d3d11', '--window-position=-2400,0'] });
    let failed = false;
    for (const poster of [...POSTERS, ...TABLE_STILLS])
    {
        const png = await capture(browser, poster);
        const webp = await encode(browser, png, poster);
        if (webp === null)
        {
            failed = true;
            console.log(`  ${ poster.file.padEnd(24) } could not fit ${ poster.budget / 1024 } KB`);
            continue;
        }
        const bytes = Buffer.from(webp.url.split(',')[1], 'base64');
        writeFileSync(join(WORLD, poster.file), bytes);
        console.log(`  ${ poster.file.padEnd(24) } ${ webp.width }x${ webp.height }  ${ (bytes.length / 1024).toFixed(1) } KB  q${ webp.quality.toFixed(2) }`);
    }
    await browser.close();
    if (!failed)
    {
        writeFileSync(join(WORLD, 'poster.json'), `${ JSON.stringify({ inputs: fingerprint() }, null, 4) }\n`);
    }
    process.exit(failed ? 1 : 0);
}
