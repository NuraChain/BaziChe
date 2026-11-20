# Game and media audit

## Scope and baseline

The catalogue, engine registry and lazy board registry agree on five games. The sweep runs against the built Baziche application on an isolated loopback server and database. Test-only wallet sessions were created through the same challenge and signature flow as an ordinary guest. Match moves were submitted through the interface and checked against the next server revision.

The baseline at `073fdcf4` built and typechecked. The frontend test log records 113 files and 2,423 passing tests. The browser sweep used the local Playwright MCP in the visible Chrome session. Screenshots and machine-readable observations are kept under `.playwright-mcp/game-audit/` in the local workspace.

## Game inventory

| Game and formats | Board and controls | Presentation and sound | Audit result |
| --- | --- | --- | --- |
| Ludo, 2–4 players, optional teams at four seats | Square yard and safe-cell art, player-coloured pawns, centre roll target, corner plates with turn state and home counts | Directional pawn hops, three-dimensional dice, capture and home feedback. Die shake, contact, pawn steps and yard cues | Two, three and four seats measured. A touch roll advanced the server revision in the four-seat team match. |
| Hokm, 2–4 players, teams at four seats | Landscape or upright green table, trump chooser and medallion, layered hand, stock and trick area, team seats | Dealt and played cards preserve their origin, approach and arrival. Card shuffle, deal, place, trump and trick cues | Two, three and four seats measured. A touch trump selection advanced the revision. The 320 px four-seat snapshot exposed a clipped outer hand card. |
| Backgammon, 2 players | 1000 × 820 walnut SVG, woven points, split tray, live checkers, rolled dice and doubling cube, turn plates and pip counts | Checker paths and hit-to-bar or bear-off moves; code-driven dice with SVG faces; cup shake and wooden contact cues | Full matrix measured with the cube visible. A keyboard opening roll advanced the revision. |
| Poker, 2–9 players | Responsive oval table, shared cards, private pocket, stack and bet markers, pot, check/call/fold/raise | Deal, reveal, chip placement and pot gathering. Card pack shared with Hokm, separate chip and knock cues | Heads-up and nine-seat formats measured. A touch call or check advanced the revision in each. |
| Chess, 2 players | Square wood board with coordinates and individual piece SVGs, move and capture targets, draw and promotion controls, clocked seat plates | Piece lift, travel and settling, capture, check and special-piece cues | Full matrix measured on a clocked table. Keyboard selection committed e2–e4 and the server returned SAN `e4`. |

The first pass measured all eleven requested viewport sizes and 844 × 390 landscape for each of ten formats. The visual checks included Persian at 390 px and English at 320, 390 and 1440 px. The baseline did not apply a light theme from the preference cookie. The integrated build applied light theme and Persian together, which exposed low contrast on the physical felt plates, black trump suits and the dealer puck. Their text and marks now use the dark palette locally.

## Responsive measurements

The table records the rendered playing surface width in CSS pixels. Ludo and Hokm are four-seat team fixtures, Poker is nine-seat, and Backgammon and Chess have two seats. The other formats were also checked for overflow and missing board images. The integrated sweep logged zero console or transport failures. A separate Chess run used a newly started clocked game and a turn-based fixture so the live turn deadline could not interrupt the viewport sweep.

| Viewport | Ludo | Hokm | Backgammon | Poker | Chess |
| --- | ---: | ---: | ---: | ---: | ---: |
| 320 × 640 | 288 | 308 | 308 | 308 | 308 |
| 360 × 800 | 328 | 348 | 348 | 348 | 348 |
| 375 × 812 | 343 | 363 | 363 | 363 | 363 |
| 390 × 844 | 358 | 378 | 378 | 378 | 378 |
| 430 × 932 | 398 | 418 | 418 | 418 | 418 |
| 768 × 1024 | 628 | 648 | 648 | 648 | 720 |
| 1024 × 768 | 609 | 888 | 681 | 888 | 690 |
| 1280 × 800 | 641 | 1144 | 806 | 1144 | 661 |
| 1440 × 900 | 741 | 1304 | 928 | 1304 | 761 |
| 1920 × 1080 | 921 | 1784 | 1148 | 1784 | 941 |
| 2560 × 1440 | 1281 | 2424 | 1587 | 2424 | 1301 |
| 844 × 390 | 292 | 673 | 380 | 556 | 251 |

