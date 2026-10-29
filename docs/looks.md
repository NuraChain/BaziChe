# The looks, and how a collection is made

Every look the shop sells is made here: drawn by our own generators from one palette a collection,
moved by the effects engine, voiced by an offline synthesizer, and checked by the build. No look is
a recolour of another and no art or sound is third-party (SH-D12). This is where each part lives,
what holds it, and the steps to add a collection. What the shop sells, who sees what and how a
purchase works is `.claude/rules/shop.md`; the engine that moves the effects is `docs/vfx.md`.

## A collection is kept in parts, each beside what reads it

| Part | Where | Held by |
|---|---|---|
| What is sold: its id, its line, its names and its blurb | `backend/src/domains/shop/catalogue.ts`: `SHOP_COLLECTIONS`, `LEGENDARY_COLLECTIONS`, `COLLECTION_NAMES`, `COLLECTION_BLURBS` | it is the catalogue, and the seed writes its rows at every boot |
| The collections the browser draws | `frontend/src/game/looks/frames.ts` (`FRAMES`) | `avatar-looks.spec.ts` holds it equal to `SHOP_COLLECTIONS` |
| Its colours | `game/looks/palette.ts` (`PALETTES`) | `satisfies Record<ShopCollection, Palette>`, and `look-palette.spec.ts` |
| Its light and its moments | `game/looks/`, a table a moment (*The motion*, below) | a `satisfies Record<…>` over the collections on every table, and `look-identity.spec.ts` |
| Its voice | `tools/art/voices/<collection>.mjs`, written into `frontend/src/game/sound/looks/` | `VOICES` in `voices/index.mjs`, `LOOK_PACKS` in `game/sound-files.ts`, the build and `look-pack.spec.ts` |
| Its shape language, for a collection on the legendary line | `tools/art/legendary/<collection>.mjs` | `LEGENDARY` in `legendary/index.mjs` |
| Its rules in the stylesheet | `frontend/src/styles/app.css` | the sheet specs in the server suite (*The stylesheet*, below) |

No manifest gathers them. Each part lives with what reads it, and a collection with a part missing
fails `npm run check` or a spec that names it (decided in LG2: a manifest nothing reads is a
declaration with no caller).

## The palette

`Palette` in `palette.ts`, one a collection. A ramp is three stops of one material, from where the
light falls to where it does not.

| Token | What it is for |
|---|---|
| `piece` | what the collection is made of (glass, glazed tile, obsidian, polished gold), as a ramp |
| `pale`, `deep` | the two sides of a two-sided set (checkers, chess), far apart in light so two sets on one board still read as two sides |
| `surface` | a flat thing in it: a card back, a plate, a board's ground |
| `edge` | its lines and rims |
| `glint` | the light it catches |
| `ink` | what is written on a surface, at 4.5:1 or more against every stop of it |
| `die` | a die's face ramp and its pips, at 4.5:1 to each other |
| `ground` | where its looks are shown |
| `pattern` | its motif: `sparkle`, `girih`, `grid` and `filigree` are drawn by the tools themselves, and a legendary collection's names its own module (`lineOf`) |

A pawn keeps its seat's colour as its body (`SEAT_RAMPS`, the Ludo board's own paint).
`look-palette.spec.ts` (server suite) measures every collection's ink, pips and sides against those
rules. A die and a stack of chips are no file: a die is drawn from custom properties its palette
gives (`DIE_PROPERTIES` in `dice.ts`), and chips from the tones of the shop's own chip
(`chipTones` in `tools/art/look-parts.mjs`).

## The motion

Each table is a `satisfies Record<…>` over the collections, so a collection missing from one fails
`npm run check`; `look-identity.spec.ts` holds that each collection's moments are its own and play
in its light. The recipes themselves are the engine's (`docs/vfx.md`).

