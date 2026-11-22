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
        piece: ['#B6BBC8', '#4E67AA', '#17223C'],
        pale: ['#FDF7EA', '#DAE1ED', '#A7B6D1'],
        deep: ['#8AA7DE', '#304889', '#15203F'],
        surface: ['#425A93', '#263A5F', '#17223C'],
        edge: '#F3D99F',
        glint: '#FDF3D2',
        ink: '#FEF8E3',
        die: { face: ['#F8F7F4', '#D6E2F6', '#A8BEE6'], pip: '#0F1D47' },
        ground: ['#263A5F', '#1D2B49', '#17223C'],
        pattern: 'sparkle'
    },
    shiraz: {
        piece: ['#A3C8AC', '#44A69E', '#12303C'],
        pale: ['#FDF5E2', '#DCEBDE', '#B1C7BB'],
        deep: ['#6BA4B1', '#19647A', '#0F2F44'],
        surface: ['#217078', '#1B505E', '#12303C'],
        edge: '#D7B676',
        glint: '#F9E7BA',
        ink: '#FCF2D7',
        die: { face: ['#FCFAF0', '#DFF0E8', '#B8D6CC'], pip: '#0D3A55' },
        ground: ['#1B505E', '#153B49', '#12303C'],
        pattern: 'girih'
    },
    neon: {
        piece: ['#BAB5DB', '#78529D', '#16182C'],
        pale: ['#F3FBFC', '#E2DCF6', '#A8A1CE'],
        deep: ['#595A7F', '#3E2E5B', '#121321'],
        surface: ['#5F4483', '#282548', '#16182C'],
        edge: '#E08DCA',
        glint: '#DDF8FC',
        ink: '#EFFAF7',
        die: { face: ['#423C64', '#2A1E43', '#0E0C1C'], pip: '#79F1FF' },
        ground: ['#282548', '#1D1C36', '#16182C'],
        pattern: 'grid'
    },
    gold: {
        piece: ['#DFC78C', '#BD9A59', '#221F18'],
        pale: ['#FFF4C7', '#EDCC6E', '#8D6E23'],
        deep: ['#675B45', '#504025', '#1B1711'],
        surface: ['#7B623A', '#393026', '#221F18'],
        edge: '#ECC87C',
        glint: '#FFF0BA',
        ink: '#FFF6D7',
        die: { face: ['#FFF5CB', '#EAC864', '#AB8B3D'], pip: '#1E180B' },
        ground: ['#393026', '#2B251D', '#221F18'],
        pattern: 'filigree'
    },
    inferno: {
        piece: ['#E2A47D', '#A54230', '#261A1C'],
        pale: ['#FFEDCE', '#F9CF9D', '#D09F65'],
        deep: ['#6F513F', '#55261D', '#1D1213'],
        surface: ['#8A3A2D', '#4D2827', '#261A1C'],
        edge: '#EAAB67',
        glint: '#FFEAB6',
        ink: '#FFF3D5',
        die: { face: ['#54382C', '#3A1A14', '#140C0C'], pip: '#FFC868' },
        ground: ['#4D2827', '#351F20', '#261A1C'],
        pattern: 'magma'
    },
    storm: {
        piece: ['#AEBECF', '#4E6785', '#172433'],
        pale: ['#F7FBFC', '#DAE3EF', '#A8B5C7'],
        deep: ['#5E6A7A', '#314054', '#141D29'],
        surface: ['#435A74', '#293C50', '#172433'],
        edge: '#A1C3DE',
        glint: '#EDF8FC',
        ink: '#F6FAF7',
        die: { face: ['#F2F7FB', '#D4DDEA', '#A8B5CA'], pip: '#15214A' },
        ground: ['#293C50', '#1E2D3D', '#172433'],
        pattern: 'bolts'
    },
    astral: {
        piece: ['#BBA7AA', '#5B437B', '#17142E'],
        pale: ['#FBF6E9', '#EEE3CF', '#C7B999'],
        deep: ['#624E7A', '#352555', '#14102B'],
        surface: ['#4B3869', '#281E41', '#17142E'],
        edge: '#E1C28C',
        glint: '#FBEDC4',
        ink: '#FDF5DC',
        die: { face: ['#48346C', '#281848', '#100A26'], pip: '#FFE9A2' },
        ground: ['#281E41', '#1E1835', '#17142E'],
        pattern: 'stars'
    },
    void: {
        piece: ['#BCA4CE', '#694D87', '#171527'],
        pale: ['#EFE6FB', '#D2BFEF', '#A08CC8'],
        deep: ['#524665', '#332646', '#10101C'],
        surface: ['#573F71', '#2C1F3E', '#171527'],
        edge: '#C0A4E3',
        glint: '#EFDEFB',
        ink: '#F7EEF6',
        die: { face: ['#382D4A', '#20172F', '#0A0912'], pip: '#D6B6FF' },
        ground: ['#2C1F3E', '#1F192F', '#171527'],
        pattern: 'fractures'
    },
    jade: {
        piece: ['#A9C7A1', '#57A281', '#112F28'],
        pale: ['#F4F6E0', '#CCEBD1', '#9BC5A7'],
        deep: ['#66A279', '#1F634C', '#0E3126'],
        surface: ['#2E7561', '#1A5044', '#112F28'],
        edge: '#CFAD72',
        glint: '#F5E9BE',
        ink: '#FAF3D9',
        die: { face: ['#EEFAE9', '#C6EED5', '#95CFAE'], pip: '#0D3829' },
        ground: ['#1A5044', '#153B32', '#112F28'],
        pattern: 'scales'
    },
    frost: {
        piece: ['#B8DAE4', '#7BB3C9', '#142B3C'],
        pale: ['#F9FDFD', '#E3F1F8', '#B5CBDA'],
        deep: ['#7497B0', '#325C78', '#13273B'],
        surface: ['#477289', '#22455D', '#142B3C'],
        edge: '#C0DFEA',
        glint: '#F1FDFD',
        ink: '#F8FCF7',
        die: { face: ['#F8FCFE', '#E0F0FA', '#B6D4E8'], pip: '#133755' },
        ground: ['#22455D', '#193548', '#142B3C'],
        pattern: 'crystals'
    },
    phoenix: {
        piece: ['#E8B189', '#B45645', '#301F21'],
        pale: ['#FFF4D4', '#FADEA7', '#D8B56C'],
        deep: ['#9C4E40', '#772D26', '#321616'],
        surface: ['#9C4A3F', '#622E32', '#301F21'],
        edge: '#EBBE72',
        glint: '#FFEDB8',
        ink: '#FFF5D6',
        die: { face: ['#FFF6DA', '#FCE0A4', '#E8BC63'], pip: '#5F1816' },
        ground: ['#622E32', '#432427', '#301F21'],
        pattern: 'feathers'
    },
    oni: {
        piece: ['#D99F96', '#983747', '#241A24'],
        pale: ['#FCF3E9', '#E2E3E2', '#9DC7CA'],
        deep: ['#6E4449', '#511D28', '#1D1118'],
        surface: ['#80313F', '#47232E', '#241A24'],
        edge: '#D57F74',
        glint: '#FCEAD0',
        ink: '#FEF3E2',
        die: { face: ['#482A32', '#32121A', '#120A0E'], pip: '#70E8EE' },
        ground: ['#47232E', '#311D28', '#241A24'],
        pattern: 'circuits'
    }
} as const satisfies Record<ShopCollection, Palette>;

/** The Ludo seats' own paint (`PAINT` in `tools/art/boards.mjs`), which a set of pawns keeps as its body. */
export const SEAT_RAMPS = {
    red: ['#FFB8A6', '#EF675E', '#AA3D43'],
    green: ['#92E5BE', '#23AF74', '#19714E'],
    yellow: ['#FFE49A', '#F3B93A', '#9D651A'],
    blue: ['#A9CDFD', '#3E89F2', '#2F58A8']
} as const satisfies Record<string, Ramp>;
