# Looks and legendary achievements as NFTs on NuraChain

The owner, 2026-11-02: "ye kari kon shop baziche.com biad roye blockchain va to blockchain kar bar
NFT begiran theme va achievment haro. albate achivement haye mohem faghat": the shop goes onto the
chain, and on the chain people receive NFTs of the looks they buy and of their achievements, the
important achievements only. Asked, the owner chose:

- **Looks are soulbound**, and "gift" is the shop's gift as it stands: a look bought for a friend is
  minted straight into the friend's wallet and never moves after.
- **The server mints after the sale** (over a new shop that mints as it is paid).
- **Legendary achievements only**: the top tenth of every ladder.
- **Backfilled**: every look owned and every legendary achievement earned before this is minted too.

Decisions are numbered NFT-D1 onward; each is a default taken here that the owner may overturn.

## What is on the chain today

- `ArcadeShop` (`0x4F03…F21C` on chain 1020) is where a look is **paid** for: a quote the server
  signs, the buyer's NURA, the inviter's cut. What the buyer then owns is a row in `owned_items`,
  and nothing on the chain says so.
- `ArcadeAchievements` (`0x722C…a382`) is deployed: an ERC-1155, one id per achievement key, a rule
  per achievement whether it may move, at most one per player, no burn. It was deployed with an
  empty `uri` and nothing has ever been minted into it.
- There is no contract for looks.

## The shape (NFT-D1)

The database stays what Baziche draws from. A look is worn because `owned_items` says it is owned,
and an achievement shows because `user_achievements` says it was earned, exactly as now. The chain is
a **mirror and a proof**: a token in the owner's own wallet that this server put there and that
nobody, them included, can move. Because the tokens are soulbound and only this server mints them,
the mirror can never say something the database does not, so no read of the chain is ever needed to
decide what to draw, and NuraChain being slow or down changes nothing on a page.

One worker keeps the mirror true, by reconciling, not by being told:

- a look owned, or a legendary achievement earned, with no token: **mint** it;
- a look token whose `owned_items` row is gone (a refund, the staff taking it back, a deleted
  account): **burn** it.

So a purchase, a gift, a staff grant, an invite's reward and the backfill are one rule, and a crash
anywhere loses nothing: the next pass sees what is still owed.

## `ArcadeLooks` (NFT-D2)

`contracts/baziche/ArcadeLooks.sol` in the SmartContract project, beside `ArcadeAchievements`, in its
style. Its own ignition module, `bazichelooks`, so nothing deployed is deployed twice.

- **ERC-1155**, one id per look: `id = uint256(keccak256(bytes(itemId)))`, `dice.shiraz` and so on,
  as achievements take theirs. No registry to keep in step with the catalogue.
- **Every token is soulbound**: any move between two wallets reverts. A mint and a burn pass.
- **`mint(to, id)` and `mintBatch(to, ids)`**, by `MINTER_ROLE` only, each only while `to` holds none
  of that id (`AlreadyHeld`). Not "once ever", as achievements are: a refunded look can be bought
  again.
- **`burn(from, id)`**, by `MINTER_ROLE` only, which is where it parts from achievements on purpose:
  the shop takes a look back when it refunds it, and a token that outlived its refund would be a
  proof of something untrue.
- `name` "Baziche Looks", `symbol` "BZLOOK"; `uri` the `{id}` template, set at deploy and by the
  owner after (`setURI`). No supply cap, no upgradeability.

## Legendary achievements (NFT-D3)

The deployed `ArcadeAchievements`, as it is. **Legendary** is the rung's rarity, which is not a
column: it comes of where the rung stands in its ladder (`rarityAt`, `domains/achieve/rarity.ts`),
the top tenth of each. 601 of the 6,000 rungs.

- The first time anybody earns one, the worker **defines** it, `defineAchievement(key, true, '')`,
  soulbound and on the template, and only while `achievements(id).defined` is false;
  `AchievementLocked` is read as "defined and live already".
- Then it **awards** it; `AlreadyEarned` is read as done.
- **Never taken back**: the contract has no burn. A rung's rarity follows its ladder's length, so a
  ladder grown later can make a legendary rung rare; a token already minted for it stays, and is the
  truth of when it was earned.

## Which wallet (NFT-D4)

