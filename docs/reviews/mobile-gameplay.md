# Mobile gameplay review

The five live tables are Backgammon, Chess, Ludo, Hokm and Poker. Each already had its own renderer, turn presentation, sound cues and game-specific assistance. The main interaction problem was the distance between choosing an object and understanding what releasing or tapping it would do. The following changes apply to the signed-in match screen.

## Backgammon

On a phone, the old forced-move shortcut could advance a checker when the player was trying to inspect its moves. Point selection used board geometry, but legal points could be little more than a finger-width apart even across two adjacent columns. Dragging also interpreted an upward visual offset as the destination and clamped releases back into the board.

A tap now selects a whole stack. The player can inspect the legal destinations on the board, change stacks, tap the same stack to deselect, or tap outside to cancel. A second tap on a point or the bear-off tray stages the destination. Hit testing uses the full point column, including the nearby rim, so players can tap the stack or the board space below it. On the narrowest phones the finite number of columns keeps point widths below 44 CSS pixels.

The player taps the board dice to roll or confirm and the cube to double. Spent dice dim on the board. To undo a staged step, tap the marked last checker. If it can continue moving, select it and tap its marked starting point. The engine supplies the available continuations. Mouse users retain the forced-move shortcut and the keyboard cursor remains available.

## Chess

Moving the carried artwork above the finger previously moved the drop coordinate too. A release over the board could also change selection without a corresponding press. Touch drags now place the piece on the square under the finger in either board orientation. Tapping a piece exposes legal targets directly on its board. Tapping a marked square plays the move. An invalid destination gives feedback and leaves the legal choices available.

Chess keeps the seat-relative board, move history, clocks, keyboard cursor and promotion choices. The renderer plays the accepted move from the match event. The short landscape layout reserves space for the action area so the board clears the match header.

## Ludo

A tap on a pawn or a nearby route marker used to commit immediately. Stacks made choosing a pawn difficult, and route isolation depended on hover. Touch now previews the pawn and keeps its route highlighted. Tapping its marked landing commits the move.

The choices use the controlling seat and the moves in the current match view, including partner play. A turn change invalidates the preview. The center die, mouse shortcuts and keyboard input remain available. Pawn movement follows the accepted match update.

## Hokm

A full hand could fit into one tightly overlapping fan, giving each middle card a narrow exposed edge. Touch hands now use balanced rows based on the available room and card count. The original fan remains available to desktop players. A tap lifts the chosen card. A second tap on that card plays it. Suit restrictions and playable cards come from the player's private match view.

Touch dragging highlights the felt and tests the actual release position. Cancellation returns the card to the hand. Selection and pending input are cleared when the match revision changes. Trump choice, discards and draw decisions retain their own controls.

## Poker

The hole cards convey information. The touch decisions are fold, check, call or raise. Previously the action labels competed with the cards for horizontal space, the call price was primarily announced to screen readers, and a short-stack all-in could be triggered with one tap.

The narrow layout gives betting actions room for wrapped labels and shows the call cost against the pot. Players can adjust or cancel a raise before sending it. Touch all-in calls and bets require confirmation. The controls use the server's call amount and raise bounds and retain the existing chip, showdown and payout presentation.

## Shared behavior

The board and card handlers share primary-button admission, a 10 CSS pixel touch movement threshold and a 4 pixel mouse threshold. Each game decides what constitutes a legal target. Drag-capable surfaces track the initiating pointer and handle cancellation and lost capture. Haptics use the existing opt-in, rate-limited service. The existing table hint can be opened by touch or keyboard and announces its expanded state.

The touch toolbar keeps settings, rules and exit actions in the table menu after rotation. The match screen accounts for side cutouts and the top safe area when app navigation is hidden. Entering fullscreen from a touch device keeps the overlay host reachable and allows rotation. The changes reuse the existing match transport, revision checks, idempotency keys and result handling.

## Browser and multiplayer verification

