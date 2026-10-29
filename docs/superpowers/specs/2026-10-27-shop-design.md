# The shop: looks people buy with NURA

The owner, 2026-10-27: "Ok Now on each game page https://baziche.com/app/games/hokm or ludo or etc
add shop button for example on these shop for example on ludo we can sell custom dice or custom
color table or animation table on each side i mean theme for my part or card theme with custom
animations such as discord it have for example or Profile Effects or Avatar Decorations or Profile
Themes / Cosmetics you know what i mean ... i want to make money from this platform by selling theme
of games or idk what is best bussines plan of shop and best ui ux for it also remember for example i
bought card theme for my poker and it change my card theme but you didnt buy this theme so you can
see man card theme it is custom but your card theme should be normal on your hand but in my hand you
can see it theme". While the plan was being written: "they should pay for this buy nura coin
nurachain.net", then "for payment i think you should use smart contract [in the SmartContract
project] add it here on baziche".

So: a shop that sells looks for NURA through a contract of our own in the SmartContract project's
`contracts/baziche/`, a Shop button on every game page, Discord's kinds of profile looks, and the
owner's rule that **a look is drawn on its owner's things for everybody who sees them, while
everybody else's things stay as they chose**. This file is the design: the business (1), a purchase
(2), the contract (3), what is sold (4), who sees what (5), the pages (6), the admin (7), the data
(8), the decisions with what was not chosen (9), and the order of work (10).

## 1. The business

- **Looks only.** Nothing sold changes a rule, a chance, what anybody may see, or a paid table, and
  every look stays legible (section 5).
- **Priced in NURA and paid from the buyer's own wallet through `ArcadeShop`.** Somebody without
  NURA is sent to nurachain.net to get it. No card payments, no premium currency, no subscriptions,
  no loot boxes and no resale: the price is what is paid, and the look is theirs for good.
- **Four collections at launch**, each complete across every kind, each with a bundle 30% under its
  parts:

  | Collection | Persian | The look |
  |---|---|---|
  | Nura Glow | درخشش نورا | the brand's light: navy and Arena Blue with white-gold sparkles |
  | Shiraz Garden | باغ شیراز | turquoise and lapis tilework, girih stars, gold lines, pomegranate red |
  | Midnight Neon | نئون نیمه‌شب | black with magenta and cyan edges and glow |
  | Royal Gold | طلای سلطنتی | black and polished gold, filigree |

