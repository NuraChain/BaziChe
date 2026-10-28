import type { Flow } from '../vfx/engine.ts';
import type { Collection } from './table.ts';

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
