// A deck of cards drawn in a dress: its paper, each suit's ink, and the metal of its courts. The
// classic deck (deck.mjs) and every look's deck (table-looks.mjs) are the same cards in another
// dress, so a look keeps the standard indices and pips where every card has them.

import { SUIT_PATH } from './suits.mjs';

export const W = 204;
export const H = 288;
const CX = W / 2;
const CY = H / 2;

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

const SERIF = 'Georgia, \'Times New Roman\', \'Noto Serif\', serif';

const L = 64;
const R = W - 64;
const TOP = 62;
const BOTTOM = H - 62;
const ROW_A = TOP + (BOTTOM - TOP) / 3;
const ROW_B = TOP + (BOTTOM - TOP) * 2 / 3;

const PIPS = {
    2: [[CX, TOP], [CX, BOTTOM]],
    3: [[CX, TOP], [CX, CY], [CX, BOTTOM]],
    4: [[L, TOP], [R, TOP], [L, BOTTOM], [R, BOTTOM]],
    5: [[L, TOP], [R, TOP], [CX, CY], [L, BOTTOM], [R, BOTTOM]],
    6: [[L, TOP], [R, TOP], [L, CY], [R, CY], [L, BOTTOM], [R, BOTTOM]],
    7: [[L, TOP], [R, TOP], [CX, (TOP + CY) / 2], [L, CY], [R, CY], [L, BOTTOM], [R, BOTTOM]],
    8: [[L, TOP], [R, TOP], [CX, (TOP + CY) / 2], [L, CY], [R, CY], [CX, (CY + BOTTOM) / 2], [L, BOTTOM], [R, BOTTOM]],
    9: [[L, TOP], [R, TOP], [L, ROW_A], [R, ROW_A], [CX, CY], [L, ROW_B], [R, ROW_B], [L, BOTTOM], [R, BOTTOM]],
    10: [[L, TOP], [R, TOP], [CX, (TOP + ROW_A) / 2], [L, ROW_A], [R, ROW_A], [L, ROW_B], [R, ROW_B], [CX, (ROW_B + BOTTOM) / 2], [L, BOTTOM], [R, BOTTOM]]
};

/** The classic deck: white paper, black and red, gold courts. */
export const CLASSIC = {
    paper: ['#FFFFFF', '#F6F2EA'],
    suits: [
        { name: 'club', ink: '#1B2233', tint: '#EEF1F7', accent: '#23304F' },
        { name: 'diamond', ink: '#D0213A', tint: '#FDEEEF', accent: '#A3162B' },
        { name: 'heart', ink: '#D0213A', tint: '#FDEEEF', accent: '#A3162B' },
        { name: 'spade', ink: '#1B2233', tint: '#EEF1F7', accent: '#23304F' }
    ],
    metal: { band: '#D4A73A', line: '#8C6A1C', frame: '#C9A24A', crown: '#E3B64B', jewel: '#FFFFFF' }
};

const round = (value) => Math.round(value * 100) / 100;

function pip(suit, x, y, scale)
{
    const flip = y > CY + 1 ? ` rotate(180)` : '';

    return `<use href="#${ suit.name }" transform="translate(${ round(x) } ${ round(y) })${ flip } scale(${ scale })" fill="${ suit.ink }"/>`;
}

function index(rank, suit)
{
    const wide = rank === '10';

    return `<g>
    <text x="${ wide ? 26 : 25 }" y="46" font-family="${ SERIF }" font-size="${ wide ? 36 : 44 }" font-weight="700" text-anchor="middle" fill="${ suit.ink }"${ wide ? ' letter-spacing="-2"' : '' }>${ rank }</text>
    <use href="#${ suit.name }" transform="translate(25 72) scale(0.95)" fill="${ suit.ink }"/>
</g>`;
}

const CROWNS = {
    K: 'M-30 14L-30 -8L-17 4L-8 -18L0 0L8 -18L17 4L30 -8L30 14Z',
    Q: 'M-27 14C-27 -2-15 -13 0 -16C15 -13 27 -2 27 14Z',
    J: 'M-24 14C-24 -6-8 -16 8 -13C18 -11 24 -3 24 14Z'
};