- **Tiers by what a look does**: common (still) 5 NURA, rare 12, epic (animated) 25, legendary (the
  collection's centrepiece, animated) 50. These are defaults the staff change in Admin › Shop,
  because NURA's price moves. A sale has a real end; a bundle is priced down for what the buyer
  already owns.
- **Gifts.** A look bought for a friend, who is told who sent it. Friends only, so no stranger can
  send a minor anything.
- **Inviters earn.** Whoever brought a buyer in (a counted invite) earns 10% of what that buyer
  spends in the shop, credited by the contract and claimed from the wallet page, as the vault
  already gives inviters a share of its fee. The owner sets the share on the contract, 0 to 30%.
- **Everybody sees it.** A look shows on its owner's things at every table, on the profile and in
  lists, which is what sells it; from a player's plate at a table their looks there are named, each
  leading to the shop.

## 2. A purchase

```
 browser                          Arcade server                           ArcadeShop (NuraChain)
   | POST /shop/orders {item, for?} |                                          |
   |------------------------------->| order (price, recipient, 30 minutes)    |
   |                                | signs Quote(order, buyer, item, price,  |
   |                                |   referrer, deadline) with its key      |
   |<-------------------------------| unsent call: buy(quote, sig), value     |
   | the wallet sends it ------------------------------------------------------>| seller's signature, buyer,
   | POST /shop/orders/:id/sent {hash}  (a nudge)                                 | price, deadline, order
   |                                | worker: saleOf(order) every 3 s ------->| unused; records the sale,
   |                                | sold: the look delivered, one tx        | credits the inviter, Bought
   |<--------- me/shop ring --------| gift notice, buyer and recipient rung   |
```

- **The server never holds NURA and never takes the browser's word.** It delivers when the contract
  says the order is sold (`saleOf`, by the order's id), so a closed tab or a lost transaction hash
  loses nothing. The hash only lets the page say what NuraChain did (a revert read back as its
  error) and wakes the worker sooner.
- **A quote lives thirty minutes.** After it the contract refuses it, the order expires, and the
  next press makes another. One open order per recipient and look (a lock per recipient in the
  transaction that writes it), so two friends cannot pay for one gift.
- **The contract refuses every wrong payment**: another buyer, another price, an expired quote, an
  order already sold, a quote the shop's key did not sign. NURA never leaves a wallet for a sale that
  would not count.
- **Delivery is one transaction** with the order row locked: the order is `paid` and the looks are
  inserted (a bundle: each one the recipient lacks). A look the recipient owns by then (a staff grant
  in between) leaves the order `delivered: false` and listed for a refund.
- **A refund is the owner's**: Admin › Shop composes `refund(order)` for the owner's wallet, the
  contract sends the price back to whoever paid it, and the worker sees the sale refunded and takes
  the look back.

## 3. The contract: `ArcadeShop`

`contracts/baziche/ArcadeShop.sol`, beside `ArcadeVault` and `ArcadeAchievements`, in their style:
NatSpec, custom errors, events, no upgradeability (a new version is a new address).

- **Inherits** `AccessControlDefaultAdminRules` (one owner, handed on in two steps), `Pausable`,
  `ReentrancyGuard` and `EIP712("ArcadeShop", "1")`, and checks a signature with `SignatureChecker`.
- **Roles.** The owner (`DEFAULT_ADMIN_ROLE`); `SELLER_ROLE`, held by the Arcade server's key (the
  one key it signs with, `NURA_REFEREE_KEY`), one seller at a time and replaced by `setSeller`, which
  is the kill switch: a leaked seller key can sign quotes and nothing else, so the worst it does is
  give looks away, and it never moves NURA; `PAUSER_ROLE`.
- **`buy(Quote q, bytes sig)`**, payable. `Quote(bytes32 order, address buyer, bytes32 item,
  uint256 price, address referrer, uint64 deadline)`. It refuses unless `msg.sender == q.buyer`,
  `msg.value == q.price` and the price is above nothing, the deadline has not passed and is no more
  than a day away, the order has not been sold, and the seller signed it. It records
  `Sale { buyer, item, price, referrer, paidAt, refunded }`, credits `earnings[referrer]` with
  `referralBps` of the price, adds the rest to `revenue`, and emits `Bought`. Pausing stops `buy`
  and nothing else.
- **`refund(order)`** (the owner): the price back to the buyer; the inviter's credit is taken back
  while it is unclaimed, and comes out of revenue once claimed; `Refunded`.
- **`withdraw(to, amount)`** (the owner): revenue only, never what inviters still have to claim.
- **`claim()`**: an inviter takes their earnings, whenever they like, paused or not.
- **`setReferralBps`** (the owner, 0 to 3,000) applies to sales after it.
- **Views**: `saleOf`, `revenue`, `earnings`.

Its suite: Mocha for every rule and refusal, the typed data against viem's, a quote replayed across
orders, chains and contracts, a re-entrant buyer and inviter, pause; Solidity fuzz over prices,
shares and deadlines; an invariant run in which the balance always covers revenue plus unclaimed
earnings; 100% line and branch coverage. `ignition/modules/baziche-shop.ts` deploys it as a group of
its own, so the deployed vault and achievements are never deployed twice. The NuraChain deploy needs
the owner's key and is the owner's step.

## 4. What is sold

| Kind | Chosen for | Drawn on |
|---|---|---|
| Avatar decoration | everywhere | a frame round the owner's picture in every list, plate, chair, chat line and profile |
| Profile effect | profile | plays over the owner's profile when somebody opens it |
| Profile theme | profile | the cover and colours of the owner's profile and of the sheet about them |
| Nameplate | lists | the ground behind the owner's name in friend, member, search and leaderboard rows |
| Dice | Ludo, backgammon | the dice the owner throws |
| Pawns | Ludo | the owner's four pawns, in their seat's colour |
| Yard | Ludo | the owner's corner of the board, its colour kept, with a slow motif |
| Card back | Hokm, poker | the backs of the owner's cards |
| Card faces | Hokm, poker | the faces of the owner's cards, the standard indices kept |
| Felt | Hokm, poker | the felt in front of the owner's seat, alive while it is their turn |
| Chips | poker | the owner's stack and the chips they bet |
| Checkers | backgammon | the owner's fifteen, light or dark as their side is |
| Home board | backgammon | the six points of the owner's home board |
| Chess set | chess | the owner's pieces, white or black as their side is |
| Celebration | every table | plays from the owner's side of the table when they win |

Fifteen kinds in four collections make 60 looks and 4 bundles, and every slot has Classic, free and
always the reader's. A card back, card faces and felt are owned once and chosen per game (Hokm and
poker each have their slots), and so are dice (Ludo and backgammon).

