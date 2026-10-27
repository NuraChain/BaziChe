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

    /** Its pattern; a legendary collection's is drawn by its own module in `tools/art/legendary/`. */
    pattern: 'sparkle' | 'girih' | 'grid' | 'filigree' | 'magma' | 'bolts' | 'stars' | 'fractures' | 'scales' | 'crystals' | 'feathers' | 'circuits';
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
    },
    inferno: {
        piece: ['#6B4A3C', '#2A1812', '#120807'],
        pale: ['#FFF4E2', '#FFDDA8', '#F0B46A'],
        deep: ['#4A2418', '#22100A', '#0C0503'],
        surface: ['#3E1D12', '#22100A', '#120807'],
        edge: '#FFB43A',
        glint: '#FFE7A1',
        ink: '#FFE2B0',
        die: { face: ['#3A2018', '#1E0F0A', '#0C0604'], pip: '#FFB43A' },
        ground: ['#2A120A', '#160905', '#080302'],
        pattern: 'magma'
    },
    storm: {
        piece: ['#C9D4E6', '#5A6884', '#0D1424'],
        pale: ['#FFFFFF', '#E6EEFA', '#BCCBE2'],
        deep: ['#3A4458', '#1E2534', '#0B0F18'],
        surface: ['#22304E', '#141E36', '#0D1424'],
        edge: '#3FA9FF',
        glint: '#EAF6FF',
        ink: '#EAF6FF',
        die: { face: ['#EEF3FA', '#CDD7E6', '#A7B5CC'], pip: '#142057' },
        ground: ['#1B2440', '#0F1530', '#060918'],
        pattern: 'bolts'
    },
    astral: {
        piece: ['#C9B6FF', '#5B2A9E', '#1A0A3A'],
        pale: ['#FFFFFF', '#FFF6D9', '#E9D9A8'],
        deep: ['#3A1E6E', '#1C0C3E', '#0A0420'],
        surface: ['#2A1458', '#170A36', '#080318'],
        edge: '#4FE3D8',
        glint: '#FFE58A',
        ink: '#F7F2FF',
        die: { face: ['#2E1A5E', '#1A0C3A', '#0B0420'], pip: '#FFE58A' },
        ground: ['#1E0E42', '#100626', '#0A0820'],
        pattern: 'stars'
    },
    void: {
        piece: ['#3A2A4E', '#140C1E', '#030106'],
        pale: ['#F3EAFF', '#D9C4FA', '#B497E8'],
        deep: ['#241838', '#0E0818', '#030106'],
        surface: ['#1A1028', '#0C0614', '#030106'],
        edge: '#A855F7',
        glint: '#E9D5FF',
        ink: '#EFE4FF',
        die: { face: ['#1E1430', '#0E0818', '#050209'], pip: '#C79BFF' },
        ground: ['#120A1E', '#08040F', '#020104'],
        pattern: 'fractures'
    },
    jade: {
        piece: ['#BFF2D9', '#2BB67F', '#0E5A3D'],
        pale: ['#F4FFF8', '#D2F5E2', '#A8E3C4'],
        deep: ['#167A54', '#0B4A33', '#052A1C'],
        surface: ['#13684A', '#0B4A35', '#05281C'],
        edge: '#F2C14E',
        glint: '#FFF1C4',
        ink: '#FFF8E1',
        die: { face: ['#E8FFF2', '#BFF2D9', '#8FD9B5'], pip: '#0B3D2A' },
        ground: ['#0E3A2A', '#08251B', '#03130D'],
        pattern: 'scales'
    },
    frost: {
        piece: ['#FFFFFF', '#BFE6FF', '#5FA8D9'],
        pale: ['#FFFFFF', '#EEF8FF', '#CFE8FA'],
        deep: ['#2E5F86', '#173A5A', '#0A1E33'],
        surface: ['#2C5A80', '#173A58', '#0A1E33'],
        edge: '#8FD3FF',
        glint: '#F2FBFF',
        ink: '#F2FAFF',
        die: { face: ['#F7FCFF', '#DDF0FC', '#B6DDF5'], pip: '#123E63' },
        ground: ['#173A58', '#0C2238', '#0A1A2B'],
        pattern: 'crystals'
    },
    phoenix: {
        piece: ['#FFE9A8', '#FF8A2A', '#B0261A'],
        pale: ['#FFFBEA', '#FFEBB0', '#F7CF70'],
        deep: ['#8E1E1A', '#57100E', '#2A0606'],
        surface: ['#7A1E14', '#4D120C', '#220605'],
        edge: '#FFC94A',
        glint: '#FFF6D6',
        ink: '#FFF3D0',
        die: { face: ['#FFF8E1', '#FFE3A0', '#F7C25A'], pip: '#7A1410' },
        ground: ['#3A0E08', '#220705', '#100302'],
        pattern: 'feathers'
    },
    oni: {
        piece: ['#4A1E2E', '#1E0B14', '#08030A'],
        pale: ['#FFFFFF', '#E6FBFF', '#A8EEF8'],
        deep: ['#4A0F1E', '#24060E', '#0C0205'],
        surface: ['#2A0A16', '#16050B', '#070205'],
        edge: '#FF2E4D',
        glint: '#20E6FF',
        ink: '#F5FEFF',
        die: { face: ['#22101A', '#12060C', '#060205'], pip: '#20E6FF' },
        ground: ['#1C0610', '#0E0308', '#050103'],
        pattern: 'circuits'
    }
} as const satisfies Record<ShopCollection, Palette>;

/** The Ludo seats' own paint (`PAINT` in `tools/art/boards.mjs`), which a set of pawns keeps as its body. */
export const SEAT_RAMPS = {
    red: ['#FF9489', '#FF5A4E', '#D8372D'],
    green: ['#74DE96', '#2FC262', '#1B9646'],
    yellow: ['#FFE07A', '#FFC72C', '#DE9C00'],
    blue: ['#86B6FF', '#3F8CFF', '#2463D1']
} as const satisfies Record<string, Ramp>;
