import type { Point } from '../vfx/presets.ts';
import { CELEBRATIONS } from './celebrations.ts';
import { lightOf, wornOf, type Collection } from './table.ts';

type Kind = Parameters<typeof wornOf>[0];

/**
 * What a seat wears at each game, its celebration among it: one collection in every one of them is
 * that game's set. The first names the entrance, because it dresses the seat's own corner.
 */
export const SET_KINDS = {
    ludo: ['yard', 'dice', 'pawns', 'celebration'],
    hokm: ['felt', 'back', 'face', 'celebration'],
    poker: ['felt', 'back', 'face', 'chips', 'celebration'],
    backgammon: ['home', 'dice', 'checkers', 'celebration'],
    chess: ['pieces', 'celebration']
} as const satisfies Record<string, readonly Kind[]>;

export type EntranceGame = keyof typeof SET_KINDS;

export interface Entrance
{
    collection: Collection;
    full: boolean;
}

/** An entrance plays its celebration's first layers, the gathering and the impact; a set plays every one. */
const LAYERS = 2;

/** How wide a place an entrance fills at scale 1, and the most it is scaled to: past that its bolts smear. */
const ENTER_FITS = 40;

export const ENTER_MOST = 2.4;

/** The collection a seat enters the table in and whether it wears that collection's whole set there, or null for a corner in Classic. */
export function entranceOf(game: EntranceGame, look: Partial<Record<Kind, string>> | undefined)
{
    const [corner, ...rest] = SET_KINDS[game];
    const collection = wornOf(corner, look?.[corner]);

    return collection === null ? null : { collection, full: rest.every((kind) => wornOf(kind, look?.[kind]) === collection) };
}

/** An entrance risen from `at`, in a place `across` pixels wide. */
export function enterAt(entrance: Entrance, at: Point, across: number)
{
    const steps = CELEBRATIONS[entrance.collection];

    return { steps: entrance.full ? steps : steps.slice(0, LAYERS), at, tune: { colors: lightOf(entrance.collection), scale: Math.min(ENTER_MOST, across / ENTER_FITS) } };
}
