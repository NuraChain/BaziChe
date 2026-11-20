import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BAR_LEFT, BAR_WIDTH, BOTTOM, HEIGHT, POINT_WIDTH, TOP, WIDTH, columnOf } from '../../frontend/src/game/backgammon-layout.ts';
import { launchChrome } from '../chrome.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BOARD = join(HERE, '..', '..', 'frontend', 'public', 'board');
const OUT = join(HERE, 'scratch', 'art');

export const CARD_CODES = ['AH', 'KH', 'QH', 'JH', '10H', 'AS', 'KS', 'QS', 'JS', 'AD', 'KD', '10D', '7D'];

const SUIT_ROW = { C: 0, D: 1, H: 2, S: 3 };
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SPRITE = { width: 204, height: 288 };
const ATLAS = { width: 2048, height: 1024 };
const COLUMNS = 7;
const CELL = { width: Math.floor(ATLAS.width / COLUMNS), height: Math.floor(ATLAS.width / COLUMNS * SPRITE.height / SPRITE.width) };
const SURFACES = {
    ludo: { x: 0, y: 0, size: 1024 },
    chess: { x: 1024, y: 0, size: 512 },
    backgammon: { x: 1536, y: 0, size: 512 },
    hokm: { x: 1024, y: 512, size: 512 },
    poker: { x: 1536, y: 512, size: 512 }
};

const CHIP_COLOURS = [
    ['red', '#B91C1C', '#7F1111'],
    ['green', '#15803D', '#0E5A2A'],
    ['blue', '#1D4ED8', '#0F3A8C'],
    ['black', '#1E293B', '#020617'],
    ['gold', '#D97706', '#92400E']
];
const CHIP = { face: 204, edge: 40, width: 1020 };

const dataUrl = (file) => `data:image/${ file.endsWith('.webp') ? 'webp' : 'svg+xml' };base64,${ readFileSync(join(BOARD, file)).toString('base64') }`;

const sourceOf = (code) => ({
    x: RANKS.indexOf(code.slice(0, -1)) * SPRITE.width,
    y: SUIT_ROW[code.slice(-1)] * SPRITE.height
});

