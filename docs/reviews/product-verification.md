# Baziche product verification

On 20 November 2026, Playwright MCP exercised Baziche in Google Chrome with synthetic players and staff on a disposable PostgreSQL database. The review started on a clean `main` at `073fdcf4`, 14 commits ahead of its remote-tracking branch. The original client build was `0cbc692371cad671`. The game contrast review used `84892d00f98428aa`. The final client build, including the compact Persian Poker preset, was `5a8cbfb7d17ba1e8`.

The [interface review](product-interface.md) covers the route inventory, shared components, themes, localization and accessibility. The [light-theme contrast review](light-contrast.md) records before-and-after readings from the rendered pages and game overlays. The [game and media review](product-games.md) covers each game, the artwork and audio inventory, board dimensions, game actions and result timing. The [backend review](product-backend.md) covers the 25 domain directories, data access, transactions, rankings of issues, measurements and rollback of the first service change.

The starting revision already contained the separate work for secure dice and shuffles, mobile tooltip positioning, editable Backgammon and dice artwork, landing showcases, theme effects, Ludo occupancy and post-match results. The integrated tests included the earlier Ludo cases for solid safe stars, team start squares, skipping a blocked roll and single occupancy of each colored home-lane destination.

## Execution record

| Step | Objective and files | Dependency and regression risk | Acceptance and outcome |
| --- | --- | --- | --- |
| P0 | Inventory `frontend/src/routes.ts`, the board and engine registries, assets, server domains and existing suites | Establish a clean baseline before changing source. Build in a separate directory to preserve the active workspace. | Built the original source, captured English route and board baselines, ran checks and tests, and identified five games. |
| P1 | Share light and dark tokens, theme selection and localized startup across the three shells | First paint, reload and nested physical surfaces must preserve the chosen palette. | All ten saved locales booted in their language. The new light theme persisted on reload in public, app and admin surfaces. Persian and Arabic initialized RTL. |
| P2 | Correct focus, dense content and mixed-direction layout in the wallet chooser, settings and admin overview | Keyboard focus can escape a portal or remain trapped after dismissal. Wallet addresses must remain readable. | Verified focus cycling and restoration, both theme labels, number spacing and the direction and alignment of a Persian account's address. |
| P3 | Check each real game and repair the Hokm hand fan and tabletop labels | Incorrect scaling can move card hit targets or make game text unreadable on light surrounds. | Ten formats at twelve sizes. All five games committed an action. The full 13-card hand fit at 320 px. Four-seat labels, black trump and dealer ink were measured in Persian light mode. |
| P4 | Audit art, animation and sound. Improve `tools/art/sound.mjs` and the seven affected packs. | Lossy encoding, changing variants and concurrent effects can introduce loud peaks. Muting must still work. | All 90 standard scoreable takes measured at or below −1.2 dBFS peak. Ludo's reduced-motion roll committed. Gesture unlock, independent mute switches, cue starts and music startup were exercised. |
| P5 | Correct stale desktop tracks in the app shell and check responsive layouts | A freshly visited mobile page can fit even when a desktop-to-phone resize overflows. | Reproduced Friends reaching 544 px on a 320 px viewport. Retested with desktop device state held across the resize. The document fit at 320 px. |
| P6 | Repair profile summary refresh in `people.store.ts` and release image-processing resources in `redraw.ts` | Old requests can restore another session's data. A constructor or transfer error can leave a bitmap, worker or Blob URL alive. | Added four regression tests. The corrected paths refreshed changed cosmetics, rejected stale responses, fell back to the page encoder and released resources. Repeated mounted-game navigation measured below. |
| P7 | Reduce redundant reads in the match service and verify notification concurrency | Preserve private-hand projection and ledger order. Concurrent publication or dismissal must deliver the correct recipient list. | One fewer SELECT for existing match views and deltas. Separate PostgreSQL checks covered retraction and group-call publication against end. |
| P8 | Run instrumented browser journeys and live socket checks | Use signed disposable accounts for writes. Use dedicated data for cursor boundaries and realistic board formats. | Real tournament creation, admin search/pagination, keyboard and touch input, verdicts, win/loss/draw return timing and WebSocket checks passed. Corrected missing revision values in the socket test fixtures. |
| P9 | Build, typecheck and verify the integrated result | Standalone game checks do not cover changes shared with the shell. | Rebuilt the final source with the production pipeline. Both locale/theme route matrices finished on that build. Diff whitespace and index state were checked. |