| Table | Module | What it plays |
|---|---|---|
| `LIGHTS` | `lights.ts` | the colours every effect of the collection plays in, round a picture and at a table alike |
| `AURAS` | `aura.ts` | the stream round its owner's framed picture on their profile |
| `REVEALS` | `aura.ts` | the profile effect, once as the profile opens; a whole set ends it with the sigil's strike |
| `AMBIENTS` | `themes.ts` | what drifts across a themed cover on the profile page |
| `BURSTS` (`burstOf`) | `table.ts` | where its die lands, where a piece of its set is set down, and where one of its looks is put on (`equip.ts`) |
| `CRITICALS` | `table.ts` | a die's critical reveal (a six that keeps the turn at Ludo, doubles at backgammon), a promotion, and the first layers of a mate |
| `CAPTURES` | `table.ts` | a capture at Ludo and at chess, a hit at backgammon |
| `TRAILS` | `ludo.ts` | what a pawn leaves behind as it walks |
| `PLAYS` | `cards.ts` | a card laid at Hokm and poker |
| `SHEEN` | `dice.ts` | how a die catches the light: its gloss, and whether its pips glow |
| `ENTRIES`, `BORNE` | `backgammon.ts` | a checker brought in from the bar, and one borne off |
| `CASTLES`, `CHECKS`, `FINALES` | `chess.ts` | castling, a king put in check, and mate over the king laid down |
| `CELEBRATIONS` | `celebrations.ts` | the winner's celebration; a game's entrance plays its first layers, and all of them for a whole set (`entrances.ts`) |

The fitting room plays every table moment through `momentOf` in `moments.ts`, with the recipe, the
size and the voice its board plays it with; a new moment at a table is a new entry in `STAGES` there.

## The drawings

`npm run looks` runs `tools/art/looks.mjs`, `profile-looks.mjs` and `table-looks.mjs`. Each writes
SVG into `frontend/public/<folder>/`, and the build (`tools/budgets.mjs`) refuses a file that is
missing, one that no collection sells, and one over its folder's ceiling:

| Folder | Drawn by | One for | Ceiling |
|---|---|---|---|
| `looks/` | `looks.mjs` | every look and bundle: the shop's own picture of it | 16 KB |
| `sigils/` | `looks.mjs` | each collection's mark | 8 KB |
| `frames/` | `profile-looks.mjs` | each collection, moving (SMIL) and a still twin (`<collection>-still`) | 20 KB |
| `plates/` | `profile-looks.mjs` | each collection | 6 KB |
| `covers/` | `profile-looks.mjs` | each collection | 24 KB |
| `pawns/` | `table-looks.mjs`, on the board pawn's outline (`pawn-shape.mjs`) | each collection in each seat's colour (`<collection>-<seat>`) | 6 KB |
| `decks/` | `table-looks.mjs` (`card-parts.mjs`) | each collection's faces, the standard indices kept | 96 KB |
| `backs/` | `table-looks.mjs` (`card-back.mjs`) | each collection | 8 KB |
| `yards/` | `table-looks.mjs` | each collection, the seat's colour showing through | 12 KB |
| `felts/` | `table-looks.mjs` (`mat()`) | each collection, a round mat clipped to the cloth | 8 KB |
| `checkers/` | `table-looks.mjs` | each collection's light and dark checker (`<collection>-light`, `-dark`) | 12 KB |
| `homes/` | `table-looks.mjs` | each collection's home board, its six points | 16 KB |
| `pieces/` | `table-looks.mjs` through `chess-looks.mjs`, on the classic set's footprint (`chess-set.mjs`) | each collection's twelve pieces (`<collection>-<w\|b><k\|q\|r\|b\|n\|p>`) | 12 KB |

The parts they share are `svg-parts.mjs`, `look-parts.mjs` (`clothOf`, `chipTones`, `motif`),
`card-parts.mjs`, `card-back.mjs` and `suits.mjs`. A legendary collection's motif, emblem, crest,
frame, cover, deck dress, back, pawn, checker rim, home board points and chess crowns come from its
module in `tools/art/legendary/`; the four the shop opened with are drawn by the tools on their
pattern. The classic drawings in `public/board/` are not touched by any of it.

Each drawing is looked at at four times its size and at a table at a phone's size before it is
committed, and the walks keep screenshots of every collection at 3x.

## The stylesheet

A look reaches the page as an attribute on its owner's things, and `app.css` turns it into the
collection's file or colours. These rules name every collection, and each has a spec in the server
suite that names the one missing:

