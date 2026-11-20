# Light-theme text contrast

On 20 November 2026, Playwright MCP opened 66 public, player and staff URLs in light mode on a local production build. Each route ran in English at 1440×900 and in Persian at 390×844. The sessions used seeded accounts with the role each route required. Chrome rendered the production fonts, artwork and game surfaces.

## Measurements

The first axe-core 4.13.0 pass found 58 failing text nodes on English desktop and 39 on Persian mobile. Repeating that pass on the final build `5a8cbfb7d17ba1e8` found zero in either locale. The passing node counts were 4,834 and 2,436. The rule left 233 and 101 nodes respectively for human inspection, including text over gradients and imagery. These are counts of rendered instances across routes. They depend on the visible fixture data, and a shared component can occur many times.

To check gradients, translucent layers and game artwork, we captured the rendered text and the background at the same glyph positions. The table lists measured contrast ratios. Normal text needs 4.5:1 and large text needs 3:1 under WCAG AA. [WCAG 2.2 text contrast criteria](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)

| Surface and sample | Before | After |
| --- | ---: | ---: |
| English dashboard heading over the hero gradient | 1.07:1 | 6.91:1 |
| Persian featured Shop heading | 1.07:1 | 5.99:1 |
| Persian invitation description | 1.01:1 | 5.76:1 |
| Public profile join date, English desktop | 2.04:1 | 7.36:1 |
| Public profile join date, Persian desktop | 1.99:1 | 7.36:1 |
| Persian mobile navigation, scrolled over Hokm | 1.48:1 | 5.86:1 |
| Persian mobile navigation, scrolled over Ludo | 2.17:1 | 6.15:1 |
| Avatar initials, worst of 360 generated hues in light mode | 2.24:1 | 7.72:1 |
| Avatar initials, worst of 360 generated hues in dark mode | 4.05:1 | 5.13:1 |
| Selected filter count in light mode | 3.86:1 | 7.78:1 |
| Selected filter count in dark mode | 3.63:1 | 9.13:1 |
| Occupied seat name in the table lobby | 1.09:1 | 13.35:1 |
| Hokm seat clock over the felt | 2.09:1 | 6.67:1 |
| Ludo starting-color initial over the lit board | 1.56:1 | 5.18:1 |
| Chess coordinates over wood | 1.97:1 | 11.41:1 |
| Poker pocket caption below the raise sheet | 2.66:1 | 4.71:1 |
| Poker all-in action | 2.72:1 | 7.13:1 |
| Poker blinds | 3.94:1 | 9.57:1 |
| Room code in the table switcher | 3.54:1 | 6.24:1 |

The public-page pass covered 156 English and Persian views from 320 to 1440 px, including the navigation drawer, wallet chooser, public profile, touch layouts, reduced-motion posters and live WebGL landing scenes. All 1,565 sampled glyph readings met their applicable threshold. The lowest public reading was 5.40:1 on the 320 px sign-in screen. On 49 signed-in player and staff routes per locale, the additional screenshot measurements covered 2,654 English desktop samples, 1,346 Persian mobile samples and 924 Persian samples after scrolling.

On Persian mobile, one sample on the staff money page reached 3.63:1 six pixels from the viewport bottom, where the fixed navigation covered the text. Scrolling the explanation above the navigation cleared the overlap.

The final game pass checked 11 lobby, play, betting and result states in both languages at 320×640 and 1440×900. All 44 views fit their viewport. The eight raise and all-in views placed the action sheet above the dealer puck. On the 320 px Chess board the narrower clock rail kept the player's own name visible alongside the clocks. Dark and red SVG card ranks measured 12.54:1 and 5.29:1 against the darkest paper stop.

At 320×640 the original Persian full-pot preset was truncated. The final label, «کل پات», fits alongside the other three presets. On a 200-chip flop, all four 64×40 px touch targets showed their full labels and selected the expected amounts of 20, 100, 200 and 1,400 chips.

## Repeating the automated check

Use a running local review instance and an installed copy of `axe-core` with its bundled `axe.min.js`. The opt-in check uses the repository’s Playwright and Chrome launcher. From the repository root in PowerShell, set the two paths for your system and pass the routes to check.

```powershell
$env:QA_BASE = 'http://127.0.0.1:5300'
$env:QA_AXE_PATH = 'C:\path\to\axe-core\axe.min.js'
node tools/review/contrast.mjs / /sign-in
```

For signed-in routes, set `QA_SESSION` to a disposable session cookie in `name=value` form. The runner accepts signed checks on loopback. It checks the language, theme and final route, prints the failing selectors and sets an unsuccessful exit status for a detected violation. The manual-inspection count identifies surfaces that need a separate rendered-background check. Screenshots and machine-readable measurements from this review are in the ignored `.playwright-mcp/product-review/` and `.playwright-mcp/game-audit/` directories.
