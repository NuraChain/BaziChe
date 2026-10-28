/**
 * The legendary collections' art, one module each: its pattern's tile, its emblem, the crest its
 * pawns wear, its frame with a still twin, its cover, its deck's dress and corner ornament, its
 * card back, its pawn, and at a backgammon table its checkers' rim and its home board's points
 * (`board`). Adding a collection is one module here, its palette in `game/looks/palette.ts` and its
 * line in the catalogue.
 */
import * as astral from './astral.mjs';
import * as frost from './frost.mjs';
import * as inferno from './inferno.mjs';
import * as jade from './jade.mjs';
import * as oni from './oni.mjs';
import * as phoenix from './phoenix.mjs';
import * as storm from './storm.mjs';
import * as hollow from './void.mjs';

export const LEGENDARY = { inferno, storm, astral, void: hollow, jade, frost, phoenix, oni };

/** The legendary collection whose art a palette's pattern names, or nothing for the collections drawn by the tools themselves. */
export const lineOf = (palette) => Object.values(LEGENDARY).find((line) => line.pattern === palette.pattern);
