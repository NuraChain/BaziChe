# Product interface review

## Inventory

The route declarations in `frontend/src/routes.ts` use three shells. The public shell provides the site header, navigation drawer and wallet chooser. The signed-in shell selects the rail, sidebar, social column and bottom navigation according to viewport and route. The admin shell uses its own authorization and navigation. All three consume the surface, color, typography, spacing and elevation tokens in `frontend/src/styles/tokens.css`.

| Routes | Purpose | Interface risks reviewed | Priority |
| --- | --- | --- | --- |
| `/`, `/sign-in`, `/people/:handle`, `/join/:code` | Discovery, authentication and public entry links | Wallet keyboard focus, localized startup, narrow drawer, readable copy over the showcase | P1 |
| `/app`, `/app/games`, `/app/games/:slug`, `/app/games/:slug/create`, `/app/play/:id` | Game discovery, table creation and play | Sidebar and social-rail sizing, responsive controls, physical boards and assets under both palettes | P1 |
| `/app/tournaments`, `/app/tournaments/new`, `/app/tournaments/:code`, `/app/watch` | Tournament setup, events and spectators | Narrow filters, button rows, busy and empty states | P2 |
| `/app/friends`, `/app/people/:handle`, `/app/invite`, `/app/groups/:id`, `/app/g/:token` | Friends, profiles, invites and groups | Resize timing, horizontally scrollable tabs, mixed-direction names and handles | P1 |
| `/app/chats`, `/app/chats/:id`, `/app/channels/:slug` | Messaging and channels | Overlay focus, message composer space, touch and long mixed-direction text | P2 |
| `/app/leaderboard`, `/app/discover`, `/app/search`, `/app/notifications` | Rankings, discovery, search and notifications | Tabs, filtering, loading and empty states, dark and light text contrast | P2 |
| `/app/shop`, `/app/shop/collection`, `/app/shop/lab`, `/app/rewards` | Catalogue, previews, owned items and claims | Art surfaces, semantic status colors, modal and preview readability | P2 |
| `/app/me`, `/app/me/nfts`, `/app/me/wallet`, `/app/me/wallet/check/:id`, `/app/me/settings`, `/app/me/devices` | Profile, wallet and device management | Persistent appearance control, long identifiers, mixed-direction content and form feedback | P1 |
| `/admin`, `/admin/overview`, `/admin/live`, `/admin/people`, `/admin/people/:handle`, `/admin/reports`, `/admin/reports/:id` | Staff dashboards, user records and reports | Rail and bottom tabs, dense controls, text contrast and role badges | P1 |
| `/admin/play`, `/admin/tournaments`, `/admin/tournaments/:code`, `/admin/shop`, `/admin/invites`, `/admin/rewards`, `/admin/system`, `/admin/notice`, `/admin/seasons` | Staff game and programme operations | Lists, filters, paginated records, form validation and RTL | P2 |
| `/admin/money`, `/admin/money/checks`, `/admin/staff`, `/admin/log` | Finance and staff workflows | Dense numeric and technical rows, high-contrast statuses, accessible actions | P1 |
| Public, app and admin catch-alls | Missing pages and recovery | Shell navigation, language and error treatment | P2 |

## Baseline and implementation

