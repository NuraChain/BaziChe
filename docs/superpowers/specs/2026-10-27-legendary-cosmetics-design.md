# The legendary collections

The owner, 2026-10-27, while the card looks were being walked: a production brief for "a premium
BaziChe collectible experience that makes a player excited to equip a legendary cosmetic, watch its
animation, hear its signature sound, and show it off to other players", with at least eight
legendary collections, each complete across the whole game and each with its own art direction,
motion, VFX and sound; a reusable VFX system beyond CSS effects; a sound identity per collection; a
real catalogue of bundles and standalone looks; a Cosmetic Lab that previews the real assets; and
documentation. Nothing sold may touch a rule, a result, hidden information, a hitbox or the turn
order.

This file is the design: what it builds on (1), the eight collections (2), tiers and sets (3), the
asset architecture (4), the VFX system (5), the voices (6), the profile (7), the tables (8), the Lab
(9), the guarantees (10), the decisions (11) and the order of work (12). It extends
`2026-10-27-shop-design.md`, whose rules all stand.

## 1. What it builds on

- **The shop** sells looks for NURA through `ArcadeShop`; a look is `kind.collection`, each kind
  fills slots (`SHOP_SLOTS`), a bundle is a collection's looks 30% under their parts, owning is for
  good, choosing is `POST /shop/chosen`, and a game copies its players' looks at its start
  (`match_players.look`) so everybody draws the same thing for its whole length.
- **A look is drawn on its owner's things for everybody** (the shop design, section 5): pawns,
  dice, cards, chips, checkers and pieces, the owner's own corner of a table, the owner's profile.
  The board, the deck, the stock, the pot and the cube are the house's.
- **Everything a look looks like is generated** by scripts in `tools/art/` from one table of
  tokens (`frontend/src/game/looks/palette.ts`), and every folder of drawings has a ceiling the
  build refuses to pass.
- **Effects** run on `game/vfx/`: one Canvas 2D a host, particles from a fixed pool stamped from glow
  sprites cached per colour, presets and streams, nothing drawn while nothing lives or the tab is
  hidden, one soft flash for somebody who asked for less motion, a lazy chunk.
- **Sound** is packs of recordings (`.cues`) built with ffmpeg and levelled by measurement, played
  through the table sound engine's buses and limiter, each table loading only its own packs.

## 2. The eight collections

Each is a different shape language, material, motion and voice, not a palette over one drawing.
The ids are short and stable; the names are the brief's.