export async function rasterise()
{
    mkdirSync(OUT, { recursive: true });

    const cells = [...CARD_CODES, 'back'].map((code, index) => ({
        code,
        x: (index % COLUMNS) * CELL.width,
        y: Math.floor(index / COLUMNS) * CELL.height,
        width: CELL.width,
        height: CELL.height
    }));

    const browser = await launchChrome();
    try
    {
        const page = await browser.newPage();

        const atlas = await page.evaluate(async ({ deck, back, cells, sources, width, height }) =>
        {
            const load = (src) => new Promise((resolve, reject) =>
            {
                const image = new Image();
                image.onload = () => resolve(image);
                image.onerror = reject;
                image.src = src;
            });
            const [sprite, cover] = await Promise.all([load(deck), load(back)]);
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext('2d');
            context.fillStyle = '#ffffff';
            context.fillRect(0, 0, width, height);
            context.imageSmoothingQuality = 'high';
            for (const cell of cells)
            {
                if (cell.code === 'back')
                {
                    context.drawImage(cover, cell.x, cell.y, cell.width, cell.height);
                    continue;
                }
                const source = sources[cell.code];
                context.drawImage(sprite, source.x, source.y, 204, 288, cell.x, cell.y, cell.width, cell.height);
            }
            return canvas.toDataURL('image/png');
        }, {
            deck: dataUrl('deck.svg'),
            back: dataUrl('card-back.svg'),
            cells,
            sources: Object.fromEntries(CARD_CODES.map((code) => [code, sourceOf(code)])),
            width: ATLAS.width,
            height: ATLAS.height
        });

        const boards = await page.evaluate(async ({ sources, surfaces }) =>
        {
            const loaded = await Promise.all(sources.map((src) => new Promise((resolve, reject) =>
            {
                const element = new Image();
                element.onload = () => resolve(element);
                element.onerror = reject;
                element.src = src;
            })));
            const [ludo, chess, backgammon, hokm, frame, rosette, felt, medallion] = loaded;
            const canvas = document.createElement('canvas');
            canvas.width = 2048;
            canvas.height = 1024;
            const context = canvas.getContext('2d');
            context.imageSmoothingQuality = 'high';
            const paint = (name, fill, draw) =>
            {
                const { x, y, size } = surfaces[name];
                context.save();
                context.translate(x, y);
                context.beginPath();
                context.rect(0, 0, size, size);
                context.clip();
                context.fillStyle = fill;
                context.fillRect(0, 0, size, size);
                draw(size);
                context.restore();
            };
            for (const [name, picture] of [['ludo', ludo], ['chess', chess], ['backgammon', backgammon]])
            {
                paint(name, '#3A2820', (size) => context.drawImage(picture, 0, 0, size, size));
            }
            paint('hokm', '#3A2820', (size) =>
            {
                context.drawImage(hokm, 0, 0, size, size);
                context.drawImage(frame, 0, 0, size, size);
                context.drawImage(rosette, size * 0.32, size * 0.32, size * 0.36, size * 0.36);
            });
            paint('poker', '#093B33', (size) =>
            {
                const wash = context.createRadialGradient(size / 2, size * 0.42, 0, size / 2, size * 0.42, size * 0.65);
                wash.addColorStop(0, '#21907B');
                wash.addColorStop(0.46, '#17705F');
                wash.addColorStop(0.8, '#0E4E43');
                wash.addColorStop(1, '#093B33');
                context.fillStyle = wash;
                context.fillRect(0, 0, size, size);
                for (let y = 0; y < size; y += felt.height)
                {
                    for (let x = 0; x < size; x += felt.width)
                    {
                        context.drawImage(felt, x, y);
                    }
                }
                context.drawImage(medallion, size * 0.34, size * 0.285, size * 0.32, size * 0.43);
            });
            return canvas.toDataURL('image/png');
        }, {
            surfaces: SURFACES,
            sources: [
                'ludo-board.svg', 'chess/board.svg', 'backgammon-table.svg', 'hokm-table-tall.webp',
                'hokm-frame.svg', 'hokm-medallion.svg', 'poker-felt.svg', 'poker-medallion.svg'
            ].map(dataUrl)
        });

        const chipCells = CHIP_COLOURS.map(([name], index) => ({
            name,
            face: { x: index * CHIP.face, y: 0, width: CHIP.face, height: CHIP.face },
            edge: { x: 0, y: CHIP.face + index * CHIP.edge, width: CHIP.width, height: CHIP.edge }
        }));

        const chips = await page.evaluate(({ colours, cells, size }) =>
        {
            const canvas = document.createElement('canvas');
            canvas.width = size.width;
            canvas.height = size.height;
            const context = canvas.getContext('2d');
            const SPOTS = 8;
            cells.forEach((cell, index) =>
            {
                const [, body, rim] = colours[index];
                const { x, y, width } = cell.face;
                const radius = width / 2;
                const cx = x + radius;
                const cy = y + radius;
                context.fillStyle = body;
                context.beginPath();
                context.arc(cx, cy, radius, 0, Math.PI * 2);
                context.fill();
                context.fillStyle = '#F8FAFC';
                for (let spot = 0; spot < SPOTS; spot += 1)
                {
                    const angle = (spot / SPOTS) * Math.PI * 2;
                    context.save();
                    context.translate(cx, cy);
                    context.rotate(angle);
                    context.fillRect(radius * 0.74, -radius * 0.11, radius * 0.26, radius * 0.22);
                    context.restore();
                }
                context.strokeStyle = 'rgba(248, 250, 252, 0.85)';
                context.lineWidth = radius * 0.035;
                context.setLineDash([radius * 0.09, radius * 0.06]);
                context.beginPath();
                context.arc(cx, cy, radius * 0.64, 0, Math.PI * 2);
                context.stroke();
                context.setLineDash([]);
                context.fillStyle = rim;
                context.beginPath();
                context.arc(cx, cy, radius * 0.56, 0, Math.PI * 2);
                context.fill();
                context.fillStyle = body;
                context.beginPath();
                context.arc(cx, cy, radius * 0.5, 0, Math.PI * 2);
                context.fill();

                const edge = cell.edge;
                context.fillStyle = body;
                context.fillRect(edge.x, edge.y, edge.width, edge.height);
                context.fillStyle = '#F8FAFC';
                const stripe = edge.width / SPOTS;
                for (let spot = 0; spot < SPOTS; spot += 1)
                {
                    context.fillRect(edge.x + spot * stripe + stripe * 0.37, edge.y, stripe * 0.26, edge.height);
                }
            });
            return canvas.toDataURL('image/png');
        }, { colours: CHIP_COLOURS, cells: chipCells, size: { width: CHIP.width, height: CHIP.face + CHIP_COLOURS.length * CHIP.edge } });

        const write = (name, url) => writeFileSync(join(OUT, name), Buffer.from(url.split(',')[1], 'base64'));
        write('cards.png', atlas);
        write('boards.png', boards);
        write('chips.png', chips);
        writeFileSync(join(OUT, 'cards.json'), JSON.stringify({ ...ATLAS, cells }, null, 4));
        writeFileSync(join(OUT, 'boards.json'), JSON.stringify({ width: 2048, height: 1024, surfaces: SURFACES }, null, 4));
        const columns = Array.from({ length: 24 }, (_, index) => columnOf(index + 1));
        writeFileSync(join(OUT, 'backgammon.json'), JSON.stringify({
            width: WIDTH, height: HEIGHT, top: TOP, bottom: BOTTOM, bar: BAR_LEFT + BAR_WIDTH / 2,
            pointWidth: POINT_WIDTH, columns
        }, null, 4));
        writeFileSync(join(OUT, 'chips.json'), JSON.stringify({ width: CHIP.width, height: CHIP.face + CHIP_COLOURS.length * CHIP.edge, cells: chipCells }, null, 4));
    }
    finally
    {
        await browser.close();
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url))
{
    await rasterise();
    console.log(`  art         ${ OUT }`);
}