| Task | Baseline | Implementation and source | Acceptance check | Regression risk |
| --- | --- | --- | --- | --- |
| Add a light theme and improve shared dark contrast | Only Arena Blue was available. Small dark-theme foreground tokens measured 4.02–4.33:1 against the lifted surface. | `tokens.css` defines a cool light palette with separate semantic colors and a dark modal scrim. The existing dark palette remains the default, with brighter text and status foregrounds. | All shells can use the new palette. Body, muted and status labels remain distinguishable. Board and showcase artwork keeps its physical materials. | Photos and game art deliberately use fixed colors. Verify surrounding text, tinted backgrounds and dialog borders in both palettes. |
| Persist appearance and locale | Eight supported language cookies reset to English on startup. Arabic also booted left-to-right. | `index.html` applies the locale, language direction, theme and browser bar color before hydration. `theme.store.ts` and `theme-picker.component.azeroth` share the browser preference across the site drawer, app settings and admin navigation. | Reload preserves light and dark selections. All ten supported languages keep their document language. Persian and Arabic use RTL. | The static entry and generated localized pages must honor the same supported codes. |
| Contain wallet chooser keyboard navigation | Playwright MCP reproduced five focus escapes in each of four public checks, including reverse tabbing to a footer link from the dialog. | `connect-dialog.component.azeroth` cycles focus inside the chooser and marks background content inert while it is open. `app.css` locks background scrolling with the existing drawer rule. | Tab and Shift+Tab never enter the underlying page. Escape closes the chooser, releases the lock and returns focus to the opener. | Test narrow and short viewports, plus reduced-motion close and footer navigation after dismissal. |
| Keep the app shell within the viewport during resize | The route sweep reported a 544px document on Friends at phone widths. The stable page measured 320px at a 320px viewport. Holding the device store at the desktop width while resizing reproduced 544px, the combined width of the 240px sidebar and the 304px social panel. | CSS viewport guards in `app-shell.component.azeroth`, `sidebar.component.azeroth`, `nav-rail.component.azeroth` and `social-panel.component.azeroth` keep desktop tracks and rails out of narrow layouts while the device store catches up. | A cold phone visit and a desktop-to-phone resize leave the page within the viewport. The Friends tab strip can still scroll independently. | Verify the rail, sidebar and social panel at their exact breakpoints. |
| Refine appearance labels and mixed-direction details | Screenshots showed a shortened Light choice in Settings, a wallet address aligned opposite its Persian account copy, and two admin facts with missing spaces. | The picker uses the language selector's width in Settings and fills the drawer. The Settings address is explicitly LTR and inherits the account row's alignment. Admin fact links render a space between the count and description. | Both theme labels fit, the address reads left-to-right at the Persian row's start, and the overview facts read as two words. | Recheck after fonts load and at mobile widths. |
| Preserve contrast over the public showcase | The light-theme menu inherited a dark foreground over dark artwork. The gradient also faded inside the desktop text column. | `app.css` keeps the light header surface present from first paint. `base.css` gives the light gradient a longer hold along the reading side, with a mirrored direction in RTL. | The menu and landing copy are legible over the showcase in portrait and landscape. | Check the gradient with the live showcase and the reduced-motion poster. |

## Browser verification

Playwright MCP ran against the disposable local application using isolated contexts. The focused baseline used 320×640, 390×844, 844×390 and 1280×850. The recheck with the device store held at desktop width measured 320px of document width at a 320px viewport. Settings and Admin overview switched palettes and retained them after reload on both 1280px English and 390px Persian layouts, with no page errors or horizontal overflow. Both theme labels fit. The Persian account's wallet address aligned to the right while reading left to right, and both admin counts had a separating space.

The solid foreground tokens were checked against the five solid surfaces. The lowest contrast was 5.17:1 in dark mode and 5.34:1 in light mode. Light landing screenshots gave 5.33:1 at the menu icon and 6.12–7.28:1 at the sampled edges of intro copy across 1280px English, 390px Persian and 844×390 Persian. The wallet chooser contained keyboard focus in all three scenarios and restored it after Escape.

The repository regression script checks all ten saved locales and the public theme and wallet flows in four viewport and language combinations. It passed against an isolated application frontend.

The cross-browser pass used WebKit 26.5 with Playwright's iPhone 15 device settings and Firefox 157 on desktop. Both engines completed the public, signed-player and admin journeys in English and Persian. Across the two engines all 40 game, language and palette combinations fit the available viewport on both axes. The tooltip cases contained the full text. The mobile WebKit check triggered the touch context-menu event in software. The reduced-motion poster and keyboard focus checks passed after the pages settled.

Firefox rejected an optional saved push-subscription lookup with `AbortError`. The lookup now reports an unavailable subscription and callers can continue rendering. The regression in `frontend/tests/system-notice.spec.ts` exercises the rejection. Firefox also exposed the Mythic shop badge's white lettering on a fixed pastel gradient in light mode. Fixed dark ink raised the minimum sampled contrast from 1.26:1 to 11.11:1. The cross-browser run completed without uncaught page errors.

```sh
QA_BASE=http://localhost:5300 node tools/review/interface.mjs
```
