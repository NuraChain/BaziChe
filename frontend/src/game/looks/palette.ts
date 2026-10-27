import type { ShopCollection } from '../../../../backend/src/domains/shop/catalogue.ts';

/** Three stops of one material, from where the light falls to where it does not. */
export type Ramp = readonly [lit: string, mid: string, dark: string];

/**
 * A collection's colours and materials. Every one of its looks is drawn from these alone, in the
 * art `tools/art/looks.mjs` writes and at the tables, so a collection reads as one thing anywhere.
 */
export interface Palette
{
    /** What the collection is made of: glass, glazed tile, obsidian, polished gold. */
    piece: Ramp;

    /** The two sides of a two-sided set (checkers, chess), far apart in light so two sets on one board still read as two sides. */
    pale: Ramp;
    deep: Ramp;

    /** A flat thing in it: a card back, a plate, a board's ground. */
    surface: Ramp;

    /** Its lines and rims. */
    edge: string;

    /** The light it catches: a sparkle, the glaze, the second neon, a gold highlight. */
    glint: string;

    /** What is written on a surface, at 4.5:1 or more against every stop of it. */
    ink: string;

    /** A die's face and its pips, held to 4.5:1 against each other. */
    die: { face: Ramp; pip: string };

    /** Where its looks are shown. */
    ground: Ramp;

    pattern: 'sparkle' | 'girih' | 'grid' | 'filigree';
}

export const PALETTES = {
    glow: {
        piece: ['#C7DBFF', '#4A7FE8', '#1B3480'],
        pale: ['#FFFFFF', '#E3EEFF', '#B8D0FA'],
        deep: ['#4A7FE8', '#1B3480', '#0B1640'],
        surface: ['#2448A8', '#13296B', '#0A1640'],
        edge: '#9CC2FF',
        glint: '#FBE7A6',
        ink: '#F8FAFC',
        die: { face: ['#F2F7FF', '#D3E3FF', '#A9C6FB'], pip: '#0B1A4D' },
        ground: ['#16285A', '#0E1838', '#080E22'],
        pattern: 'sparkle'
    },
    shiraz: {
        piece: ['#B9F0E8', '#18A8A0', '#0B4F63'],
        pale: ['#FFFFFF', '#EAF7F3', '#C6E6DF'],
        deep: ['#1A7FAE', '#0B4A75', '#06284A'],
        surface: ['#137187', '#0D5B7C', '#08324C'],
        edge: '#E7BE63',
        glint: '#FFF4D6',
        ink: '#FFFBEB',
        die: { face: ['#FCFFFE', '#E2F5F1', '#BFE4DD'], pip: '#0A3F63' },
        ground: ['#0E3B52', '#0A2639', '#061623'],
        pattern: 'girih'
    },
    neon: {
        piece: ['#4A3B78', '#1B1333', '#07040F'],
        pale: ['#FFFFFF', '#ECE7FF', '#BDB2EE'],
        deep: ['#3A2D63', '#1B1333', '#07040F'],
        surface: ['#22163F', '#110B24', '#05030C'],
        edge: '#FF46D2',
        glint: '#38E8FF',
        ink: '#F5F3FF',
        die: { face: ['#2A1E4A', '#160E2B', '#0A0616'], pip: '#3DEBFF' },
        ground: ['#1A0F33', '#0C0719', '#04020A'],
        pattern: 'grid'
    },
    gold: {
        piece: ['#FFF3BF', '#D9B044', '#7C5913'],
        pale: ['#FFF6D2', '#EFCB62', '#B88C22'],
        deep: ['#3A3020', '#1A140B', '#070503'],
        surface: ['#2C2415', '#17120A', '#080604'],
        edge: '#E9C565',
        glint: '#FFFAE6',
        ink: '#F4D47A',
        die: { face: ['#FFF6CF', '#E8C35A', '#B48A24'], pip: '#1B1404' },
        ground: ['#241C0E', '#120E07', '#060402'],
        pattern: 'filigree'
    }
} as const satisfies Record<ShopCollection, Palette>;

/** The Ludo seats' own paint (`PAINT` in `tools/art/boards.mjs`), which a set of pawns keeps as its body. */
export const SEAT_RAMPS = {
    red: ['#FF9489', '#FF5A4E', '#D8372D'],
    green: ['#74DE96', '#2FC262', '#1B9646'],
    yellow: ['#FFE07A', '#FFC72C', '#DE9C00'],
    blue: ['#86B6FF', '#3F8CFF', '#2463D1']
} as const satisfies Record<string, Ramp>;
