import type { Frame } from './frames.ts';

/**
 * Each collection's light: the colours every effect of its looks plays in, round its owner's
 * picture, where one of them is put on and at a table. A legendary collection's are its effect
 * families' own, so Inferno burns and Jade keeps its green wherever it plays.
 */
export const LIGHTS = {
    glow: ['#FBE7A6', '#9CC2FF', '#FFFFFF'],
    shiraz: ['#E7BE63', '#B9F0E8', '#FFF4D6'],
    neon: ['#FF46D2', '#38E8FF'],
    gold: ['#E9C565', '#FFFAE6', '#D9B044'],
    inferno: ['#FFF1C1', '#FFC14D', '#FF7A1F', '#E2381C'],
    storm: ['#EAF6FF', '#7DF0FF', '#3FA9FF', '#8B5CFF'],
    astral: ['#FFFFFF', '#FFE58A', '#4FE3D8', '#B04BFF'],
    void: ['#E9D5FF', '#A855F7', '#5B21B6'],
    jade: ['#F2C14E', '#2BB67F'],
    frost: ['#FFFFFF', '#DFF3FF', '#8FD3FF'],
    phoenix: ['#FFF6D6', '#FFC94A', '#FF7A1A', '#D7263D'],
    oni: ['#20E6FF', '#FF2E4D', '#7C5CFF']
} as const satisfies Record<Frame, readonly string[]>;
