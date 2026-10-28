# Before real money: the mainnet checklist

Everything here is the owner's to do, from the owner's own wallets and machines. Nothing in this
repository sends a transaction to NuraChain on anybody's behalf, deploys a contract, or moves NURA;
the server composes calls for a wallet to send and signs only with its own key. Each step says what
to send, from which wallet, and how to check it landed.

## Where things stand (read from NuraChain on 2026-10-28)

ArcadeVault, ArcadeShop and ArcadeTips are deployed on NuraChain (chain 1020) at the addresses
`.env.example` names (`NURA_VAULT_ADDRESS`, `NURA_SHOP_ADDRESS`, `NURA_TIPS_ADDRESS`). ArcadeMarkets
is not deployed (`NURA_MARKETS_ADDRESS` empty). The deployed code carries every function the server
calls (`chain/vault.ts`, `chain/shop.ts`, `chain/tips.ts`), and the gifts contract is the version
whose `tip` carries a deadline.

**One wallet holds every role.** The vault's referee, the shop's seller and the admin of all three
contracts are the same address, the one `ADMIN_WALLET_ADDRESS` names. The server signs with
`NURA_REFEREE_KEY`, so as deployed it could only run holding the admin's key: the key that sets
fees, pauses, takes the fees and replaces the referee would sit on a server that answers the
internet. Separate them before anything else.

## 1. Give the server a key of its own

1. Make a new key on a machine you trust (any wallet tool that shows a private key; never the admin
   wallet's own). Its address is the server's.
2. Send it a little NURA for gas: it pays for every lock, payout, refund and settlement. A few NURA
   last a long time; the `payments-stuck` and `markets-late` alerts say when it runs short.
3. From the admin wallet, in one call each:
   - ArcadeVault: `setReferee(<server address>)`;
   - ArcadeShop: `setSeller(<server address>)`;
   - ArcadeMarkets, once deployed (step 3): it is deployed with the server as `operator`, or
     `setOperator(<server address>)` after.

   Each moves the role in one call: the old holder loses it in the same transaction.
4. Write the new key's secret as `NURA_REFEREE_KEY` in the server's `.env`, and restart the server.
5. Check, with view calls anybody can make: `referee()` on the vault and `seller()` on the shop
   answer the server's address; `hasRole(REFEREE_ROLE, <admin>)` on the vault and
   `hasRole(SELLER_ROLE, <admin>)` on the shop answer `false`.

The calls can be sent with the SmartContract project's console (`npx hardhat console --network
nurachain`, with the admin's key in its keystore) or any wallet that can call a contract.

## 2. Put the contracts' admin behind a multisig

The admin of each contract changes fees and ceilings, pauses, takes the fees and replaces the
server's key. One key that can do that is one key to lose. For each of the four contracts:

1. From the admin wallet: `beginDefaultAdminTransfer(<multisig>)`.
2. From the multisig: `acceptDefaultAdminTransfer()`. The contracts were deployed with no delay
   between the two, so the multisig can accept at once; until it does, nothing has changed, and
   `cancelDefaultAdminTransfer()` takes the naming back. `PAUSER_ROLE` goes with the handover.
3. Check: `defaultAdmin()` answers the multisig, and the old admin no longer has
   `DEFAULT_ADMIN_ROLE`.
4. Write the multisig's address, or the owner's wallet that should open Admin, as
   `ADMIN_WALLET_ADDRESS`. That name is who the server treats as its owner when they sign in; the
   page composes the vault's calls for that wallet to send.

## 3. Deploy ArcadeMarkets, if markets are to be offered

Only once the questions in `compliance.md` are answered for the regions it would be offered in.

1. `npm run preflight:nurachain` in the SmartContract project measures every contract's deploy
   against the node and that the chain has what the contracts use.
2. A parameters file, `ignition/params.json`:

   ```json
   { "bazichemarkets": { "admin": "<multisig>", "operator": "<server address>", "disputeWindow": 900 } }
   ```

   The dispute window is how long the admin may overturn a settled market before its winners can
   claim (at most a day): it is the time anybody has to notice a market settled wrongly.
3. `npm run deploy:nurachain:bazichemarkets -- --parameters ./ignition/params.json`.
4. In the server's `.env`: `NURA_MARKETS_ADDRESS` the address it printed, `MARKET_REGIONS` the
   ISO 3166 codes legal advice allows (no wildcard: an empty name offers markets nowhere), and
   `MARKET_COUNTRY_HEADER` the header the proxy writes. The proxy must write it itself, overwriting
   any a client sent (`README.md`, the proxy's section).
5. Restart the server, and check: Admin › Money lists the markets contract, `solvent()` answers
   true, and a reader in a region not named is refused.

## 4. Before real value

- **An independent audit** of ArcadeVault, ArcadeShop, ArcadeTips and ArcadeMarkets by people who
  did not write them. Each has its tests, fuzz and invariant runs and full line coverage in the
  SmartContract project, and an adversarial read was made here; neither is an audit.
- **The legal review** in `compliance.md`, for every region the product is opened to.
- **The fees and limits** as the owner wants them, from the admin: the vault's fee (`setFee`, 1% to
  15%, 5% at deploy) and its ceiling on a stake (`setMaxStake`, 1,000 NURA at deploy); the shop's
  inviters' share (`setReferralBps`, up to 30%, 10% at deploy). Paid tables offer stakes from a
  ladder in the code (1, 5, 10, 25, 50, 100 and 250 NURA).
- **A restore that was tested**: `docs/operations/rollout.md`.
- **Somebody watching**: the alerts in `docs/operations/runbooks.md`, read from the log or from
  `GET /api/metrics`, reaching a person who can act on the money's alerts within minutes.