**The art is ours.** `tools/art/looks.mjs` draws every look from its collection's tokens into
`frontend/public/looks/`: pawns, checkers and chess sets in each collection's material (glass,
glazed tile, neon-edged obsidian, polished gold; the chess sets by `tools/art/chess.mjs`), card backs
as patterns (girih, sparkle tiling, neon grid, filigree), faces recoloured from the classic deck, and
decorations and nameplates as animated SVG with a still twin. Dice, chips, felt, yards, home boards,
effects and celebrations are tokens the page animates, with transform and opacity only.

## 5. Who sees what

A look is drawn on its owner's things for everybody who sees them; everything else is as its owner
chose, or Classic. The table's own things are the house's and stay Classic: the deck and the stock,
poker's board and pot, backgammon's cube.

| Game | In its owner's look |
|---|---|
| Ludo | each pawn (its owner's, also when a partner moves it); the die of whoever throws; each yard |
| Hokm | a card in a hand, dealt to it or played from it; a pile of tricks in the look of the seat it lies beside; each felt |
| Poker | each player's two cards (backs to others, faces to them and at the showdown); their stack and bets until they reach the pot; their felt |
| Backgammon | each side's checkers and home board; the dice of whoever throws |
| Chess | each side's pieces, its captures in the tray, its promotion chooser |
| Every table | the winner's celebration; the decorations on the plates |

**A game keeps the looks it began with.** As a game starts the server copies each player's looks for
that game into `match_players.look`, and the match view carries them on each seat, so every player
and every watcher draws the same and nothing changes mid-game. A look chosen later shows from the
next game, and the page says so.

**Legible whoever mixes what.** Pawns keep their seat's colour as the body. A checker set or a chess
set has a light side and a dark side whose luminances stay far apart, so two sets on one board still
read as two sides. Card faces keep the standard indices with ink at 4.5:1 to the face, and dice pips
4.5:1 to theirs. Nothing moves for somebody who asked for less motion. Specs measure every look's
tokens against these.

## 6. The pages

- **Shop** (`/app/shop`): the featured collection on top (an animated preview, its bundle and its
  price); filters in the address (`for`: All, Profile, Ludo, Hokm, Poker, Backgammon, Chess);
  sections (Bundles, New, On sale while something is, then each kind) as rails on a phone and grids
  as the page widens. A card is a live preview (moving only while it is on screen and never under
  less motion), the name, an edge for its tier (rare blue, epic violet, legendary gold) and the
  price, or Owned, or In use. The wallet's NURA stands beside "Get NURA". The shop's doors are drawn
  only while it is open, as the wallet page's are only beside a vault.
- **A look** (`?item=` in the address; a sheet with two heights on a phone, a dialog of two columns
  on a desktop): a large preview tried on the reader (their picture, their name, their table), Play
  again for an animated one, the four seat colours for pawns, a fan of cards; where it shows; its
  collection and that collection's bundle with what it saves; Buy and Gift, or Use it and In use.
- **Buying without leaving the sheet**: Buy, then "Pay 12 NURA from 0x12…ab, plus NuraChain's fee",
  then the wallet, then "Waiting for NuraChain…" with the transaction, then "It's yours" with the
  collection's own small burst and Use it now. Short of NURA: how much, and Get NURA. A guest is asked
  to connect a wallet; a minor is told they cannot buy. Declined in the wallet, another account,
  another chain, a quote the contract refused: each has its own sentence, and nothing is paid.
- **A gift**: choose a friend (with a search; whoever owns it already is marked), pay, "Sent to
  Sara". The friend gets a notification and a toast with Use it.
- **Your collection** (`/app/shop/collection`): by area, a row for each slot with Classic and what is
  owned, chosen with one press (shown at the press, taken back with a sentence when refused); a card
  for each game with everything chosen there together; gifts and who sent them; orders with their
  state and transaction; the shop's earnings from people the reader invited, and Claim.
- **The doors**: Shop in the sidebar and the rail; on a game page a Shop button beside Quick play and
  Create on a desktop, a bag in the phone's bar, and a strip of that game's looks with See all; a card
  on the profile; "Your look here" in a table's menu (that game's slots, from the next game). The
  sheet about a player opened from a plate names their looks at that table, each leading to the shop.
