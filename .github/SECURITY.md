# Security

Baziche seals messages in the browser and, on a server that switches it on, moves NURA through
contracts on NuraChain, so a flaw here can cost people their privacy or their money. Thank you for
reporting one with care.

## Reporting a vulnerability

Please do not describe a vulnerability in a public issue or pull request. Instead, open an issue at
<https://github.com/NuraChain/BaziChe/issues> that says only that you have found a security problem
and would like a private way to report it, with no details, and a maintainer will arrange one with
you.

Once you are talking privately, the most useful report says:

- what is affected (the server, the browser client, the sealing, a contract) and at which commit;
- the steps, or a proof of concept, that show it;
- what an attacker gains, and what they need first: an account, a seat in a conversation or at a
  table, a staff role, or a server's key.

Nobody here promises a reply time or a bounty; reports are handled as quickly as the people who
maintain the project can. If you would like to be credited for a report, say so.

## Supported versions

There are no releases yet. Only the latest `main` is supported, and fixes land there.

## Scope

This repository's server and browser client, including:

- the sealing of messages (`nura-e2ee/v1`), device keys and recovery phrases;
- signing in, sessions and the realtime connection;
- the game engines and the tables: anything that lets a player see what their seat may not, choose
  a die or a card, or move for somebody else;
- the admin and its roles;
- how the server composes, signs and reads the NuraChain calls of paid tables, the shop, donations
  and markets.

The contracts themselves (`ArcadeVault`, `ArcadeShop`, `ArcadeTips` and `ArcadeMarkets`) live in
[NuraChain/SmartContract](https://github.com/NuraChain/SmartContract); a flaw in one of them is
reported to that repository.

What the project already documents as a limit is not a vulnerability by itself: the sealing has no
ratchet, so forward secrecy is per membership epoch; voice is encrypted on its way but not end to
end; and the realtime state belongs to one process, so a deployment runs one server for each
database.