## Real browser coverage

Playwright MCP 0.0.86 connected to headed Google Chrome on Windows. The route sweep visited 66 concrete URLs per language, including all five game detail and creation pages, public and authenticated recovery paths, and seeded dynamic records. Five were public, 40 were player URLs and 21 were staff URLs. Each received twelve viewport checks in English dark and Persian light, giving 1,584 route/viewport/theme observations. The admin root redirected to its overview. Each page had visible content, the expected document direction and palette, no uncaught page errors and no document width exceeding the viewport by more than one CSS pixel.

| Portrait phone | Tablet and short landscape | Laptop and desktop |
| --- | --- | --- |
| 320×640, 360×800, 375×812, 390×844, 430×932 | 768×1024, 1024×768, 844×390 | 1280×800, 1440×900, 1920×1080, 2560×1440 |

A separate 390×844 network and image pass completed on all 66 URLs. There were zero failed transports and zero broken loaded images. Two cases intentionally returned HTTP 404 and logged the corresponding resource error. The missing public URL served the recovery page. The wallet checker requested a proof for a completed, unstaked Chess game. The proof endpoint returned 404 and the checker displayed the proof-unavailable state.

| Browser journey | Observed outcome |
| --- | --- |
| Touch the card category, reload, open full rules and dismiss by keyboard | The filter and filtered catalogue survived reload. Escape dismissed the rules dialog. |
| Open the long network-explainer tooltip on the real sign-in screen | The touch context-menu gesture displayed all 143 Persian or 125 English characters. The bubble stayed inside the viewport at 320×640 in both directions, 390×844 Persian and 844×390 English. |
| Submit a tournament creation form | A blank title disabled submission. A valid name created a real tournament and opened its detail page. |
| Staff directory with more than a page of users | Cursor pagination increased the rendered list from 50 to 55. Searching for the synthetic account returned exactly one record. |
| Five real boards and their effects | Ludo roll, Hokm trump, Backgammon opening, Poker call/check and Chess e2–e4 received server acknowledgements. Game-specific screenshots and contrast readings are in the media review. |
| Complete multiplayer matches | Ludo finished with all four tokens home (288 actions), Backgammon with 15 checkers borne off (87), Hokm at 7–0 (287), Poker after three hands and a bust (12), and Chess by checkmate (4). All 678 accepted HTTP actions were checked against freshly fetched revisions. Chrome showed the winner and correct standings for all five, and every participant's seated list released the finished table. |
| Completed table | Both sides of a Fool's Mate and the participants in an agreed draw saw the result and standings. The finished tables left the seated list. The three foreground result screens returned to Games after 9.83–9.95 seconds. A real tab switch kept the result for 14.312 seconds hidden and returned after 10.005 foreground seconds. |
| Two-player voice and chat during Ludo | Two freshly signed-in guests joined a table with a synthetic audio source. Both native WebRTC peers sent and received audio packets, a die roll advanced the server revision, the other player received the chat, and leaving voice closed both peer connections. |
| Verifiable randomness in the browser | The real client checker accepted signed engine-generated transcripts for Ludo, Backgammon, Hokm and Poker, and rejected an altered final event for each. These eight display checks supplied test-fixture responses at the proof endpoint. The network sweep separately exercised the real unstaked endpoint. |

## Runtime and memory

One foreground desktop navigation per game and the catalogue was sampled with the browser Navigation Timing and Resource Timing APIs, a buffered largest-contentful-paint observer, and 45 animation-frame intervals. Values below are in milliseconds on this workstation over loopback. The largest paint is the last candidate reported during the measurement window. Frame times describe a settled board.

| Route | DOM content loaded | Load | Largest paint | API requests | Request p95 | Frame interval p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Games | 28 | 28 | 284 | 25 | 9.7 | 6.1 |
| Ludo | 28 | 28 | 516 | 34 | 11.9 | 6.1 |
| Hokm | 26 | 26 | 560 | 32 | 10.8 | 6.1 |
| Backgammon | 27 | 27 | 180 | 34 | 12.1 | 6.1 |
| Chess | 29 | 29 | 728 | 32 | 11.4 | 6.1 |
| Poker | 26 | 26 | 524 | 32 | 10.1 | 6.1 |