- **Words**: the shop's interface in all ten languages; the looks' names in English and Persian, as
  everything the server sends in two languages is; Persian as people say it («فروشگاه»،
  «کلکسیون تو»، «استفاده کن»، «هدیه بده»، «نورا بخر»).

## 7. Admin › Shop

A section of its own, `shop`, for an admin and the owner.

- The catalogue in collection order: each look's price, sale (a price and an end), status (on sale,
  hidden, retired) and sales. A change takes a reason and writes a row of the log (`shop-item`), and
  so does the featured collection (`shop-feature`).
- The orders, newest first by keyset, by state, look and person, each with its transaction, and the
  deliveries owed a refund in "Needs you".
- A look granted or taken back (`shop-grant`, `shop-revoke`), by the rank rule a note follows.
- The money: `money` reads it and `wallet` (the owner) acts on it. The contract's revenue, what
  inviters have to claim, the seller and whether it still holds its role; withdraw, refund an order
  (`shop-refund`), a new seller, pause and resume, each composed for the owner's wallet and asked of
  the contract first, as the vault's calls are.
- The overview counts the shop's revenue (the day, the week, all) from the database.

## 8. The data

- `shop_items`: the catalogue's id, the price and any sale price in wei, the sale's end, the status.
  Seeded from the code at every boot, never overwriting a price, a sale or a status (the rule
  `games.status` follows). `shop_collections` says which collection is featured.
- `owned_items`: person, look, when, how (purchase, gift or grant), the order, who gave it.
- `equipped_items`: person, slot, look, with a foreign key to `owned_items`, so a look taken back
  comes off.
- `shop_orders`: buyer, recipient, look, price, referrer, the quote's deadline, the state (quoted,
  sent, paid, expired, failed or refunded), the hash (one hash pays one order), whether it delivered,
  and the times.
- `match_players.look`: jsonb, written as a game starts, `{}` for Classic.
- The notification kind `gift`; the log's kinds `shop-item`, `shop-feature`, `shop-grant`,
  `shop-revoke`, `shop-refund`.
- `domains/shop/catalogue.ts` imports nothing and both halves read it: kinds, slots, collections,
  tiers, and each look's id, kind, collection, tier, default price and names. The art is the
  browser's (`game/looks/`), held to the catalogue by `satisfies` and by a spec in both directions.
- `NURA_SHOP_ADDRESS` (the contract, a public value) joins `.env.example`. The shop is open when it,
  `NURA_REFEREE_KEY`, `NURA_RPC_URL` and `NURA_CHAIN_ID` are written; written empty, it is off.