Playwright drove signed-in matches against a local API and disposable PostgreSQL databases. The final production build was served separately from the workspace. Chromium's touchscreen and touch-event injection exercised taps, movement and cancellation. The desktop checks used a mouse and keyboard. Phone profiles ran on Windows in Chromium, WebKit and Firefox.

| Game | Interaction checked | Edge cases checked |
| --- | --- | --- |
| Backgammon | Selected and switched stacks, deselected, dragged, canceled, undid staged moves, confirmed the turn and rolled from the opposing client. | Deterministic match views exercised bar entry with a hit, forced high-die bear-off and an ambiguous bear-off. The engine now reports remaining dice and distinguishes the case where a later move determines which die was spent. |
| Chess | Played from both seat orientations, tested the square under the finger and an outside drop, and exercised mouse drag and keyboard selection. | Played a legal sequence to promotion, opened all four choices and captured a rook while promoting to a knight. The first release left the chooser open. A forced WebSocket disconnect followed by two legal moves cleared the old selection on reconnect. |
| Ludo | Rolled, previewed a pawn, tapped its landing and observed the move on both clients. | Tested the static renderer fallback at 320 × 568 with reduced motion enabled. |
| Hokm | Played a three-seat match with a 17-card hand. Selected cards, dragged to the felt, canceled drags, checked the follow-suit restriction and played with Enter on desktop. | At 320 CSS pixels the hand used rows of six, six and five cards. A delayed outgoing command lost a revision race to another legal card. Only the accepted card appeared in the trick across three clients. |
| Poker | Selected a pot-size preset, canceled, adjusted a raise, confirmed an all-in and confirmed the opponent's all-in call. Both clients advanced. | Checked the raise panel after rotation and its Escape/focus behavior on desktop. A WebKit landscape clipping issue was corrected and retested at 740 × 360. |

The production layout sweep covered 320 × 568, 360 × 740 and 430 × 932 portrait, 740 × 360 and 932 × 430 landscape, and 1280 × 850 desktop. Additional interaction runs used 390 × 844 and 844 × 390. The Pixel 7 profile ran in Chromium with Persian right-to-left layout. The iPhone 13 profile ran in WebKit with English layout. The table menu was opened and dismissed in each phone orientation. The sweep checked rendered board bounds, horizontal overflow, screenshots and browser errors.

In a separate Chromium check, a player entered fullscreen, rotated the device profile, reopened the table menu, left fullscreen and opened and closed chat. Simulated landscape cutout insets of 44 and 20 CSS pixels produced 68 and 44 pixels of left and right page padding, including the normal margins.

WebKit occasionally reported the previous orientation's layout when measured 300 milliseconds after a scripted resize. Foreground measurements after the viewport settled showed the expected dimensions. A separate run repeated the Backgammon rotation sequence 12 times. At 320 × 568 its board measured 308 × 253 CSS pixels each time. Physical Android and iOS hardware, browser chrome changes on a handset, haptic feel, VoiceOver and TalkBack were not tested.

## Build, performance and cleanup

- The normal and shuffled suites each passed 2,422 backend tests and 2,448 frontend tests. The default suite skips opt-in integration coverage. The separate real-socket run passed 17 tests, and the five PostgreSQL integration files passed all 10 tests against disposable databases.
- Both workspace typecheck commands, the production build, prerender and asset budgets passed. The largest of the five table chunks measured 23.0 KB gzipped against a 24 KB limit. The budget check reported 9.3 KB for the board renderer against a 16 KB limit.
- In a Chromium sample, each of the five boards was unmounted and remounted three times through client-side navigation. DOM-node and listener counts stayed level across the three post-GC samples for each game. The JavaScript heap grew by roughly 0.4 MB per game over that short run. These measurements do not establish long-session memory use, frame times or battery consumption.
- Independent teardown checks observed the Chess and Ludo board elements become collectible after leaving the match. The Ludo renderer removed its five host pointer listeners. The intentional renderer-load failure was the expected console error in that fallback test. The final successful live gameplay runs reported no page or console errors.
