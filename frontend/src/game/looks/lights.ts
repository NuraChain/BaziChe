import type { Frame } from './frames.ts';

/**
 * Each collection's light: the colours every effect of its looks plays in, round its owner's
 * picture, where one of them is put on and at a table. A legendary collection's are its effect
 * families' own, so Inferno burns and Jade keeps its green wherever it plays.
 */
export const LIGHTS = {
    glow: ['#F6DEAB', '#A9C8F1', '#FAF4DE'],
    shiraz: ['#D7B676', '#95DACF', '#F9E7BA'],
    neon: ['#E692CC', '#67E7E9'],
    gold: ['#ECC87C', '#FFF5D0', '#D6B073'],
    inferno: ['#FFEAB6', '#EDB26E', '#ED8254', '#CE5344'],
    storm: ['#EDF8FC', '#A2E4E6', '#82B9DB', '#9A86C9'],
    astral: ['#F6F1EB', '#E9D098', '#63DBCC', '#B88DDA'],
    void: ['#EFDEFB', '#C39AE7', '#8559A5'],
    jade: ['#D7BA82', '#73B896'],
    frost: ['#F4FCFB', '#D0EDF0', '#A2D2E3'],
    phoenix: ['#FFEDB8', '#F0C981', '#EE9864', '#D45B5E'],
    oni: ['#65DCDD', '#E96665', '#A996D2']
} as const satisfies Record<Frame, readonly string[]>;
