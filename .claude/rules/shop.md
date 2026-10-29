# The shop

Looks people buy with NURA, drawn on their owner's things for everybody who sees them. The design,
with every decision and what was not chosen, is `docs/superpowers/specs/2026-10-27-shop-design.md`,
and the twelve collections' identities, the effects engine and the voices are
`docs/superpowers/specs/2026-10-27-legendary-cosmetics-design.md`. How a look is drawn and how a
collection is added are `docs/looks.md`; the effects engine is `docs/vfx.md`. What the staff do to
the shop (prices, sales, the collection on top, orders, a look given or taken back, the shop's money
and a refund) is `.claude/rules/admin.md`, *The shop* and *Money*.

## What is sold

**Looks only** (SH-D5). Nothing sold changes a rule, a chance, what anybody may see, or the paid
tables, and every look is held to the legibility rules below.

**`domains/shop/catalogue.ts` imports nothing, and both halves read it.** Fifteen kinds; nineteen
slots (`SHOP_SLOTS`: four on the profile, three at Ludo, three at Hokm, four at poker, three at
backgammon, one at chess, and `table.celebration` at every table); twelve collections, the four the
shop opened with (`glow`, `shiraz`, `neon`, `gold`) and the eight legendary ones (`inferno`,
`storm`, `astral`, `void`, `jade`, `frost`, `phoenix`, `oni`); five tiers. A look's id is
`<kind>.<collection>` and a bundle's `bundle.<collection>`. A look's tier follows its kind on its
collection's line (`TIER_OF`, `LEGENDARY_TIER_OF`, `tierOf`): in a legendary collection what lies
still is epic, a table's pieces legendary, and what plays on a profile or at a win mythic. A tier's
price (`TIER_PRICE`: 5, 12, 25, 50 and 100 NURA) is where a look starts; the staff change it. A
bundle costs its looks less 30% (`BUNDLE_OFF_BPS`), priced down for what the buyer already owns
(`bundlePriceFor`). The newest legendary collection is featured (`FEATURED_FIRST`) until the staff
choose another.

**The catalogue is rows the seed writes at every boot** (`shop_items`, `shop_collections`), and the
seed never overwrites a price, a sale or a status (on sale, hidden, retired): the `games.status`
rule. A new collection is rows and no schema change: no CHECK names a collection or a tier
(`shop_items_id_shape` is `^[a-z]+\.[a-z]+$`).

**Classic is in every slot, free and always the reader's**: it is a slot with nothing chosen.

## Owning and choosing

`owned_items` (who, which look, when, how: `purchase`, `gift` or `grant`; the order; who gave it) and
`equipped_items` (who, which slot, which look). The second's foreign key is to the first, so a look
taken back comes off every slot it was worn in, and `equipped_items_fits` holds a look to its slot's
kind. A look is owned for good (SH-D9): a retired look stays owned and usable, and nothing is traded
or resold. Only a look the staff gave can be taken back by them, and a refund takes back what its
order delivered.

`GET /shop/collection` is what the reader owns (with how and from whom) and what they chose.
`POST /shop/chosen`, `{ slot, item }`, chooses a look, or Classic with `item` absent: a slot that is
none or a look of another kind is `shop-slot` (422), and a look that is not the reader's is
`shop-not-owned` (409), which the foreign key answers as well, so a look taken back in the moment
between the two is the same refusal.

## The looks on the wire

**What somebody wears away from a table travels with them.** A list's person (`personSummary`, every
list, plate, chair and line of chat) carries `deco` and `nameplate`; the profile reads, the account
and the public face carry `theme` and `effect` as well (`domains/shop/looks.ts`: `listLookColumns`,
`profileLookColumns`, each a scalar sub-select of `equipped_items`). A look is on the wire only when
it is worn (`worn`): Classic is a key left out.

**A game keeps the looks it began with** (SH-D7). As a game starts, the match service asks the
`LooksReader` the shop hands it (`looksAt`, inside the opening transaction, so the match imports
nothing of the shop) what each player chose for that game's table, and writes it to
`match_players.look` (`{}` for Classic); every match view carries it on each seat
(`matchPlayer.look`), a watcher's too. Every player and watcher draws the same, and a look chosen
later shows from the next game. The collection says so beside every table's slots ("From your next
game there"), and the look's sheet beside Use for any look a table draws (`shop.useNext`,
`data-next-game`): the owner pressed Use on a look during a game, saw the board unchanged and took it
for broken (2026-10-29). A look on the profile is drawn at once and says nothing of the kind.