The initial JS budget measured 62.5 KB of 63 KB on both builds. The final app shell measured 9.1 KB, the largest table chunk 22.6 KB of 24 KB and the largest route chunk 15.0 KB of 15 KB. The shipped standard audio pack sizes stayed constant. The initial bundle and largest route have little remaining budget.

Heap samples followed actual same-document navigation, verified route headings and live game stages, and CDP garbage collection at the same point in the catalogue. The baseline Chess → fitting room → settings → games workload ran 34 tours and ended at 11.61 MiB. The final wider workload ran 12 tours over all five games, the fitting room, settings and catalogue. Its last four collected heaps were 14.31, 14.41, 14.49 and 14.50 MiB. All four had 769 visible nodes, 9,912 CDP nodes and 17 documents. Listener counts were 150, 150, 149 and 149. A separate 14-tour run of the wider workload also levelled off around 15 MiB. The workloads differ, so their endpoints cannot quantify a memory saving. The final run recorded three long tasks of 180, 57 and 54 ms during navigation.

The resource review traced match subscription teardown and pending-frame expiry, scene disposal, animation cancellation, finite audio pack caches, object URL ownership and recorder/connection cleanup. The reproducible defects were stale profile requests and the image worker setup failure. A real device-to-device audio call and an overnight soak remain outside the measurements.

## Local staked-match settlement

Two programmatic synthetic wallets used the Arcade cashier API to deposit 100,000 test units each in a freshly deployed ArcadeVault on a disposable Hardhat chain (chain ID 31337). Both players signed stakes of 5,000. The vault locked both stakes before the first move. A checkmate submitted through the Arcade match API triggered settlement at 101,246 gas. The winner withdrew 1,000 units. On-chain balances then showed 103,500 for the winner, 95,000 for the loser and 500 in fees. Both locks cleared and the deposits, withdrawal and remaining vault balance reconciled.

The independent suite from the sibling SmartContract checkout at `97e190d` had 48 passes and one failing gas-budget assertion. The two-seat settlement cost 100,689 gas against a limit of 100,000 at `test/ArcadeVault.test.ts:1087`. The Arcade integration used gas estimation and completed. The local receipts are in `.playwright-mcp/product-review/stake-local/`.

## Gates and reproducibility

| Gate | Outcome |
| --- | --- |
| Baseline `npm test` | 2,389 backend and 2,423 frontend passes. Sixteen socket tests were opt-in. |
| Final `npm test` and `npm run test:shuffle` | Each run passed 2,389 backend and 2,428 frontend tests. The default run skipped 16 opt-in socket tests. |
| `npm run test:ws -w backend` | All 17 tests passed on real loopback sockets. The first isolated run found two test cases that sent an outdated play-frame shape. The corrected cases exercise ordered acknowledgements for consecutive actions, a refused play and validation of unexpected fields. |
| `npm run check:full` | The frontend check covered 1,075 files. API and backend test type checks passed. The repository declares no standalone lint command. |
| `npm run build` in an isolated copy | Backend compile, browser/server bundling, prerender, precompression and bundle/asset budgets passed. |
| `tools/review/interface.mjs` | Repeatable browser regression for all ten locales and four theme, viewport and keyboard scenarios. Set `QA_BASE` to a running local instance. |
| `tools/review/contrast.mjs` | Checks rendered English desktop and Persian mobile routes against axe-core’s text contrast rule. The light-theme review includes setup and separate measurements over gradients and artwork. |

The local evidence directories are excluded from Git. `.playwright-mcp/product-review/` holds the route records, screenshots, network receipts, heap series, performance samples and SQL trials. `.playwright-mcp/game-audit/` holds board screenshots and per-game measurements. `.playwright-mcp/responsive-ux-check/` holds the focused shell, wallet and localization captures. The disposable accounts and database are local to the review.

## Coverage boundaries

The full route matrix used desktop Chrome. Separate WebKit iPhone 15 emulation and desktop Firefox runs covered all three roles, both languages, themes and all five boards. Physical iOS Safari, native long-press behavior, on-device screen readers, speaker listening, production network latency and sustained mobile GPU load require separate measurements. Real-money wallet transfers, production chain settlement, destructive admin operations and multi-hour multiplayer series were outside this local run.