| | Collection | Material and colour | Shape language | Motion | Signature (the profile's reveal) | Voice |
|---|---|---|---|---|---|---|
| `inferno` | Infernal Sovereign · «سلطان دوزخ» | cracked obsidian with molten gold seams; obsidian `#120807`, lava `#E2381C`, molten gold `#FFB43A`, ember white `#FFE7A1` | jagged crown points, flame tongues, cracked plates | heavy and smouldering, flames flickering upward, sudden eruptions | cracks of magma run out from the frame, a column of flame erupts round it and falls back as rising embers | a low thump, an ignition whoosh, ember crackle |
| `storm` | Stormforged Monarch · «پادشاه طوفان» | charged forged steel; steel `#0D1424`, electric blue `#3FA9FF`, violet `#8B5CFF`, white-hot `#EAF6FF` | chevrons, pylons, riveted bands | staccato: charge gathers, discharges, arcs crawl | motes converge on the frame, a branching bolt strikes it, residual arcs crawl the rim | a charging whine, a crisp crack, a rolling rumble |
| `astral` | Astral Rift · «شکاف کیهانی» | dark glass full of stars, orrery rings; space `#0A0820`, nebula `#B04BFF`, cosmic teal `#4FE3D8`, star gold `#FFE58A` | orbits, concentric arcs, four-point stars | slow and gravitational, orbits and drifts, a rift that opens and seals | a slit of light opens behind the picture, stars pour out and settle into orbit as nebula blooms | a reversed swell, a cluster of inharmonic bells, a shimmer |
| `void` | Void Emperor · «امپراتور خلأ» | matte black split by violet fractures; void `#050308`, violet `#5B21B6`, ultraviolet `#A855F7`, spectral lilac `#E9D5FF` | broken shards, hollow outlines, negative space | absorbing then releasing, tendrils curling inward, particles dissolving | darkness is drawn into the frame, fractures crack across it, a release of spectral wisps | an inhale, a collapsing thud, a whisper |
| `jade` | Jade Dragon Dynasty · «دودمان اژدهای یشم» | carved translucent jade inlaid with gold; jade `#0F7A55`/`#2BB67F`, pale jade `#BFF2D9`, imperial gold `#F2C14E` | cloud scrolls, a dragon's coil, flowing curves | serene and sinuous, ribbons and drifting motes | a golden dragon coils round the frame trailing jade motes, a cloud-scroll pulse | a soft gong bloom, a pentatonic pluck run, chimes |
| `frost` | Frost Revenant · «شبح یخبندان» | faceted translucent ice; glacier `#F2FBFF`, ice blue `#8FD3FF`, deep frost `#1E5B8C`, arctic night `#0A1A2B` | crystal shards, hexagonal symmetry, icicles | brittle stillness, crystals growing, then shattering | frost spreads across the cover from the frame, the frame freezes white, shards burst and fall as snow | a cold wind, a glassy chord, a shatter sparkle |
| `phoenix` | Solar Phoenix · «ققنوس خورشید» | gilded feathers and burnished bronze; sunrise gold `#FFC94A`, flame orange `#FF7A1A`, crimson `#D7263D`, radiant white `#FFF6D6` | sweeping feathers, sunburst rays, plumes | soaring and radiant, arcs sweeping up, rebirth from ash | two wings of fire sweep up round the frame, a solar flare ring expands, glowing feathers drift down | a rising whoosh, a bright brass swell, a shimmering tail |
| `oni` | Neon Oni · «دیو نئونی» | holographic film over black chrome, circuit traces; chrome `#07080D`, crimson neon `#FF2E4D`, electric cyan `#20E6FF`, hologram violet `#7C5CFF` | a horned mask, angular plates, a hex grid | digital stutter: stepped timing, glitches, scanlines | a scanline sweeps the cover, glitch blocks flicker, a horned mask flickers over the frame and breaks into pixels | a glitch stutter, a taiko hit, a digital arpeggio |

They sit beside the four collections the shop opened with (Nura Glow, Shiraz Garden, Midnight Neon,
Royal Gold), which keep their looks and gain a voice too. Neon Oni and Midnight Neon are kept apart
by colour (crimson and cyan against magenta and cyan), motif (mask and circuitry against a glass
grid) and motion (stutter against a steady glow).

**Every moment has its recipe in each collection**: the aura, the reveal, an equip, a die landing,
a card laid, a pawn's step, its landing, a capture, a pawn leaving its yard, a game's start, the
turn passing to its owner, and the celebration of a win. **Every look has its drawing**: frames
(with a still twin), nameplates, covers, pawns for the four seats, decks and backs, felts, yards,
chips, checkers, home boards, twelve chess pieces, the shop's own drawing of each look and bundle,
and a sigil per collection.

## 3. Tiers, prices and sets

- **A fifth tier, mythic**, at 100 NURA. A look's tier is set by what it does and by its line: in a
  legendary collection the still looks (theme, faces, chips, checkers, home board) are epic (25), the
  pieces of a table (nameplate, back, felt, dice, pawns, pieces, yard) legendary (50), and the
  decoration, the profile effect and the celebration mythic (100). The staff set any price.
- **A bundle** is a collection's fifteen looks 30% under their parts, priced down for what the buyer
  owns, as now.
- **A set** is worn when every slot of a group wears one collection: the four profile slots, or the
  slots of one game. A worn set adds a flourish (the profile's reveal plays its full sequence and the
  frame its crown; a table plays its owner's entrance in full). It is worked out from what is worn,
  so no combination is stored and any look still mixes with any other.

## 4. The asset architecture

Four kinds of fact, four places, and adding a collection is one entry in each and a run of the
generators:

- **What is sold** (`backend/src/domains/shop/catalogue.ts`, both halves): collections, kinds,
  slots, tiers, prices, names and blurbs in English and Persian, bundles. The seed writes a row for
  each look at boot and never overwrites a price, a sale or a status.
- **What it looks like** (`frontend/src/game/looks/palette.ts`): each collection's ramps (piece, the
  two sides, surface, ground), edge, glint, ink, die face and pip, pattern. Held to the catalogue by
  `satisfies` and to 4.5:1 and the two-sides rule by `look-palette.spec.ts`.
- **How it moves** (`frontend/src/game/looks/identity.ts` and `game/vfx/recipes.ts`): each
  collection's motif, silhouette ids and motion personality, and for each moment the recipe that
  plays it, with its parameters.
- **How it sounds** (`frontend/src/game/sound-files.ts` and `game/sound/looks/<collection>.cues`):
  each collection's pack and the cue for each moment.

The drawings are files under `frontend/public/` (`frames/`, `plates/`, `covers/`, `pawns/`,
`decks/`, `backs/`, `felts/`, `yards/`, `chips/`, `checkers/`, `homes/`, `pieces/`,
`looks/`, `sigils/`), written by `tools/art/*.mjs` from the palette and each collection's motif
module, and refused by the build when missing, stray or over their folder's ceiling.
`docs/looks.md` is the guide to all of it.

## 5. The VFX system

`game/vfx/` grows from presets into a small composable system. It stays Canvas 2D: the counts are
hundreds of particles, which a 2D canvas stamping cached glow sprites with additive compositing
draws at 60 fps on a mid phone, and WebGL would be a second renderer and a second context beside the
landing's for no visible gain.

- **Emitters**: a point, a ring (round a picture), a path (along a frame's rim or a pawn's walk), an
  area, a node followed as it moves.
- **Behaviours**: buoyancy and gravity, drag, curl-noise turbulence, orbit about a centre on a tilted
  ellipse, gravity wells that pull in (absorption) or push out (release), a soft pull toward the
  pointer, spin.
- **Renderers**: a glow dot, a streak along its velocity, a flame tongue (a teardrop sprite stretched
  and flickered), an ember, smoke (large, soft, normal blending), a shard (a faceted polygon with a
  lit edge), a feather (a curved quill), a rune (a glyph stroked from a small alphabet of paths), a
  ring and a shockwave, a branching bolt (midpoint displacement with forks and a fading residue), a
  ribbon or tendril (a strip drawn through a particle's past positions), a nebula cloud (layered soft
  blobs turning slowly), glitch blocks (stepped rectangles).
- **Recipes** compose layers in time: a signature is anticipation, impact and aftermath, each a
  layer with an emitter, a behaviour set, a renderer and when it starts and ends. Every recipe takes
  a palette, intensity, duration, scale, density, rate, speed, direction, quality and a seed, so one
  recipe plays a little differently each time and exactly the same in a spec.
- **Quality** follows the device: low under a coarse pointer, Save-Data or few cores (fewer
  particles, a lower pixel ratio), high on a desktop; a cap per canvas and one that every canvas of
  a page shares, the oldest let go first, so a page with several effect hosts (the Lab) draws no more
  than a page with one. A table or a profile is one canvas; the Lab runs only the previews on screen.
- **Less motion**: no particles; a burst is one soft flash; a frame shows its still twin.
- **Nothing runs unseen**: a canvas schedules frames only while something lives, stops in a hidden
  tab, and an off-screen host (an `IntersectionObserver`) draws nothing.

## 6. The voices

Every collection's sounds are made here: `tools/art/look-sounds.mjs` synthesizes them offline, a
small DSP in Node (oscillators, FM pairs, filtered and shaped noise, granular crackle, envelopes,
short feedback delays for space) written to WAV and encoded by ffmpeg, two or three takes for each
cue, levelled against the table packs by `tools/art/sound-levels.mjs`. They are generated audio
files, credited as made for this project and given to the public domain like the rest.

- **Cues**: equip, reveal, signature, die landing, card laid, pawn step, pawn landing, capture,
  spawn, impact, victory. A table plays a collection's cue with its effect, over the table's own
  sound and never instead of it; recurring moments (a step) are quiet and rate-limited.
- **Packs**: one a collection, fetched only where one of its looks plays (a table where somebody
  wears it, a profile that shows it, the Lab), through the table sound engine's buses and limiter.
- **The listener decides**: everything is under the table sound switch, nothing plays on a page's
  first load before a press (the engine's unlock), and nobody's looks can make another person's page
  louder than their own settings allow.

## 7. The profile

- **The frame**, layered animated geometry inside its SVG (with a still twin), and **the aura** on a
  canvas round the picture, never over the face, leaning a little toward the pointer on the profile
  page.
- **The nameplate**, animated, behind the name in friend, member and search rows, Discover and the
  leaderboard.
- **The theme**: the cover of `/app/me`, a person's page and the public page, with an ambient layer
  of its collection's particles on the profile page alone.
- **The profile effect**: the collection's reveal, played once as the profile opens.
- **Equipping** a look in the collection or the Lab plays its collection's equip burst and sound.
- **A rarity badge** per tier (mythic prismatic and slowly turning) and **a sigil** per collection.

## 8. The tables

- **A table look dresses its owner's things and corner only.** The felt in front of the owner's seat
  at Hokm and poker (its pattern, and an engraved line that flows while it is their turn), their Ludo
  yard (the seat's colour kept as the ground), their backgammon home board and checkers, their chips,
  dice, pawns, chess pieces and cards.
- **Moments**: an entrance from the owner's corner when a game starts; the turn glow; the die's
  flight trail, its landing and, for a six at Ludo or doubles at backgammon, a fuller reveal; a
  pawn's trail, landing, capture and leaving its yard; a card laid; the celebration from the winner's
  side.
- **Pawns** of the legendary collections have silhouettes of their own on the board pawn's footprint
  (a flame crown, a storm spire, a ringed orb, a hooded wisp, a dragon's head, an ice shard, a plumed
  crest, a horned mask), the seat's colour as the body. **Chess sets** keep their two sides far apart
  in light. **Card faces** keep the standard indices at 4.5:1. **Dice** keep their pips at 4.5:1.
- **Effects lie under the pieces and cards**, inside the owner's corner where they have one, and
  nothing covers a cell, a card, a die or a control.

## 9. The Cosmetic Lab

`/app/shop/lab`, for everybody signed in, a lazy route reached from the shop:

- a collection browser and filters by kind and rarity;
- every look previewed by the components the product draws it with: a frame and aura on the reader's
  own picture, a cover, a nameplate in a row, a felt with dressed cards and the holographic edge, a
  Ludo corner where the die is thrown and a pawn walks, captures and leaves its yard, checkers on a
  point, the twelve chess pieces;
- bundles beside their looks, with the set flourish;
- the profile showcase: frame, cover, aura, nameplate, the reveal and its sound together, again on
  demand;
- a VFX playground: every recipe with its palette, intensity, speed, density, seed and quality;
- a sound panel: every cue of every collection;
- equip and unequip for looks the reader owns (the slots' own route), try on for the rest.

## 10. The guarantees

- **Cosmetic only.** A look is drawn from what the server says a player wears; no effect reads or
  writes game state; the die lands on the result the game logic sent and a burst plays after it;
  nothing reveals a card that is not face up; hitboxes and coordinates are the boards' own.
- **Performance**: lazy chunks, cached sprites and drawings, pooled particles, caps, quality tiers,
  nothing drawn while idle, hidden or off screen, sounds rate-limited with a voice limit.
- **Accessibility**: less motion is honoured everywhere, legibility rules hold for every collection,
  effects are `aria-hidden`, and every control in the Lab is a real control with a name.

## 11. Decisions

| | Decision | Default | Not chosen |
|---|---|---|---|
| LG-D1 | The legendary set | The brief's eight, its names kept, ids `inferno`, `storm`, `astral`, `void`, `jade`, `frost`, `phoenix`, `oni` | Ember, Storm and Frost alone (the earlier plan) |
| LG-D2 | Tier and price | `mythic` at 100; epic, legendary or mythic by kind in a legendary collection | One price for every legendary look |
| LG-D3 | Renderer | Canvas 2D with composable recipes | WebGL particles, a 3D engine |
| LG-D4 | Audio | Original sounds synthesized offline into files, one lazy pack per collection | Runtime synthesis; third-party packs |
| LG-D5 | Where a table look shows | Its owner's things and corner | A whole-table skin |
| LG-D6 | The Lab | `/app/shop/lab` for everybody signed in, the staff's tuning the same playground | `/admin/looks` for the staff alone |
| LG-D7 | Emotes | Not in this work: a sent reaction is a realtime message needing limits and moderation of its own | Emotes now |
| LG-D8 | Sets | A flourish worked out from what is worn | Stored combinations |
| LG-D9 | Budget | The effects chunk to 16 KB; every drawing folder keeps a per-file ceiling | No ceiling |
| LG-D10 | The sheet about a person (LG3) | Keeps its hue: a theme is on the profile reads, not on the person a list carries | The theme on the sheet's head, which would put `theme` on every person every list carries |
| LG-D11 | A whole set's strike (LG3) | The reveal's own last layer again, at 0.45 of its scale, from the sigil on the frame's crown | The collection's burst, which would put the palette in the header's chunk |
| LG-D12 | Whose dice at backgammon (LG8) | The dice of whoever throws: each opening die its thrower's; the pair an opening lays, a roll, and a roll drawn from nothing the mover's; the blank dice the reader taps their own | Each opening die kept in its thrower's look through the first move, which a reload could not draw again, since nothing in the board says which die was whose |
| LG-D13 | Backgammon's voices (LG8) | The table pack's own moments: `die` for a landing, `capture` for a hit, `spawn` for a checker in from the bar, `pawn` for one borne off | New `double` and `off` takes, which would take a table pack past its 64 KB |
| LG-D14 | One reveal and one capture a collection (LG8) | `CRITICALS` (a six at Ludo, doubles at backgammon) and `CAPTURES` (a pawn taken, a blot hit) in `game/looks/table.ts`, played by both boards | A table of each per game, so one collection's die and capture would look different at two tables |
| LG-D15 | Where a backgammon moment is drawn (LG8) | Under every checker and die (`LAYER.glow`), so nothing covers a piece | Over the board, as Ludo's die lands |
| LG-D16 | A backgammon home board (LG8) | The six points alone over the board's own, a band at their foot, the field, frame, bar and tray the house's; the other player's the same drawing turned round, so nothing at a point's tip says up or down | The quarter's whole ground recoloured, which put dark checkers on a dark field |
| LG-D17 | The shop's own drawings of checkers and home boards (LG8) | Left as they are: the classic four's stay byte for byte, and the Lab (LG11) shows the table's art | Redrawn from the table's art now, which a pair of legendary checkers takes past the 16 KB a shop drawing may weigh |
| LG-D18 | What makes a chess set its collection's (LG9) | The classic Staunton body of every kind on its own footprint, in the collection's two sides under its pattern, a rim of light and its metal; the king's cross cast in that metal with a stone, the queen's points and the bishop's tipped with its motif, the pawn wearing the crest its Ludo pawn wears, the rook its emblem as a cameo, the knight its motif down his mane | A silhouette of every kind per collection, which a player would have to learn again for every set they meet |
| LG-D19 | Where a chess set's drawings live (LG9) | `public/pieces/<collection>-<colour><kind>.svg` (`inferno-wk.svg`), flat as every other table look's folder, held by the build's folder rule as the rest are | `pieces/<collection>/`, which that rule cannot read without one of its own |
| LG-D20 | The shop's own drawing of a chess set (LG9) | Left as it is, a king and a knight in the collection's two sides, as LG-D17 left the checkers': the Lab (LG11) shows the table's pieces | Redrawn from the table's pieces now |
| LG-D21 | How a chess set reaches its pieces (LG9) | Twelve custom properties on the board's root (`--piece-wk` to `--piece-bp`), written from the match's looks, which every rule that draws a piece reads before the house's drawing: the squares, the trays, the promotion chooser and the rail's side mark follow with nothing of their own | A rule a collection and side in the stylesheet, as the decks and checkers have: 144 declarations every page's sheet would carry for one game |
| LG-D22 | Chess's moments and their voices (LG9) | A piece set down: the collection's burst, light and under a second, `pawn`; a capture: `CAPTURES` where the taken piece stood, `capture`; castling: `CASTLES` where the rook lands, `pawn`; a promotion: `CRITICALS`, `spawn`; check: `CHECKS` under the king, no voice over the board's chime; mate: `CRITICALS` and its `FINALES` layer, 1.6 squares wide, over the fallen king, `capture`. Every moment in the collection of the side whose piece made it, mate in the winner's | A landing on every move at the weight of a die's, which forty moves a side would make noise of; a voice for check, which the board already chimes |
| LG-D23 | A player's entrance at a game's start (LG10) | In the collection of the look that dresses their own corner (Ludo's yard, the felt at Hokm and poker, backgammon's home board, the chess set), none for a corner in Classic; the first two layers of that collection's celebration, every layer when every kind the game copies into the seat is that collection; from where the celebration rises, under every piece, with the table pack's `spawn`; played when the presenter takes an opening delivered to this browser, once a match, never on a reload or for a game arrived at in its middle | An entrance from any worn look, which a player in one die and nothing else would make at every start; a sequence of its own per collection, which twelve more signatures would cost for a moment the celebration already says |
| LG-D24 | Trying on (LG11) | The page's own state, drawn on the reader's own header, picture and name; nothing stored, nothing sent | — |
| LG-D25 | Previews of table looks (LG11) | Small stages drawn by the boards' own classes and custom properties, the boards' sizes moved into `game/looks/` and the layouts so a stage cannot drift from a table | The boards themselves, which need a match |
| LG-D26 | The playground (LG11) | For everybody signed in, a lazy chunk, nothing stored; each knob a factor over a moment as its table plays it, with a seed, the quality and less motion | A page of the staff's (`/admin/looks`) |
| LG-D27 | Who runs the shop (LG12) | A section `shop` for an admin and the owner, in the Platform group after Play; the shop's money a panel of Money (`money` reads it, `wallet`, the owner, acts on it) | — |
| LG-D28 | A look's price, sale and status (LG12) | One of them a change, of one look, with a reason, under the look's row lock, one `shop-item` row; a sale under the look's price for an hour to thirty days; a bundle is a row like a look | — |
| LG-D29 | The collection on top (LG12) | Chosen with a reason, `shop-feature` with `{ from, to }`, the shop rung (changed by LG-D34) | — |
| LG-D30 | Giving a look (LG12) | From a person's page, any look of the catalogue, by the note's rank rule, `shop-grant`; one already owned changes nothing | — |
| LG-D31 | Taking a look back (LG12) | Only a look that came by grant: one bought or given by a friend is its owner's for good (SH-D9) and goes only through a refund; `shop-revoke`, and the look comes off wherever it was worn | Any look, which would let the staff take back what somebody paid for |
| LG-D32 | A refund (LG12) | The owner's, of a paid order: `refund(order)` asked of the contract and handed to the owner's wallet (where and when: LG-D37, LG-D38) | — |
| LG-D33 | The overview's money (LG12) | The shop's sales from the database for the day, the week and all, for a role that opens Money (built as LG-D40) | The contract's books, which would make the overview wait on NuraChain |
| LG-D34 | A change the staff make, and the pages already open (LG12) | Rings nobody: a page reads the shop whenever it is opened, a purchase is quoted at the server's price and the sheet's wallet step says the order's price, and a quote at another price than the page showed reads the shop again | The shop rung for everybody at every change (LG-D29 as first taken) |
| LG-D35 | The log's shop rows, and the collection on top (LG12) | `shop-item` with `{ item, field, from?, to?, hours? }` and `shop-feature` with `{ from, to }`; a choice of the collection on top stamped `greatest(now(), the newest + 1 µs)` | `now()` alone, which left a choice that waited for the lock under the one it waited for |
| LG-D36 | A gift racing a purchase (LG12) | The gift locks the person's row and reads nothing back: a delivery's insert takes the foreign key's share lock on that row, so whichever comes second finds the look owned, and a look that arrived as bought stays bought | A read-back after an insert that ignores a conflict |
| LG-D37 | Where a refund is asked (LG12) | On any paid order in Shop › Orders, for the owner alone, asked why as a question that costs something; composed as `refund(order)`, asked of the contract first, handed to the owner's wallet; `shop-refund` `{ order, item, price }` about whoever paid, written when the call is composed, as the request it is | — |
| LG-D38 | When a refund lands (LG12) | The order worker asks about a paid order for a day after a refund was asked; once NuraChain says refunded the order is `refunded` and whatever it delivered is taken back, off every slot it was worn in; the reconciliation puts any paid order NuraChain holds as refunded right the same way | — |
| LG-D39 | The shop on Money (LG12) | A panel for every role that opens Money: revenue, what inviters are owed, what the contract holds and whether it covers both, the inviters' share, whether it is paused, the seller and its role, the paid orders that delivered nothing; the owner's calls (revenue out, pause and resume, the share from 0 to 30%, a new seller) asked of the contract first | — |
| LG-D40 | The overview (LG12) | The shop's sales (paid orders not refunded) of the last day, the week and all, from the database, for a role that opens Money; "Needs you" counts the paid orders that delivered nothing, leading to them | — |

## 12. The order of work

LG0 this design; LG1 the VFX system; LG2 the catalogue, palettes, identities and the shop's
drawings; LG3 the profile; LG4 the voices; LG5 cards; LG6 Ludo; LG7 felts and chips; LG8
backgammon; LG9 chess; LG10 celebrations and a game's start; LG11 the Lab; LG12 Admin › Shop; LG13
proof and `docs/looks.md` and `docs/vfx.md`. Each is its own commits: specs first, faults put in
one at a time and caught, the gates, the build within budget, and a walk on the built server at 1280
in English and 390 in Persian with every collection looked at three times larger than life.

## 13. As built

Where the work departed from this design, and why:

- **Twelve collections, one catalogue.** The eight are on sale beside the four the shop opened with:
  180 looks and 12 bundles in five tiers, Infernal Sovereign first on top.
- **No identity manifest and no recipes module** (section 4). Each part of a collection lives beside
  what reads it: its palette, its light, a table for each moment in `game/looks/`, its art module
  and its voice module, each table held to the catalogue by a `satisfies`, so a collection missing
  from any of them fails `npm run check`. `identity.ts` would have been a declaration nothing read
  (LG2). `docs/looks.md` lists every part, every table and every folder.
- **The engine composes families** (section 5). A family is one function that makes its particles,
  each with its shape, its envelope and its motion: 22 families and 14 streams beside the presets.
  A signature is a list of timed steps (`Step`: an effect, when, where from its point, a tune of its
  own). The emitters, behaviours and renderers of section 5 are the particles' own shapes,
  envelopes and motion (`shapes.ts`, `motion.ts`), and a stream's point, read every frame, is the
  node it follows. LG-D9's first cap, at most two canvases drawing at once, became one cap of
  particles that every canvas of a page shares, because the first would have blanked an aura
  whenever two bursts played elsewhere. `docs/vfx.md` is the reference.
- **Three packs a collection, and nine moments** (section 6). A collection's voice is a pack for
  each place it is heard: the profile (`equip`, `reveal`, `strike`), a table (`die`, `card`, `pawn`,
  `spawn`, `capture`) and a celebration (`victory`), so a page fetches only what it plays and the
  celebration's long take only where somebody wears it. There is no voice for a step, which every
  square of a walk would make noise of: a pawn is heard where it lands. `strike` is a whole set's
  sigil, struck at the end of the reveal, and the impact is the capture's. Backgammon and chess speak
  the same moments (LG-D13, LG-D22), and an entrance is `spawn`.
- **The tables** (section 8). A die leaves no trail in flight: its landing and the reveal of a six or
  of doubles say the collection, and the pawn's walk has the trail. Chips are not a drawing: a chip
  is eleven pixels across at a table, so a collection's chips are custom properties from the tones
  of the shop's own chip (LG7), and there is no `chips/` folder. The turn is the felt's: a light runs
  round the engraved ring of its owner's mat while it is their turn at Hokm and poker. Effects lie
  under every piece and card at Hokm, poker, backgammon and chess (LG-D15); at Ludo they play on the
  board's top layer, over the board round the die or the pawn they are about, for a moment, as they
  have since the first die was dressed. So the last line of section 8 holds at four tables and not at
  Ludo.
- **The Lab is the fitting room** (section 9, LG-D24 to LG-D26): `/app/shop/lab`, "Fitting room"
  («اتاق پرو»), reached from the shop's header. It shows one collection at a time (`collection` in
  the address, the featured one first, the twelve as chips with their sigils) and takes the shop's
  filter by area (`for`); it has none by rarity. The reader's own header wears the collection's
  frame, cover, nameplate and aura, with Play again for the whole set's reveal and its strike, and
  every look of the collection follows as the shop's cards, each opening its sheet, where it is
  used, bought or given. "At the table", a chunk of its own, is a stage for each game drawn by the
  boards' own classes, with a press for every moment that table plays; "Tune", another, is the
  playground. There is no sound panel of its own: each press plays its moment with its voice.
- **The order of work** went as written, with LG8 to LG12 after the first seven phases of the
  owner's production brief, which the owner put first on 2026-10-28.