## 9. Decisions

| | Decision | Taken | Not chosen |
|---|---|---|---|
| SH-D1 | Payment | NURA from the buyer's wallet through `ArcadeShop` (the owner, 2026-10-27); Get NURA leads to nurachain.net | card payments through a gateway; a plain transfer to an address, which cannot refuse a wrong payment |
| SH-D2 | The server's part | It prices and signs each quote with its one key and delivers what the contract says was sold; it never holds NURA | prices kept on the contract (every change an owner transaction, no sales or bundles) |
| SH-D3 | Who buys | A wallet account not marked under 18; a guest is asked to connect a wallet; a minor may receive a friend's gift | minors buying |
| SH-D4 | Gifts | To friends only, never across a block; the recipient is told who sent it | gifts to anybody |
| SH-D5 | What is sold | Looks only, held to the legibility rules | anything that changes play, chance or information |
| SH-D6 | Who sees it | Its owner's things, for everybody; the deck, stock, board, pot and cube are the house's | each reader's own look on everything they see |
| SH-D7 | When a table look applies | From the next game's start; a game keeps its looks | changing under a game in play |
| SH-D8 | Prices | Common 5, rare 12, epic 25, legendary 50 NURA, set by the staff; bundles 30% under their parts and priced down for what is owned; sales with a real end | one price for everything; sales with no end |
| SH-D9 | Owning | For good; a retired look stays owned and usable | trading, resale, rental |
| SH-D10 | Inviters | 10% of what the people they brought in spend, claimed from the wallet page; the owner sets 0 to 30% | no share; a share paid at the moment of the sale, which hands control to the inviter inside `buy` |
| SH-D11 | Refunds | None for a look that arrived; a payment that delivered nothing is refunded by the owner from Admin › Shop, on the contract | refunds on request |
| SH-D12 | Launch | Four collections across fifteen kinds with bundles, drawn by our own generators | third-party art |
| SH-D13 | Words | The shop in all ten languages; the looks' names in English and Persian | names in ten languages |
| SH-D14 | Where | `/app/shop` in the sidebar; Shop on every game page; the collection from the profile and from a table's menu; no door while the shop is closed (changed 2026-10-29 at the owner's word: every door is drawn whatever the shop, and a shop that is turned off says so beside its catalogue) | a shop only on game pages |
| SH-D15 | Not in this work | card or bank payments, a premium currency, subscriptions, loot boxes, trading, looks people make, emotes, chat bubbles, voice effects, a switch that hides other people's looks (the legibility rules instead), seasonal collections (Yalda, Nowruz: the same generators later), anything a level or an achievement unlocks ("a level unlocks nothing" stays true), the NuraChain deploy | |
| SH-D16 | How the doors know the shop is open (SH5) | `shop: true` on the account while it is open, so a door needs no request | — |
| SH-D17 | The gift notice (SH5) | "{who} sent you a gift", leading to the collection; under Friends at first, in a category of its own (`gifts`) since donations (DN-D12) | — |
| SH-D18 | A friend who already owns the look (SH5) | Told by the server at the press | Marked in the list (section 6) |
| SH-D19 | "Your look here" in a table's menu (SH5) | Left for the celebrations' phase, the play route being at 14.1 of 15 KB; built as a player's looks named from their plate (LG10) | — |
| SH-D20 | What a card in the shop shows (SH5) | Every look a finished drawing from the start (`tools/art/looks.mjs`), so a card costs no script; the build refuses a look with no drawing, a drawing with no look and one over 16 KB | A live preview drawn from tokens (section 6) |
| SH-D21 | Which looks "Looks for Ludo" shows (SH5) | The featured collection's looks for that game, its table's then its celebration, four at most; chess, which has two kinds, fills the row with the other collections' sets in the catalogue's order | — |
| SH-D22 | That strip while the shop is read, or when it cannot be (SH5) | Not drawn: it is a door, and the shop page is where a failure is said | — |
| SH-D23 | What the chip on `/app/me` says (SH5) | "Your collection" and one plain line | A count, which would put the shop's store in the profile's chunk |
| SH-D24 | How a frame is drawn (SH6) | CSS on the avatar's root from an SVG file a collection, its motion inside the file and a still twin for less motion, so the shell carries no art | — |
| SH-D25 | Where a nameplate shows (SH6) | Friend rows (friends, members, search), Discover's cards and the leaderboard | Chat lines, a table's plates and the sidebar, where the room is the table's or too small |
| SH-D26 | When a profile effect plays (SH6) | Once as the profile opens, on its header only, never under less motion; again on demand in the fitting room | — |
| SH-D27 | A theme's reach (SH6) | The cover of `/app/me`, a person's page and the public page; the sheet about a person keeps its hue (LG-D10) | — |