At 320 × 640 the outer Hokm card originally ended at x = 323.4. Reserving room for the existing rotation brought that edge to x = 310.8 while keeping all thirteen cards at their original height and vertical position. The rebuilt app had no clipped card controls in the sweep. The 1600 px-wide Hokm WebP background stretches to 2424 CSS px at the largest tested width. The card and piece sprites retain their vector detail at that scale.

At 390 × 844 the final build kept Persian and light theme on the page and the dark palette on the physical markers for all five games. Measured visible names had estimated contrast from 13.77:1 to 15.20:1 against the composite plate color. The black trump suit reached 17.32:1 and the Poker dealer letter reached 15.12:1 against their light markers. The run had no horizontal overflow or browser errors.

The nine-seat Poker document logged a 152 ms long task in the baseline and one 221 ms long task in the integrated run. The samples include application entry and shared browser activity. They establish a candidate for isolated profiling and do not attribute the delay to dealing or layout.

## Asset inventory

| Group | Count and raw bytes | Usage and condition | Priority |
| --- | --- | --- | --- |
| Classic boards and pieces | 34 files, 1,370,967 B | Inline board geometry and hitboxes reference editable SVGs. The three WebP table backgrounds cover the Ludo room and Hokm portrait/landscape. The 1600 × 1000 Hokm artwork weighs 291,740 B. Poker separates felt, wood, leather and medallion. | Preserve geometry and verify crops in the real play area. |
| Theme decks and backs | 24 files, 2,787,358 B | Twelve face atlases and backs. The face atlases are the largest theme graphics and loaded for equipped collections. Base cards use a common 204 × 288 shape. | Review visible rank clarity and load only the themes needed at the table. |
| Theme game pieces | 216 files, 3,687,955 B | 144 chess pieces, 48 pawns and 24 checkers keep a recognizable seat or side. | Preserve high-contrast team identity and local piece symbols. |
| Theme play surfaces | 36 files, 470,178 B | Player home overlays, yards and felts are positioned by each game. | Verify orientation and correct ownership with mixed looks. |
| Profile and shop graphics | 252 files, 6,397,053 B | The shop uses composite cards, with covers, frames, plates and sigils shared by profile and seat surfaces. | Separate card previews from game-critical artwork when measuring loading. |
| Public identity and landing assets | 46 files, 3,899,053 B | Public icons and art, flags, responsive posters and two GLBs. Desktop GLB 1,942,924 B and phone GLB 972,532 B. | Record separately from the five play areas. |
| Standard cues | 8 packs, 405,684 B | Common cues, card movements, five game-specific packs and call cues. Each table fetches its own pack and any shared dependencies. | Check headroom, repetition, volume and gesture unlock. |
| Theme voices | 36 packs, 1,391,573 B | Profile, table and celebration packs per collection, loaded around equipped themes. | Verify a theme preview and its corresponding table moment. |
| Music and ambience | 7 files, 4,938,498 B | Five music loops and two alternate beds. The largest is Chess at 982,771 B. Each loop lasts around 56–82 seconds. | Verify gesture unlock, pause and route teardown rather than eager loading all beds. |

The inventory hashes every file. It found zero byte-identical duplicates. Shipped audio is packed into `.cues` and `.bed` files. The source recording licenses are kept beside the source libraries in `tools/art/sound-src/` and `tools/art/bed-src/`.

## Sound measurements

| Measurement | Baseline | After |
| --- | ---: | ---: |
| Standard cue takes decoded | 90 | 90 |
| Standard cue peaks above 0 dBFS | 55 | 0 |
| Highest decoded standard peak | +7.7 dBFS | −1.2 dBFS |
| Poker chip-lay spread in the 300 Hz–4 kHz band | 14.4 dB | 6.3 dB |
| Standard cue bytes across eight packs | 405,684 B | 405,684 B |

