# Fewer "Locked" lines: a browser's chat keys outlive signing out

The owner, 2026-11-02: "Locked. This browser was not given the key for this part of the
conversation. in message kheili ziad etefagh miofte chikar mishe kard kamtar injori beshe ? ye kari
kon kamtar pish biad": the line says it far too often; make it happen less.

## Why it said it

`no-epoch-key` is a line sealed under an epoch this browser holds no key for. Three things made
that ordinary when it should be rare:

1. **Signing out wiped the keyring.** `surrenderKeys` threw away the epoch keys, the archive key and
   the browser's own device keypair on every sign-out, and on any session the server no longer
   recognised. Signing back in, even as the same person, enrolled a **new device**, and a new device
   is not a recipient of anything sealed before it: every older line, in every thread, "Locked".
   Switching between two accounts on one browser did it every time.
2. **A session ended thirty days after sign-in, however much it was used.** The row's `expires_at`
   and the cookie's `Max-Age` were both fixed at sign-in, so a daily player was signed out once a
   month; when it happened with the app open, the refusal ended the session and wiped the keys as
   in (1).
3. **A device enrolled since a thread was read was taken for one that never was.** `historicalKey`
   checked an epoch's recipients against the thread's signers as first fetched, and never asked
   again: once somebody signed in on a new phone and an epoch was minted for it, every line of that
   epoch was "Locked" on this browser until the page was reloaded. (`verifiedSigner` already asked
   once more on a miss; this check did not.)

## What changed

Asked, the owner chose: **keep the keys for the same account**, and **sessions renew while used**.

- **Signing out keeps the keyring** and drops only what the tab showed: the opened messages, search
  terms, call volumes, signers and wallet handles. Signing out everywhere from this browser does the
  same.
- **Whose keys they are is written down** (`lib/key-owner.ts`). When a different account signs in,
  the last one's epoch keys and archive key are wiped before anything reads them. The device keypair
  is left to the sign-in, which already makes fresh keys when the held ones are not a live device of
  the account signing in (the challenge names them, `wallet.store.ts`).
- **A session ended from elsewhere still wipes everything**, device and all: `GET /auth/me` says
  `ended: 'revoked'` when the cookie names a session that was revoked (signed out everywhere after a
  laptop went missing, the device revoked, the staff signing the person out), and only then. A
  session that ran out says nothing.
- **Sessions slide**: the hourly write noting a session was used moves its end to thirty days from
  then, and `/auth/me` sends the cookie again with a fresh `Max-Age`. Thirty days is now how long
  somebody may stay away.
- **`historicalKey` asks once more** for who signs in a thread before calling a recipient unknown.

## What it costs, and what it does not fix

- **A shared computer** keeps the last person's keys on disk after they sign out, sealed under the
  browser's non-extractable vault key. They open nothing without a session for that account, which
  takes its wallet, and the next account to sign in wipes them. Somebody who wants nothing left
  behind signs out everywhere from another device, or revokes this one.
- **A genuinely new browser** (or a private window) still reads nothing sent before it enrolled:
  that is what end to end sealing is. The recovery phrase brings history to a new browser.
- **History already lost** to earlier wipes does not come back by this; the recovery phrase is the
  way, where it was set up.
- **A sign-out in one tab** revokes that session; another tab of the same browser asking `/auth/me`
  in the instant before the cleared cookie reaches it would be told `revoked` and wipe. A narrow race,
  and its cost is what every sign-out cost before.
- **No database spec** runs here (no Postgres), so the sliding `expires_at` and `endedFor` are held
  by the typecheck and the route specs, not by a real database.