## Who sees what

A look is drawn on its owner's things for everybody who sees them; everything else is as its owner
chose, or Classic (SH-D6). The table's own things are the house's and stay Classic: the deck and the
stock, poker's board and pot, backgammon's cube, the chess board and its coordinates.

| Game | In its owner's look |
|---|---|
| Ludo | each pawn (its owner's, also when a partner moves it); the die of whoever throws; each yard |
| Hokm | a card in a hand, dealt to it or played from it; a pile of tricks in the look of the seat it lies beside; each felt |
| Poker | each player's two cards (backs to others, faces to them and at the showdown); their stack and bets until they reach the pot; their felt |
| Backgammon | each side's checkers and home board; the dice of whoever throws |
| Chess | each side's pieces, its captures in the tray, its promotion chooser |
| Every table | the winner's celebration; the entrance from each corner a look dresses as a game opens; the decorations on the plates |
| Away from a table | the frame round a picture everywhere it is drawn; the nameplate in friend rows, Discover and the leaderboard; the theme on the profile, the person's page and the public page; the effect as the profile opens |

**Legible whoever mixes what.** Pawns keep their seat's colour as the body; a checker or chess set
has a light and a dark side whose luminances stay far apart; card faces keep the standard indices,
ink at 4.5:1; dice pips 4.5:1 to their face; a plate's ink 4.5:1. `look-palette.spec.ts` measures
every collection's tokens. Nothing moves for somebody who asked for less motion and nothing is drawn
in a hidden tab. An effect takes no press and keeps off a picture's face; it lies under the cards at
Hokm and poker and under every piece at backgammon and chess, and at Ludo it plays over the board
round the die or the pawn it is about, for a moment (`docs/vfx.md`, *Where an effect lies*).

## Buying

**The shop is open when its contract, the server's key, the rpc and the chain id are written**
(`NURA_SHOP_ADDRESS`, `NURA_REFEREE_KEY`, `NURA_RPC_URL`, `NURA_CHAIN_ID`); written empty it is off,
its writes are refused, and every door to it is still drawn where it would be and says it is turned
off (`FeatureOff`, `frontend/CLAUDE.md`). The account carries `shop: true` while it is open (SH-D16).

**Who may buy** (SH-D3): a wallet account (`shop-wallet`) not marked under 18 (`shop-minor`). A guest
is asked to connect a wallet; a minor is told they cannot buy and that a friend can still send them
a look.

**A purchase** (`POST /shop/orders`, `{ item, for? }`):

- The order is written with its price, its recipient (the buyer, or a friend by handle) and a
  deadline thirty minutes on, cut to the second (`QUOTE_LIFE`), under an advisory lock on the
  recipient (`pg_advisory_xact_lock(hashtext('shop:recipient'), hashtext(recipient))`, raw because
  no repository can say it), so one recipient has one open order a look and two friends cannot pay
  for one gift. A look nobody sells is `shop-item` (404), one not on sale or a shop that is paused
  `shop-closed`, one already theirs `shop-owned`, one with an order on its way `shop-pending`, and a
  gift to somebody who is not a friend, or across a block, `shop-friend` (404).
- The server signs the quote (order, buyer, item, price, referrer, deadline; EIP-712, the
  `ArcadeShop` domain) with its one key, which is the shop's seller, and answers the unsent
  `buy(quote, signature)` call the buyer's wallet sends. The wallet's NURA is read first, because a
  local chain answers a call carrying more than its sender holds: short is `shop-funds` with the
  price; a call the contract refuses is its sentence (`shop-closed` for a pause or a signature the
  seller's role no longer covers, `shop-pending` for an order already sold, `shop-refused` with the
  contract's word for the rest).
- `POST /shop/orders/:id/sent`, `{ hash }`, is a nudge: it lets the page say what NuraChain did and
  wakes the worker sooner. A hash already another order's is `shop-hash` (409). Nothing is
  delivered for it.

**The worker believes the contract and nothing else** (`main.ts`, every three seconds). It asks
`saleOf` about each order by its id (an order nobody said they sent, every thirty seconds), and a
sale to that order's wallet at the quoted price is delivered in one transaction under the order's
lock: `paid`, and every look of the item the recipient lacks inserted. Any other sale under that id
is a quote this server never signed (`mismatch`): the order fails, the fault is said once, nothing
is delivered, and the reconciliation lists it for a person. An order whose looks were all owned by
then (a staff grant in between) is `delivered: false`, which the owner refunds from Admin › Shop. An
order its deadline passed five minutes ago unsold (`LAPSE`: a block's clock can run ahead of this
one) is `expired`; one the chain refused is `failed` while it can still be paid. So a closed tab or a
lost hash loses nothing, and NURA never leaves a wallet for a sale that would not count: the contract
refuses another buyer, another price, an expired quote, an order already sold and a quote the
seller's key did not sign.

**A gift** is a purchase for a friend (SH-D4), never across a block. The recipient is told who sent
it (`gift`, in the `gifts` category beside NURA sent to them, through `courtesy`, leading to their
collection), and a gift that gave nothing tells nobody.

**Inviters earn** a share of what the people they brought in spend (the contract's `referralBps`,
10% at deploy, the owner's from 0 to 30%), credited by the contract at each sale. `GET
/shop/earnings` reads it, asked only while the shop is open; `POST /shop/earnings/claim` composes
`claim()` for the inviter's wallet, and nothing to claim is `shop-nothing`.

**A refund is the owner's, of a paid order** (LG-D37, LG-D38). Admin › Shop composes `refund(order)`
for the owner's wallet, asked of the contract first, and writes the request to the staff's log; the
contract sends the price back to whoever paid and takes the inviter's unclaimed credit back. The
order worker asks the shop about the order for a day after the request, and once NuraChain says it is
refunded the order is `refunded` and whatever it delivered is taken back from whoever it was given
to, off every slot it was worn in. The reconciliation puts a paid order NuraChain holds as refunded
right the same way, whoever refunded it and whenever.

## The contract, `ArcadeShop`

In the SmartContract repository (`contracts/baziche/ArcadeShop.sol`, `docs/contracts/ArcadeShop.md`):
the owner as default admin, handed on in two steps; `SELLER_ROLE` (this server's key, one at a time,
replaced by `setSeller`: a leaked seller key can only sign quotes, never move NURA); pausable (`buy`
only); `buy` checks the buyer, the exact price, the deadline (at most a day ahead), the order unused
and the seller's signature, records the sale and credits the inviter; `refund`, `withdraw` (revenue
only, never what inviters have still to claim), `claim`, `setReferralBps` (0 to 3,000). Tested with
Mocha, fuzz and an invariant run (the balance covers revenue plus unclaimed earnings), 100% of lines
and branches; `buy` 109k gas, 179k with an inviter. The server reads and composes through
`chain/shop.ts` (the ABI by hand, the quote's typed data held to the contract's, `saleOf`, the
ledger, every call asked of the contract before a wallet is).

## The art and the voices

Every look is a finished drawing, generated here (no third-party art), and the build refuses a
missing, stray or oversized file in each folder (`tools/budgets.mjs`). `docs/looks.md` is the whole
of it; in short:

- `npm run looks` runs `tools/art/looks.mjs` (the shop's own drawing of every look and bundle,
  `public/looks/`), `tools/art/profile-looks.mjs` (frames with their still twins, plates and covers)
  and `tools/art/table-looks.mjs` (pawns on the board pawn's outline in each seat's colour, decks and
  backs, yards, felts, checkers for either side, home boards, and through `chess-looks.mjs` every
  collection's chess set on the classic set's footprint).
- `tools/art/legendary/<collection>.mjs`: each legendary collection's motif, read by the generators.
- `frontend/src/game/looks/palette.ts`: every collection's tokens, which every drawing and effect
  reads; `lights.ts` the light every effect of a collection plays in.
- `npm run voices` runs `tools/art/look-sounds.mjs`: each collection's voice, synthesized offline
  from `tools/art/voices/` into three packs (`game/sound/looks/<collection>-profile`, `-table` and
  `-celebration`), fetched only where one of its looks plays, under the device's sound switch.

## The pages

**`/app/shop`** (`shop.page`, tab `shop`): the header (one sentence, the wallet's NURA once read, Get
NURA to nurachain.net, the collection, the fitting room), the featured collection as a hero (its
name and sigil, its looks, its bundle's price and what it saves), a filter in the address (`for`:
All, Profile, Ludo, Hokm, Poker, Backgammon, Chess; All never written), then Bundles, On sale while
one runs, and each kind the filter keeps, as rails on a phone and grids as the page widens. A card
(`LookCard`) is the look's drawing, its name (two lines rather than cut), a tier edge (rare blue,
epic violet, legendary gold, mythic prismatic) and its price (a sale struck through with its end), or
Owned, or In use.

**A look's sheet** (`components/shop/look-sheet`, a chunk behind `lib/look-sheet.ts`, `?item=` in the
address): the drawing large, its name, collection and tier, where it shows, its price; a bundle's
looks and what it saves; Buy, Send as a gift, Use it or In use, or why the reader cannot buy. A
purchase is walked in the sheet (preparing, the wallet, NuraChain with its transaction, "It's yours"
with the collection's burst and voice), each refusal in its own sentence (`whyShop`); a gift is to a
friend chosen in the sheet.

**`/app/shop/collection`** (`collection.page`): by area, a row for each slot with Classic and each
owned look, chosen with one press (shown at the press with the collection's burst on the drawing
pressed, taken back with the refusal's sentence); gifts and who sent each; orders newest first with
their state and transaction; what the shop owes the reader from the people they invited, and Claim.

**The doors**: Shop in the sidebar and the rail after Discover; Shop in a game's hero and a bag in its
phone bar; "Looks for Ludo" on a game's page (four looks of the featured collection for that game,
See all to `/app/shop?for=ludo`, a chunk of its own); the chip on `/app/me` beside the vault's. From a
plate at a table, the sheet about a person names what they wear there, each leading to its sheet.

**The fitting room** (`/app/shop/lab`, LG11): one collection at a time, the reader's own header in its
frame, cover and effect and their name on its plate, nothing sent or stored (LG-D24); every look of
it below as the shop's cards. Under it "At the table", a chunk of its own (`components/shop/
lab-tables`): a stage for each game drawn by the boards' own classes and custom properties (LG-D25),
a Ludo corner, the reader's place at Hokm and poker, a backgammon home board and black's corner at
chess, and a press for every moment a table plays a look at (`STAGES`), each played by `momentOf`
with the recipe, size and voice its board plays it with: the sizes live in `game/looks/` and the
layouts, which the boards import. Then "Tune", a chunk of its own (`lab-playground`): any moment on a
stage of its own with the engine's own numbers as factors over the moment as its table plays it,
a seed, the quality and less motion; nothing it sets is stored (LG-D26).

## What holds it

The server: `shop-catalogue.spec.ts`, `shop-refusals.spec.ts`, `chain-shop.spec.ts` (the quote's
digest against the contract's, the calls), `shop-sweep.spec.ts` (the worker's place in `main.ts`),
`look-palette.spec.ts`, the sheets of each kind of look (`frame-sheet`, `plate-looks`, `card-sheet`,
`felt-sheet`, `die-sheet`, `yard-sheet`, `shop-sheet`, `keyframes`), `look-pack.spec.ts`, and against
Postgres `shop.db.spec.ts`, `shop-schema.db.spec.ts` and `shop-order.db.spec.ts` (every refusal, the
worker against a fake shop, delivery, bundles, gifts, a refund, the looks copied at a start). The
browser: `shop-store`, `shop-page`, `look-sheet`, `collection-page`, `shop-doors`, `lab-page`,
`lab-tables`, `look-identity`, `avatar-looks`, `aura`, `equip`, each board's `*-looks` and `*-felt`,
`entrances`, `chess-moments` and the engine's `vfx-*` specs. The passes, on the built server and a
local chain: `shop-pass.mjs` (37 checks), `shop-play-pass.mjs` (two browsers, a look bought, used and
seen on its owner's pawns and plate) and `sound-pass.mjs` part 4 (the voices).