## 10. The order of work

Each phase is its own commits: specs first, faults put in one at a time and caught, the gates, and a
walk in a real browser at 1280 in English and 390 in Persian.

- **SH0** this design.
- **SH1** the contract, in the SmartContract project: `ArcadeShop`, its tests, fuzz, invariant and
  coverage, the module, the doc, the preflight, and an adversarial read.
- **SH2** the catalogue and the schema.
- **SH3** owning and showing: the collection, choosing a look, a staff grant as the first way to own
  one, and the looks on the wire.
- **SH4** paying: `chain/shop.ts`, orders, the worker, delivery, bundles, gifts, inviters, the
  routes, and `tools/qa/shop-pass.mjs` on a local chain.
- **SH5** the shop in the browser.
- **SH6** profile looks. **SH7** Ludo. **SH8** cards and chips. **SH9** backgammon. **SH10** chess.
  **SH11** celebrations, and a player's looks named from their plate. Each with its art.
- **SH12** Admin › Shop.
- **SH13** proof: `tools/qa/shop-play-pass.mjs` in two browsers on the local chain, the fit and
  garbage passes, every gate, the notes, and the last walk with MetaMask.

## 11. As built

Where the work departed from this design, and why:

- **Twelve collections and five tiers.** The legendary collections' brief
  (`2026-10-27-legendary-cosmetics-design.md`) added eight collections and the mythic tier at 100
  NURA, so the shop sells 180 looks and 12 bundles, and a look's tier follows its kind on its
  collection's line.
- **Every look is a finished drawing** (section 4, SH-D20). The shop's card is the look's own
  drawing, and the tables draw a look from files of its own too: yards, felts, checkers, home boards
  and the chess sets are drawings, not tokens, and only a die and a stack of chips are custom
  properties a palette gives. Each collection's deck is drawn whole with the standard indices kept,
  and its chess set on the classic set's footprint (`tools/art/chess-looks.mjs`). Effects and
  celebrations are the canvas engine's (`docs/vfx.md`). `docs/looks.md` is the whole of the art.
- **The VFX brief, folded in.** While the profile's art was being committed the owner asked for
  looks that really move ("also add this to your task ... create also VFX"): frames and auras of
  fire, lightning, ice, neon and stars, cards that tilt and catch the light, dice and pawns with
  effects on real events, a particle system with presets, a mythic tier, a showcase and docs; and,
  while the pawns were walked, sounds of their own. Its decisions, as they were taken and as they
  ended:

  | | Decision | Taken | As it ended |
  |---|---|---|---|
  | VX-D1 | Technology | Canvas 2D for particles, one pooled canvas a host; SVG with SMIL for frames; CSS for tilt and holographic edges; no WebGL, Lottie or Rive | As taken (LG-D3) |
  | VX-D2 | The elements | Ember, Storm and Frost as new collections, complete across every kind; Glow the cosmic one, Neon the cyberpunk one, Gold the legendary one | Three of the legendary eight, `inferno`, `storm` and `frost` (LG-D1) |
  | VX-D3 | Mythic | A fifth tier at 100 NURA: the elemental collections' effect and celebration | The legendary line's decoration, profile effect and celebration (LG-D2) |
  | VX-D4 | Where particles run | A table's stage, a profile's header and a preview; never a list, where a frame is its SVG alone | As taken: a look put on and the fitting room are the previews |
  | VX-D5 | Less motion | No particle; a frame's still twin; a burst one fade | As taken |
  | VX-D6 | The showcase | `/admin/looks`, for the staff, with the real components and tuning | The fitting room, `/app/shop/lab`, for everybody signed in (LG-D6) |
  | VX-D7 | Sound | The cues there were, at the moments there were, and no new recordings | Sounds of their own at the owner's word: a voice for each collection, synthesized here (LG-D4) |
  | VX-D8 | Ownership | Drawn from the looks the server says a player wears; nothing trusts a client | As taken |
  | VX-D9 | Trading | Still none (SH-D9); a look's id and its drawing kept apart from who owns it | As taken |