A token goes to **the wallet the owner last signed in with** (`wallets.last_used_at`), read when it
is minted, and the address is kept on the token's row: a burn goes to that address, whatever the
owner has linked since. A gift's token goes to the friend's wallet by the same rule. A wallet unlinked
later keeps what was minted into it.

## The ledger (NFT-D5)

`nft_tokens`, one row per token there is or is owed:

```
nft_tokens  id, collection (look | achievement), user_id (null once the account is gone),
            key (item or achievement id), token_id, address, state, hash, attempts, failure,
            created_at, updated_at
state       minting -> minted -> burning -> burned
                    \-> failed
```

- One live row per collection, user and key (a partial unique index over the states not burned).
- The account's foreign key sets null: a row that still owes a burn outlives the account it was for.
- A row is `failed` with the contract's reason when the chain refuses for a reason that will not
  pass: a smart-contract wallet that takes no ERC-1155, say. The rest of the queue moves on, and
  Admin can see them.

## Sending (NFT-D6)

- **Its own key, `NURA_MINTER_KEY`**, never `NURA_REFEREE_KEY`: that key pays out tables, signs the
  shop's quotes and runs markets, and a backfill of thousands of mints in its nonce queue could hold
  a payout behind them. A leaked minter key can only mint cosmetics nobody can move. It needs NURA for
  gas and `MINTER_ROLE` on both contracts.
- **Nothing happens until it is configured**: the key, the RPC, `NURA_LOOKS_ADDRESS` and
  `NURA_ACHIEVEMENTS_ADDRESS`. Without them the worker does not run and nothing on a page changes.
- **Each send is safe to repeat.** Before sending the worker reads the chain (`balanceOf` for a look,
  `earned` for an achievement): a crash between a send and its hash being written never sends twice.
  It simulates first (`call`), as the vault does, and sends only what would pass.
- **Bounded**: a few sends a pass, a pass a minute, a user's looks in one `mintBatch`. The backfill
  takes as long as it takes, and the gas wallet is not emptied in one go.
- A sent token is `minted` when its receipt says so; a reverted one is retried with its reason kept,
  then `failed`.

## Metadata (NFT-D7)

What a wallet or an explorer shows, served by this server under the contracts' `{id}` templates:

```
GET /api/nft/looks/{id}.json          name, description, image, attributes (kind, collection, tier)
GET /api/nft/achievements/{id}.json   name, description, image, attributes (game, tier, rarity)
GET /api/nft/achievements/{id}.svg    the medal drawn for it
```

`{id}` is the token id as 64 lower-case hex digits, as ERC-1155 says. A look's image is the preview
the shop already draws, `/looks/<item>.svg`; an achievement's is a medal drawn here from its tier,
its game and its name, since achievements have no picture of their own. The ids are mapped back to
their keys from the catalogue and the ladders when the server starts.

## On the page (NFT-D8)

- A look in the reader's collection says **"On NuraChain"** with a link to its token on the explorer
  once it is minted, and "Minting" while it is owed.
- A legendary achievement says the same, on the owner's profile and on anybody's.
- Nothing else changes: buying, gifting, wearing and the price are as they were.

## Decisions

| | Decision | Default taken |
|---|---|---|
| NFT-D1 | Where the truth is | The database; the chain mirrors it, reconciled by one worker |
| NFT-D2 | The looks' contract | New `ArcadeLooks`, ERC-1155, all soulbound, minter mints once while unheld, minter burns on refund |
| NFT-D3 | Which achievements | Legendary only, on the deployed contract, soulbound, never burned |
| NFT-D4 | Which wallet | The one last signed in with, kept on the token's row |
| NFT-D5 | The ledger | `nft_tokens`, its own table, outliving the account it was for |
| NFT-D6 | Sending | Its own minter key; nothing until configured; read before send; a few a pass |
| NFT-D7 | Metadata | This server's JSON under the `{id}` templates; looks' previews, a drawn medal |
| NFT-D8 | On the page | "On NuraChain" and its explorer link on owned looks and legendary achievements |

## Not in this work

- Moving a token between wallets, selling one on, or giving away a look already owned: soulbound,
  as asked.
