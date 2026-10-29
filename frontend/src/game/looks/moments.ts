import type { Rect } from '../motion.ts';
import type { Moment } from '../sound-files.ts';
import type { Flow, Point, Step, Tune } from '../vfx/engine.ts';
import { BORNE, ENTRIES, PAIR } from './backgammon.ts';
import { playAt } from './cards.ts';
import { cheerAt } from './celebrations.ts';
import { CASTLES, CHECKS, FINALES, LANDING, MATE_SQUARES } from './chess.ts';
import { enterAt } from './entrances.ts';
import { ARRIVAL_CELLS, TRAILS, TRAIL_CELLS, TRAIL_DENSITY } from './ludo.ts';
import { burstOf, CAPTURES, CRITICALS, lightOf, type Collection } from './table.ts';

/** Every moment a table plays a look at, by the stage the fitting room plays it on. */
export const STAGES = {
    ludo: ['die', 'six', 'walk', 'spawn', 'capture', 'entrance', 'set', 'win'],
    cards: ['card', 'entrance', 'set', 'win'],
    backgammon: ['die', 'doubles', 'hit', 'entry', 'borne', 'entrance', 'set', 'win'],
    chess: ['piece', 'castle', 'check', 'capture', 'promotion', 'mate', 'entrance', 'set', 'win']
} as const;

export type Stage = keyof typeof STAGES;

export type TableMoment = (typeof STAGES)[Stage][number];

/** How wide a thing at a table is, in CSS pixels, that an effect played at a scale of 1 suits, as at every board. */
const FITS = 40;

export interface Played
{
    steps: readonly Step[];
    at: Point;
    tune: Tune;
    voice: Moment | null;
}

/**
 * What a table plays for a moment in a collection where it happens, and the voice it says it in,
 * each as the boards play it: `place` is the thing the moment happens to (a die, a pawn's cell, a
 * checker, a square, a card, or the corner a seat enters and wins from), and the moment is sized to
 * it as the board sizes it.
 */
export function momentOf(moment: TableMoment, collection: Collection, place: Rect): Played
{
    const at = { x: place.x + place.width / 2, y: place.y + place.height / 2 };
    const said = (steps: readonly Step[], voice: Moment | null, size = 1): Played => ({ steps, at, tune: { colors: lightOf(collection), scale: place.width * size / FITS }, voice });

    switch (moment)
    {
        case 'die':
            return said([{ effect: burstOf(collection).effect }], 'die');
        case 'six':
            return said(CRITICALS[collection], 'die');
        case 'doubles':
            return said(CRITICALS[collection], 'die', PAIR);
        case 'walk':
            return said([{ effect: 'dust' }], 'pawn', ARRIVAL_CELLS);
        case 'spawn':
            return said([{ effect: 'shockwave' }], 'spawn', ARRIVAL_CELLS);
        case 'capture':
        case 'hit':
            return said(CAPTURES[collection], 'capture');
        case 'entry':
            return said(ENTRIES[collection], 'spawn');
        case 'borne':
            return said(BORNE[collection], 'pawn');
        case 'piece':
            return said([{ effect: burstOf(collection).effect, tune: LANDING }], 'pawn');
        case 'castle':
            return said(CASTLES[collection], 'pawn');
        case 'check':
            return said(CHECKS[collection], null);
        case 'promotion':
            return said(CRITICALS[collection], 'spawn');
        case 'mate':
            return said([...CRITICALS[collection], FINALES[collection]], 'capture', MATE_SQUARES);
        case 'card':
            return { ...playAt(collection, place), voice: 'card' };
        case 'entrance':
        case 'set':
            return { ...enterAt({ collection, full: moment === 'set' }, at, place.width), voice: 'spawn' };
        case 'win':
            return { ...cheerAt(collection, at, place.width), voice: 'victory' };
    }
}

/** What a pawn in a collection leaves behind as it walks across cells `cell` pixels wide: its streams, in its light. */
export function trailOf(collection: Collection, cell: number): { flows: readonly Flow[]; tune: Tune }
{
    return { flows: TRAILS[collection], tune: { colors: lightOf(collection), scale: cell * TRAIL_CELLS / FITS, density: TRAIL_DENSITY } };
}

/** The playground's knobs: each a factor over a moment as its table plays it, and a seed that plays it the same way every time. */
export interface Knobs
{
    intensity: number;
    speed: number;
    density: number;
    size: number;
    seed?: number;
}

/** A moment played with the playground's knobs, laid on every layer of it, so that a layer of its own strength keeps its strength beside the others. */
export function retune(played: Played, knobs: Knobs): Played
{
    const over = (tune: Tune = {}): Tune => ({
        ...tune,
        intensity: (tune.intensity ?? 1) * knobs.intensity,
        speed: (tune.speed ?? 1) * knobs.speed,
        density: (tune.density ?? 1) * knobs.density
    });

    return {
        ...played,
        steps: played.steps.map((step) => (step.tune === undefined ? step : { ...step, tune: over(step.tune) })),
        tune: { ...over(played.tune), scale: (played.tune.scale ?? 1) * knobs.size, ...(knobs.seed === undefined ? {} : { seed: knobs.seed }) }
    };
}