- **A purchase** (section 2), as designed, and:
  - the wallet's NURA is read before the call is handed over, and a wallet short of the price is
    told so (`shop-funds`): a local chain answers a call that carries more than its sender holds, and
    the shop pass's first run handed the purchase to a wallet that could not pay;
  - an order lapses five minutes after its deadline (`LAPSE`), because a block's clock can run ahead
    of this server's;
  - a sale under an order's id that is not that order's wallet at its price is a quote this server
    never signed: the order fails, nothing is delivered, and the reconciliation keeps it for a person
    (the money path's audit);
  - a transaction hash already another order's is refused (`shop-hash`);
  - a refund is asked from its order in Admin › Shop and written to the staff's log as the request it
    is; the worker asks about the order for a day, and once NuraChain says it is refunded the order
    is `refunded` and whatever it delivered is taken back (LG-D37, LG-D38).
- **The contract** (section 3), as designed. Its Ignition module is `bazicheshop`, because Ignition
  refuses a hyphen in a module id; 38 Mocha tests, the fuzz and invariant runs and every line and
  branch covered; `buy` costs 109k gas, 179k with an inviter. It was deployed on NuraChain outside
  this work: its address is in `.env.example`, and `docs/operations/mainnet.md` says what to do about
  one wallet holding both its seller's role and its admin's.
- **Who sees what** (section 5), as designed, and every table plays an entrance from each corner a
  look dresses as a game opens (LG-D23). A table look chosen during a game is drawn from the next
  one, and the look's sheet says so beside Use: the owner pressed Use during a game, saw the board
  unchanged and took it for broken (2026-10-29).
- **The pages** (section 6):
  - the shop's sections are Bundles, On sale while one runs, and each kind; there is no New;
  - the look's sheet shows the look's drawing large, and trying a look on is the fitting room's
    (`/app/shop/lab`, reached from the shop's header), on the reader's own profile and at a stage of
    each game;
  - a friend who owns the look already is told so at the press (SH-D18);
  - the collection is rows by area and slot, with no card a game gathering what is chosen there;
  - "Your look here" became the plate: the sheet about a player opened from their plate names their
    looks at that table, each leading to its sheet, and the reader's own plate lists theirs with the
    way to the collection (SH-D19);
  - every door is drawn whatever the shop, and a shop that is turned off says so (SH-D14 as
    changed);
  - the gift notice has a category of its own, because a stranger watching a game can send NURA and
    the Friends switch would have silenced it (SH-D17, DN-D12).
- **Admin › Shop** (section 7), as designed, with the decisions taken while it was built (LG-D27 to
  LG-D40 in the legendary design): the money a panel of Money; one field of one look changed at a
  time under its row's lock; a change rings nobody, and a quote at another price than the page showed
  reads the shop again; only a look that came by grant is taken back; the overview counts the shop's
  sales and "Needs you" the paid orders that delivered nothing. `.claude/rules/admin.md` (*The shop*,
  *Money*) is the whole of it.
- **The order of work.** SH0 to SH5 went as written. The VFX brief and then the legendary
  collections' brief took in SH6 to SH13, built as LG0 to LG13 (the legendary design, section 12).
