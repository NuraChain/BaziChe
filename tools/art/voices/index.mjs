/**
 * Every collection's voice, one module each: a function a moment, drawing one take of it from a
 * seed. Adding a collection is one module here beside its palette and its art.
 */
import { voice as astral } from './astral.mjs';
import { voice as frost } from './frost.mjs';
import { voice as glow } from './glow.mjs';
import { voice as gold } from './gold.mjs';
import { voice as inferno } from './inferno.mjs';
import { voice as jade } from './jade.mjs';
import { voice as neon } from './neon.mjs';
import { voice as oni } from './oni.mjs';
import { voice as phoenix } from './phoenix.mjs';
import { voice as shiraz } from './shiraz.mjs';
import { voice as storm } from './storm.mjs';
import { voice as hollow } from './void.mjs';

export const VOICES = { glow, shiraz, neon, gold, inferno, storm, astral, void: hollow, jade, frost, phoenix, oni };
