# The effects engine

The looks the shop sells move: an aura round a picture, a burst where a die lands, a trail behind a
walking pawn, a signature where a card is laid, a reveal as a profile opens, an entrance as a game
opens and a celebration from the winner's side. All of it is drawn by one small engine in
`frontend/src/game/vfx/`, framework-free like `game/stage/`, on a 2D canvas laid over the element it
plays on. This is what it can do, how a page or a board hands it an event, what it costs and what it
never does. The design and its decisions are
`docs/superpowers/specs/2026-10-27-legendary-cosmetics-design.md` (LG-D3, LG-D9) and
`docs/superpowers/specs/2026-10-27-shop-design.md` (VX-D1 to VX-D9); which collection plays what is
`docs/looks.md`.

## Why a 2D canvas

Hundreds of particles at once, never thousands: a 2D canvas with each glow stamped from a sprite
cached per colour and drawn additively holds 60 frames a second on a mid phone, and needs no second
renderer and no WebGL context beside the landing's (VX-D1, LG-D3). No WebGL, three.js, Lottie or
Rive outside the landing. A frame round a picture is SVG with its motion inside it (SMIL) and a
still twin, and a card's tilt and holographic edge are CSS. The canvas is for what moves freely.

## A canvas over a host

`createVfx(host, options)` (`engine.ts`) lays one canvas over the whole of `host`, `aria-hidden`
and with `pointer-events: none`, sized to it at the device's pixel ratio (no more than its quality
allows) and refitted on every frame it draws, and answers a `Vfx`:

| Call | What it does |
|---|---|
| `burst(effect, at, tune?)` | plays a preset or a family once at a point of the host, in CSS pixels from its top left |
| `signature(steps, at, tune?)` | plays layers as one effect: each `Step` is an effect, how long after the signature began (`after`, ms), how far from its point (`dx`, `dy`, times the signature's scale), and a tune of its own laid over the signature's |
| `bolt(from, to, tune?)` | a jagged arc of lightning between two points, flickering for its life |
| `stream(flow, at, tune?)` | gives off round a point the caller moves (`at` is read every frame, and null pauses it) until the function it answers is called |
| `lean(at)` | where the pointer is over the host, for particles that lean toward it; null once it leaves |
| `live()` | how many particles are alive |
| `clear()`, `dispose()` | let go of every particle and stream; and of the canvas and its listeners too |

Its options: `ceiling` (the most particles the canvas holds, `CEILING` 420 times its quality's
share), `quiet` (less motion, `prefers-reduced-motion` when not given), `frame` (the frame
scheduler, so a spec drives it), `context` (a 2D context that counts, in specs), `layer` (its
z-index among the host's children, the stage's `burst` layer when not given) and `quality` (worked
out by `qualityOf()` when not given). It is timed by the product clock (`runtime().clock`), and a
frame that comes after a long pause steps it on at most 50 ms.

**Nothing is fetched until something plays.** `lazyVfx(host, options)` (`lazy.ts`) is the one way a
page or a board gets the engine: `warm()` fetches it ahead of the first effect, `play(fn)` runs `fn`
with the engine once it is here (and settles once it has run, or once the engine could not come),
and `dispose()` lets go; a host let go before the engine arrives never gets a canvas. A page or a
table where nobody wears an effect never loads the chunk. The build holds it to 16 KB gzip and keeps
it out of the landing's first set, the stage's chunk and every table's (`tools/budgets.mjs`).

## What a tune says

Every effect takes the same `Tune` (`presets.ts`). Every field is optional, and a number left out is
the effect's own:

| Field | Meaning |
|---|---|
| `colors` | what the particles are drawn in; for a look, its collection's light (`LIGHTS`) |
| `intensity` | how many particles there are (up to twice as many) and how bright |
| `density` | how many there are, times the device's share |
| `scale` | how large they are and how far they reach |
| `speed` | how fast they move and how soon they go |
| `duration` | how long they live, in ms, in place of the effect's own |
| `seed` | one seed plays an effect the same way every time, and none a new way each time; a seeded stream keeps one roll for its whole run |
| `direction` | which way a throw goes, in radians clockwise from the right; with none it goes every way |
| `area` | the region round its point a stream gives off across, in CSS pixels |

A tune may carry getters, and the engine keeps them, so a stream reads its scale or its area at each
spawn and follows a host that changes size (an aura round a picture that grows at a breakpoint).

## The effects

**Presets** (`PRESETS`, played once): `embers`, `sparks`, `smoke`, `dust`, `orbs`, `stars`, `burst`,
`frost`, `confetti`, `pulse`, `shockwave`.

**Streams** (`STREAMS`, for as long as they run): `trail`, `aura`, `flames`, `arcs`, `snow`.

**Families** (`FAMILIES` in `families.ts`, each a composition in time that says all it has to say):
`eruption`, `cracks`, `charge`, `strike`, `discharge`, `starburst`, `nebula`, `rift`, `implosion`,
`absorb`, `release`, `fracture`, `crystals`, `shatter`, `sigil`, `debris`, `fireworks`, `flare`,
`sunburst`, `wings`, `glitch`, `scan`.

**Family streams** (`FAMILY_STREAMS`): `blaze`, `cinders`, `static`, `orbit`, `tendrils`, `wisps`,
`mist`, `glints`, `runes`, `coil`, `feathers`, `rays`, `pixels`, `comet`.

**What a particle is drawn as** (`shapes.ts`): `dot`, `orb`, `puff`, `spark`, `star`, `flake`,
`confetti`, `ring`, `bolt`, `flame`, `shard`, `feather`, `rune`, `ribbon`, `nebula`, `glitch`,
`crack`, `ray`, `slit`, `shade`; its life follows one of four envelopes (`fade`, `swell`,
`flicker`, `stutter`).

**How a particle moves** (`motion.ts`): round an orbit, or by its velocity under a well that draws
it in, the pointer it leans toward, eddies, drag and gravity, with a spin. A ribbon keeps where it
was every `TRAIL_EVERY` (16) ms of its life, each place found between where a step began and ended,
so a ribbon is as long at 25 frames a second as at 120.

## How a page or a board hands it an event

The engine knows no game and no look. What plays where is decided beside each caller, in
`frontend/src/game/looks/` (`docs/looks.md`, *The motion*):

| Where | What plays | From | Caller |
|---|---|---|---|
| A profile | the aura round its owner's framed picture, leaning toward a pointer over the head (never a finger) | `AURAS` | `glowAround` (`aura.ts`), in `ProfileHeader` |
| A profile | the effect, once as the page opens and never on a re-read; with all four profile slots in one collection, a strike from the sigil on the frame's crown at its end (`struckAt`) | `REVEALS` | `revealAround` (`aura.ts`) |
| A profile page | what drifts across a themed cover | `AMBIENTS` | `driftOver` (`themes.ts`) |
| The collection, a look's sheet | a look put on, over the drawing pressed | `burstOf` | `burstOver` (`equip.ts`) |
| Ludo | a die landing; a six that keeps the turn; a pawn's trail, its landing and its leaving the yard; a capture | `burstOf`, `CRITICALS`, `TRAILS`, `CAPTURES` | `ludo-board.ts` |
| Hokm and poker | a card in a face look laid | `PLAYS` (`playAt`) | the Hokm and poker boards |
| Backgammon | a die landing; doubles, over the pair (`PAIR`); a hit; an entry from the bar; a checker borne off | `burstOf`, `CRITICALS`, `CAPTURES`, `ENTRIES`, `BORNE` | `backgammon-table.ts` |
| Chess | a piece set down (`LANDING`); castling; a capture; a promotion; check, under the king; mate, over the king laid down (`MATE_SQUARES`) | `burstOf`, `CASTLES`, `CAPTURES`, `CRITICALS`, `CHECKS`, `FINALES` | `chess-table.ts` |
| Every table | an entrance from each corner a look dresses as the game opens (its celebration's first two layers, every layer for a whole set: `entranceOf`, `enterAt`); the winner's celebration (`celebrationOf`, `cheerAt`) | `CELEBRATIONS` | each board |
| The fitting room | every moment a table plays, on a stage of its own (`momentOf`), and the playground's knobs over any of them (`retune`) | all of the above | `lab-tables`, `lab-playground` |

A board fetches the engine only once somebody in its match wears a look that plays there (`wornOf`
reads `matchPlayer.look`), plays at an event the board already plays (a landing, a capture, a card
arriving, the opening, the result) and lets the engine go with its teardown. So an effect is always
the result of an event the server decided, and it never decides one. The collection's voice
(`docs/looks.md`, *The voices*) is played at the same moment through the table's sound handle.

**Where an effect lies.** At Hokm and poker under the cards, in a layer laid over the mats and under
everything else on the table (`.hokm-burst`, `.poker-burst`). At backgammon and chess under every piece (`LAYER.glow`). At Ludo on
the board's top layer (`LAYER.burst`), over the board round the die or the pawn it is about, each
over within a few seconds. On a profile, outside the picture: the aura's host is masked off the
face.

## What it costs, and what it never does

- **It draws only while something lives.** No frame is asked for while the canvas is empty, in a
  hidden tab (`visibilitychange`) or while its host is off screen (an `IntersectionObserver`).
- **It is capped.** 420 particles a canvas, times its quality's share, and 900 between every canvas
  of a page (`PAGE_CEILING`, LG-D9: one cap they share, so a burst elsewhere never blanks an aura);
  past either, the canvas adding particles lets its own oldest go.
- **It follows the device.** `qualityOf()` answers `low` under a coarse pointer, on Save-Data or on
  four cores or fewer (45% of the particles, a pixel ratio of 1 and half the ceiling), `medium` on
  five or six (70%, 1.5 and three quarters) and `high` above (all of them, 2 and the whole ceiling).
- **Less motion is honoured** (VX-D5): a burst, a signature and a bolt become one soft flash at
  their point, and a stream draws nothing. A frame keeps its still twin.
- **It takes no press and says nothing.** The canvas lets every pointer through and is `aria-hidden`;
  the event it decorates is said by the board as it always was.

**Measured** (2026-10-29, the built server and headless Chromium on one development machine, at
1280x720, where the browser paints as fast as it can rather than at a screen's 60 Hz): a live poker
table of six where every seat wears a whole legendary set, so the opening plays six entrances at once,
each with every layer of its celebration, timed over the opening's first five seconds by a probe run
by hand for this measure (it is not one of the repository's passes):

| The opening | Frames a second | Slowest frame | Long tasks |
|---|---|---|---|
| in looks, the engine and the drawings already in the browser | 163 | 36 ms | none |
| in looks, the first table a browser opens | 145 | 236 ms | one, about 90 ms |
| in Classic, the first table a browser opens | 158 to 159 | 91 to 121 ms | one of 131 ms in one run of two |

So six entrances at once cost the page nothing it notices once the engine is loaded. What a first
table in looks pays once is what only looks bring: the engine, the voices and six sets of drawings
painted for the first time.

## How it is held

`vfx-engine.spec.ts` (the canvas, the pool, nothing drawn while idle, the ceiling, a stream let go,
less motion, on the manual clock with a counting context), `vfx-motion.spec.ts`, `vfx-families.spec.ts`
(every family and stream played to its end, seeds, the device's share, a signature's layers, less
motion, the pointer, and the cap every canvas of a page shares), `aura.spec.ts`,
`avatar-looks.spec.ts`, `themes.spec.ts`, `equip.spec.ts`, `look-identity.spec.ts`,
`ludo-board.spec.ts`, `hokm-looks.spec.ts`, `poker-looks.spec.ts`, `backgammon-looks.spec.ts`,
`chess-moments.spec.ts`, `entrances.spec.ts`, `moments.spec.ts` and `lab-tables.spec.ts`; and the
build, for the chunk's ceiling and where it may not be.

Recipes were first tuned in throwaway previews, each looked at mid-flight at 2x or 3x. The way to
tune one now is the fitting room's playground (`/app/shop/lab`, Tune), which plays any moment with
the engine's own numbers as factors over how its table plays it, a seed, the quality and less
motion, and stores nothing.

## Adding an effect

A new family is a function in `FAMILIES` and its name in `Family` (`families.ts`), drawn from the
shapes there are or from one more in `shapes.ts` (its name in `Shape` and its case in
`drawParticle`). A new stream is an `Emitter` in `FAMILY_STREAMS`: how many it gives off a second
and how it makes them. `vfx-families.spec.ts` plays each of them to its end by name. Then an entry
for each collection that plays it, in the table of the moment it plays at.
