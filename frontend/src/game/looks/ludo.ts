import type { Flow } from '../vfx/engine.ts';
import type { Collection } from './table.ts';

/** A pawn's trail, as wide as this many cells and this much denser than the engine's own, so it reads behind a pawn. */
export const TRAIL_CELLS = 1.8;

export const TRAIL_DENSITY = 1.4;

/** The puff where a pawn in a look lands and the ring where it leaves its yard, as wide as this many cells. */
export const ARRIVAL_CELLS = 1.4;

/**
 * What a pawn in a look leaves behind as it walks: the trail in its collection's light, and from a
 * legendary collection's its own stream shed along it. Astral's comet is a trail of its own.
 */
export const TRAILS = {
    glow: ['trail'],
    shiraz: ['trail'],
    neon: ['trail'],
    gold: ['trail'],
    inferno: ['trail', 'cinders'],
    storm: ['trail', 'static'],
    astral: ['comet'],
    void: ['trail', 'wisps'],
    jade: ['trail', 'runes'],
    frost: ['trail', 'glints'],
    phoenix: ['trail', 'feathers'],
    oni: ['trail', 'pixels']
} as const satisfies Record<Collection, readonly Flow[]>;