| Rule | Spec |
|---|---|
| `[data-deco]`, and its still twin for somebody who asked for less motion | `frame-sheet.spec.ts` |
| `[data-plate]` | `plate-sheet.spec.ts` |
| `[data-faces]`, `[data-backs]`, and the shine of a back on the legendary line | `card-sheet.spec.ts` |
| `[data-yard]` | `yard-sheet.spec.ts` |
| `[data-mat]` | `felt-sheet.spec.ts` |
| `[data-chips]` | `chip-sheet.spec.ts` |
| `[data-checkers][data-tone]`, `.bgt-home[data-home]` | `checker-sheet.spec.ts` |

A theme's cover, a sigil and a look's own drawing are pictures named by the collection, which the
build holds to a file in their folders. A chess set is twelve custom properties the board sets
(`chess.ts`), and `piece-sheet.spec.ts` holds each to a drawing the build ships.

## The voices

`npm run voices` (`tools/art/look-sounds.mjs`) draws every take offline in Node, from nothing but
code: one module a collection in `tools/art/voices/` (`VOICES` in `index.mjs`), over `dsp.mjs`
(oscillators and FM, filtered noise, plucked strings, bells, granular crackle, a reverb, an echo,
drive, a bit-crusher, envelopes). Every take is seeded from its collection, its moment and its
number, so a build writes the same bytes every time. Each is levelled as `sound-levels.mjs`
measures, by its loudest 10 ms in the band a phone's speaker plays, a number of decibels under the
chess click as it sits in its pack (`MADE`); a table's moment sits further under, because it lies
over the table's own foley and never replaces it. ffmpeg encodes them (MP3, mono, 64 kbps) into
three packs a collection, one for each place a look is heard (`MOMENTS` in `game/sound-files.ts`):

| Place | Moments | Pack |
|---|---|---|
| profile | `equip`, `reveal`, `strike` | `<collection>-profile.cues` |
| table | `die`, `card`, `pawn`, `spawn`, `capture` | `<collection>-table.cues` |
| celebration | `victory` | `<collection>-celebration.cues` |

A cue is `<collection>.<moment>`. Backgammon and chess speak the table pack's moments: at
backgammon the dice are `die`, a hit `capture`, an entry from the bar `spawn` and a checker borne off
`pawn`; at chess a piece set down and castling are `pawn`, a capture and a mate `capture`, and a
promotion `spawn`. A game's entrance is `spawn` at every table. A pack is fetched only where one of its looks is heard (`wear` on a sound handle),
under the device's sound switch, and the celebration's one long take only where somebody wears that
celebration. The build refuses a missing, stray or oversized pack (64 KB), `look-pack.spec.ts`
holds every pack to every moment, and the credits (`tools/art/sound-src/LICENSE.txt`) say the takes
are made by code here and are CC0.

## Adding a collection

1. `catalogue.ts`: its id in `SHOP_COLLECTIONS` (and in `LEGENDARY_COLLECTIONS` for one on the
   legendary line, whose tiers follow `LEGENDARY_TIER_OF`), its names in English and Persian, its
   blurb. The seed writes its looks and its bundle at the next boot; no schema change, since no
   CHECK names a collection.
2. `frames.ts`: its id in `FRAMES`.
3. `palette.ts`: its palette. Run the server suite: `look-palette.spec.ts` says what fails.
4. Its light and every moment: an entry in each table of *The motion*; `npm run check` lists each
   one missing.
5. On the legendary line, its shape language: `tools/art/legendary/<collection>.mjs` in
   `LEGENDARY`, its `pattern` the one its palette names.
6. Its voice: `tools/art/voices/<collection>.mjs` in `VOICES`, and its three packs in `LOOK_PACKS`.
7. Its rules in `app.css` (*The stylesheet*); the sheet specs name each one missing.
8. `npm run looks` and `npm run voices`, then look at every drawing large and at a table, and hear
   every take beside what it plays with.
9. `npm run build`: every art folder, every pack and the budgets.

A collection's name comes from the catalogue wherever the product says it (Persian to a Persian
reader, English to the rest), so the ten languages need nothing more.
