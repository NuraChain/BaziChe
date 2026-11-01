# Contributing to Baziche

Thank you for wanting to help. A fixed bug, a clearer sentence in one of the ten languages, a test
that pins a rule down, or a careful report of something that went wrong are all worth sending, and
none of them needs you to know the whole codebase first.

## Reporting a bug

Open an issue at <https://github.com/NuraChain/BaziChe/issues>. The reports that get fixed fastest
say:

- what you did, what you expected, and what happened instead;
- where: the page or the table, the game and its pace, the browser and the device, and the language
  the interface was in;
- what the browser's console said, and, if you run the server, the lines in `.logs/` from the
  moment it happened.

Leave out anything private: session cookies, `.env` values, private keys and recovery phrases. A
security problem does not belong in an issue at all; [SECURITY.md](SECURITY.md) says where it goes.

## Suggesting a change

For a small change, a pull request that explains itself is enough. For anything larger, open an
issue first that describes the problem before the solution, so the shape can be agreed before the
code is written. That matters most where a mistake is expensive to undo: the wire
(`backend/src/schemas.ts`), the database's entities, the sealing of messages (`nura-e2ee/v1`), a
game engine's rules, and anything that moves NURA.

The design documents in [docs/superpowers/specs](docs/superpowers/specs) show how earlier work was
proposed: the problem, what already existed, each decision with what was not chosen, and how the
result would be proved.

## Setting up

Follow the [quick start](README.md#quick-start): Node.js 24.11 or newer and PostgreSQL with
`citext` and `pgcrypto`, then `npm ci` and `npm run dev`. Sign in as one of the development
accounts, and with another in a second browser profile you can play against yourself.

## Making a change

Keep each commit to one change, and write its message the way the history does: a type and a
scope, then what is now true, in plain words.

```text
feat(shop): a gift says who sent it
fix(chat): reading a conversation reads its notification
test(qa): a crowd on the realtime socket
```

Every change passes these:

```sh
npm run check          # typechecks and lints both workspaces, then the server's specs
npm test               # every unit spec, with no database
npm run test:shuffle   # the same in random order, which finds specs that lean on each other
```

And, where they apply:

- **`npm run test:db --workspace backend`** for anything that touches the database, with
  `TEST_DATABASE_URL` naming a database you do not mind losing: it empties the tables before every
  test. A claim about the database is proved there and nowhere else.
- **`npm run build`**, which also fails when the first load or any page outgrows its budget.
- **`npm run qa`** and the passes in `tools/qa/` for anything a page draws. They sign in as the
  development accounts, so they run against a built server on a database a development start has
  seeded; [tools/qa/CLAUDE.md](tools/qa/CLAUDE.md) says how to run each.

Do not build in a folder a server you care about is serving from: a build deletes the files that
server's pages name. A server that sees a new build finished under it says so in its log and stops
with exit code 75, for whatever supervises it to start it again.

## How the code is written

`npm run check` holds the style: Allman braces, four spaces, single quotes, no trailing commas, LF
line endings, and no return type the compiler would infer by itself. Beyond what a linter can see:

- **Comment only what the code cannot say**: why a choice was made, a constraint from outside the
  code (a browser quirk, a protocol rule), or a trap the next person would fall into. Never what the
  code does.
- **Build the final shape.** Nothing has shipped, so there are no migrations, compatibility shims or
  flags guarding an old behaviour. A schema change is a change to an entity, and the snapshot in
  `backend/tests/schema-snapshot.json` is recorded again in a commit of its own.
- **The wire is declared once**, in `backend/src/schemas.ts`, and the browser's types come from it.
- **The database is reached through TypeORM.** Raw SQL is for what a repository cannot say, with a
  sentence naming which.
- **A private thing answers as a missing one** (404, never 403), and a public route sends only what
  its screen needs.
- **A refused fetch is not an empty list**: a page that could not read something says so, never
  "nothing here yet".
- **Phone first**: unprefixed utilities are the phone's layout, and wider screens only add to it.
- **Every word of the interface is in all ten languages** (`frontend/src/locales/`), and the
  Persian is written the way people speak it.
- **People are handles at the edge**: the wire names a person by their handle, and the server keys
  on ids inside.

The reasons behind each rule, and how each part works, are in the engineering notes: the root
[CLAUDE.md](CLAUDE.md) (the house rules and the commands), [backend/CLAUDE.md](backend/CLAUDE.md),
[frontend/CLAUDE.md](frontend/CLAUDE.md), and [.claude/rules](.claude/rules) for the games, chat and
keys, signing in, stakes, markets, the shop, invites, the admin and operations. When a change makes
one of them wrong, the same change puts it right.

## Pull requests

- Say what changed and why, and how you checked it: the commands you ran, and for anything visible,
  what you looked at in the browser, at a phone's width and a desktop's, in English and in Persian,
  which reads right to left.
- A screenshot helps for anything a page draws.
- Keep unrelated changes apart; a small pull request is easier to review.
- Pull requests are reviewed as the maintainers' time allows; there is no promised turnaround.

## Translations

The interface is in English, Persian, Arabic, Spanish, Portuguese, Hindi, Chinese, Russian, French
and Turkish, one folder a language in `frontend/src/locales/`. Corrections from people who speak a
language are among the most useful contributions there are: a sentence that reads like a
translation is a bug.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE)
that covers the project.