The recording generator now leaves codec headroom after a short look-ahead limiter, with delay compensation. The unusually loud Poker chip take is attenuated and equalized around 1 kHz. These are decoded sample-peak and loudest 10 ms measurements before the browser’s mixer. Browser action probes observed decoded cue starts for the Ludo roll, Hokm trump call, Backgammon opening roll and Poker call or check. Chess committed its keyboard move and separately showed both live clocks.

Two of the 180 synthesized theme takes initially exceeded 0 dBFS, up to +1.40 dBFS. Regenerating all theme and call cues against the revised Chess click corrected their relative level. The generator also measures each encoded take at 44.1 and 48 kHz and attenuates any take that overshoots after encoding. Only one Frost card variant needed this adjustment. FFmpeg and Chrome Web Audio decoded all 270 standard, call and theme takes below 0 dBFS at both rates. Theme maxima were −0.84 dBFS at 44.1 kHz and −0.25 dBFS at 48 kHz. Sizes and durations stayed constant. A second generation reproduced the pack hashes.

Music and ambience beds measured −24.89 to −24.50 LUFS integrated and at most −1.23 dBTP. The settings provide separate game and background sound switches, independent background volume, and defer fetching the beds to the table audio path.

The final browser probe measured a fresh page with a non-activating Chrome diagnostic. It found zero started cues or beds before any input. A reduced-motion Ludo touch roll then started two decoded cues and one bed. With both table sound switches off, the server still accepted the roll and neither cues nor music started.

## Work checklist

| Task | Files and dependencies | Acceptance and risk | Status |
| --- | --- | --- | --- |
| A. Establish widths, board proportions, and committed input across five games | Local built app, Playwright MCP, seeded game sessions | Measure all eleven widths, screens in English and Persian, and real action acknowledgements. Keep transient animation and settled geometry distinct. | Matrix captured and all five games accepted an input. |
| B. Fit the Hokm hand at small widths | `frontend/src/styles/app.css` hand-fan rules, existing card component and flight stage | Reproduce the card crossing the viewport edge, reserve space for tilt, and keep legible card peeks and hit areas. Recheck 320 and 390 px, RTL and keyboard. | Patched. The browser comparison moved the right edge from 323.4 to 310.8 px and retained all 13 cards. |
| C. Audit recorded cue levels | `tools/art/sound-levels.mjs`, `tools/art/sound.mjs`, shipped cue packs | Compare decoded peak and 10 ms energy and preserve the material of the sounds. Listen or exercise at least one browser cue per game. | Standard decoded peaks and rebuilt gameplay cues verified. |
| D. Verify game resource cleanup | Real game navigation, browser heap and DOM counters | Repeated enter and leave, followed by a stable retained baseline. Distinguish finite decoded asset caches from mounted listeners, timers or canvas resources. | Tracked in the integrated product audit. |
| E. Restore contrast on the tabletop in light mode | `frontend/src/styles/tokens.css`, `TablePlate`, Hokm trump markers and Poker dealer puck | Keep the light app chrome and check the ink over the existing physical surfaces. | Verified across all five real boards in Persian light mode. |

## Verification receipts

- `npm run test --workspace frontend -- sound bed hokm poker ludo chess backgammon --maxWorkers=2` passed all 649 tests in 22 files.
- The rebuilt app and output budgets passed. The final browser contrast report, viewport records, Chess run and screenshots are under `.playwright-mcp/game-audit/`.
- On the final build, Playwright MCP verified both sides of a live Fool’s Mate and a saved draw. Every result showed the correct heading and two standings, its table was closed, and the app returned to Games after 9.83, 9.86 and 9.95 visible seconds respectively.
- A native Chrome tab switch kept a finished table hidden for 14.312 seconds. The app returned to Games after 10.005 foreground seconds across that interruption. The repeatable visibility regression also held the result for 12 simulated hidden seconds.
- In two independent guest sessions on a voice-enabled Ludo table, synthetic microphone audio crossed the real WebRTC connection in both directions. The dice roll advanced the server revision from 1 to 2 and the peer received the table chat message. Leaving voice closed both peers. This checked browser delivery on loopback. Physical speaker quality, long multiplayer series and exhaustive special endgames remain outside this sample.