function court(rank, suit, metal)
{
    const band = `<rect x="-31" y="13" width="62" height="9" rx="2" fill="${ metal.band }" stroke="${ metal.line }" stroke-width="1.5"/>`;
    const jewels = rank === 'K'
        ? `<circle cx="-17" cy="4" r="3" fill="${ metal.jewel }"/><circle cx="0" cy="0" r="3.4" fill="` + suit.accent + `"/><circle cx="17" cy="4" r="3" fill="${ metal.jewel }"/><circle cx="-30" cy="-8" r="3" fill="${ metal.band }"/><circle cx="-8" cy="-18" r="3" fill="${ metal.band }"/><circle cx="8" cy="-18" r="3" fill="${ metal.band }"/><circle cx="30" cy="-8" r="3" fill="${ metal.band }"/>`
        : rank === 'Q'
            ? '<circle cx="0" cy="-17" r="5" fill="' + suit.accent + `" stroke="${ metal.line }" stroke-width="1.5"/><path d="M-18 6Q0 -8 18 6" fill="none" stroke="${ metal.jewel }" stroke-opacity="0.8" stroke-width="2"/>`
            : '<path d="M8 -13C20 -30 36 -30 40 -22C30 -22 22 -16 14 -9Z" fill="' + suit.accent + `" stroke="${ metal.line }" stroke-width="1.5"/>`;
    const crownFill = rank === 'J' ? suit.accent : metal.crown;
    const half = `<g transform="translate(${ CX } 74)">
        <path d="${ CROWNS[rank] }" fill="${ crownFill }" stroke="${ metal.line }" stroke-width="2" stroke-linejoin="round"/>
        ${ band }
        ${ jewels }
        <use href="#${ suit.name }" transform="translate(0 44) scale(1.05)" fill="${ suit.ink }"/>
    </g>`;

    return `<g>
    <rect x="40" y="32" width="${ W - 80 }" height="${ H - 64 }" rx="8" fill="${ suit.tint }" stroke="${ metal.frame }" stroke-width="3"/>
    <rect x="46" y="38" width="${ W - 92 }" height="${ H - 76 }" rx="5" fill="url(#court-${ suit.name })" stroke="${ suit.accent }" stroke-opacity="0.35" stroke-width="1.5"/>
    <path d="M46 ${ CY }H${ W - 46 }" stroke="${ metal.frame }" stroke-width="2"/>
    ${ half }
    <g transform="rotate(180 ${ CX } ${ CY })">${ half }</g>
</g>`;
}

function ace(suit, metal)
{
    const big = suit.name === 'spade' ? 3.7 : 3.1;
    const ring = suit.name === 'spade'
        ? `<circle cx="${ CX }" cy="${ CY }" r="68" fill="none" stroke="${ metal.frame }" stroke-width="2.5"/><circle cx="${ CX }" cy="${ CY }" r="62" fill="none" stroke="${ metal.frame }" stroke-opacity="0.45" stroke-width="1.5"/>`
        : '';

    return `${ ring }<use href="#${ suit.name }" transform="translate(${ CX } ${ CY + 4 }) scale(${ big })" fill="${ suit.ink }"/>`;
}

function face(rank, suit, metal, column, row, ornament)
{
    let middle;

    if (rank === 'A')
    {
        middle = ace(suit, metal);
    }
    else if (rank === 'J' || rank === 'Q' || rank === 'K')
    {
        middle = court(rank, suit, metal);
    }
    else
    {
        middle = PIPS[Number(rank)].map(([x, y]) => pip(suit, x, y, 1.42)).join('');
    }

    return `<g transform="translate(${ column * W } ${ row * H })">
    <rect width="${ W }" height="${ H }" fill="url(#paper)"/>${ ornament }
    ${ index(rank, suit) }
    <g transform="rotate(180 ${ CX } ${ CY })">${ index(rank, suit) }</g>
    ${ middle }
</g>`;
}

/**
 * Every card of a deck in one sprite, thirteen ranks across and four suits down, in `dress`;
 * `ornament` is drawn on every card's paper under its index, and `defs` beside the deck's own.
 */
export function deck(dress = CLASSIC, { ornament = '', defs = '' } = {})
{
    const cards = [];

    dress.suits.forEach((suit, row) =>
    {
        RANKS.forEach((rank, column) => cards.push(face(rank, suit, dress.metal, column, row, ornament)));
    });

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ W * 13 } ${ H * 4 }" width="${ W * 13 }" height="${ H * 4 }">
<defs>
    ${ Object.entries(SUIT_PATH).map(([name, d]) => `<path id="${ name }" d="${ d }"/>`).join('\n    ') }
    <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ dress.paper[0] }"/><stop offset="1" stop-color="${ dress.paper[1] }"/></linearGradient>
    ${ dress.suits.map((suit) => `<pattern id="lattice-${ suit.name }" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0H10M0 0V10" stroke="${ suit.accent }" stroke-opacity="0.12" stroke-width="1.2"/></pattern>
    <linearGradient id="court-${ suit.name }" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ suit.tint }"/><stop offset="0.5" stop-color="${ dress.paper[0] }"/><stop offset="1" stop-color="${ suit.tint }"/></linearGradient>`).join('\n    ') }${ defs }
</defs>
${ cards.join('\n') }
</svg>
`;
}