- Minting free looks the shop gives everybody: none exist (`owned_items` holds only what was bought,
  gifted, granted or rewarded), so there is nothing to leave out.
- Deploying `ArcadeLooks`, granting `MINTER_ROLE`, funding the minter and calling `setURI` on
  `ArcadeAchievements`: the owner's steps, written out at the end of the work.

## Phases, each its own commit

- **N0** `docs(spec)`: this document.
- **N1** (SmartContract) `ArcadeLooks`, its suite and its ignition module.
- **N2** `feat(schema)`: `nft_tokens`.
- **N3** `feat(chain)`: the two contracts as this server calls them.
- **N4** `feat(nft)`: the worker, its configuration, and the backfill it amounts to.
- **N5** `feat(nft)`: the metadata routes and the medal.
- **N6** `feat(nft)`: the wire and the page.

## As built

N0 `e189fec4`; N1 in the SmartContract project, `edf4d76` (the contract and its suite) and `74d93ae`
(its deploy group, preflight, module test and reference); N2 `b068ac39`; N3 `a8a5191a`; N4
`6dc22c86`; N5 `c91bad3a`; N6 `79c7bb9e` (the wire) and `75464ec7` (the page).

What changed on the way, against the design:

- **The worker is two halves.** `domains/nft/steps.ts` decides what one token needs from what the
  chain answers, and is held by a spec against a chain that answers as told; `domains/nft/service.ts`
  is the SQL around it. No Postgres was at hand, so the second half's spec (`nft.db.spec.ts`) was
  typechecked and never run, and the snapshot was written by hand again.
- **A mint waiting on its receipt is never turned into a burn.** A look refunded while its mint is
  in flight waits for the receipt, becomes `minted`, and is owed its burn on the next pass, so a
  receipt can never mark a burn as a mint.
- **A look owned again before its burn was sent** goes back to `minted` rather than being burned and
  minted again.
- **A send with no receipt for thirty minutes is taken for lost** (dropped, replaced, a node that
  restarted): its hash is cleared and the token read again, so it is sent again only if the chain
  says it still needs it, and a token never says "Minting" for ever.
- **A profile links nowhere.** A legendary achievement on somebody's profile says "On NuraChain"
  without its transaction, because a transaction's page names the wallet it went to and a profile
  does not show a stranger anybody's wallet. Only the owner's own collection links to the chain.
  What stays public is what any NFT is: the explorer lists the wallets holding a token id, so a
  legendary achievement held by very few people can be matched to a wallet by somebody looking.
- **One server per database**, as every other sweep assumes: two servers passing at once would
  send twice and the second send would revert (`AlreadyHeld`, `AlreadyEarned`) and heal, at the
  cost of gas.
- **No admin view of tokens put aside.** A `failed` token keeps its reason in `nft_tokens.failure`
  and is not tried again; the staff read it from the database for now.
- **The medal** is drawn by the server from the tier's colours, the step and the name, under a CSP
  that runs nothing.
- **No worker in the monitor.** The minute pass logs what it moved and what failed; it is not one of
  the monitor's named workers, whose list is fixed.

ArcadeLooks' suite: 17 tests, 100% of its lines and statements; a batch naming one look twice was
put in as a fault and caught.

## The owner's steps

Nothing is minted until these are done, and nothing on a page changes before then:

1. **Deploy ArcadeLooks** from the SmartContract project:
   `npm run deploy:nurachain:bazichelooks` with `{ "bazichelooks": { "admin": "<owner>", "uri":
   "https://baziche.com/api/nft/looks/{id}.json" } }`.
2. **Point the achievements at their metadata**: from the owner of `ArcadeAchievements`
   (`0x722C…a382`, deployed with an empty template), `setURI("https://baziche.com/api/nft/achievements/{id}.json")`.
3. **Make a minter wallet of its own**, never the referee's, and fund it with a little NURA for gas.
4. **Grant it `MINTER_ROLE`** on both contracts: `grantRole(MINTER_ROLE, minter)` from each owner.
5. **Set the server's `.env`**: `NURA_LOOKS_ADDRESS` (step 1), `NURA_ACHIEVEMENTS_ADDRESS`
   (already written in `.env.example`) and `NURA_MINTER_KEY` (step 3), and restart. The backfill
   starts on the next minute, a few sends a pass.
