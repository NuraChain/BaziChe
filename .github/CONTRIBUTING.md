# Contributing to Baziche

Thank you for wanting to help. A fixed bug, a clearer sentence in one of the ten languages, a test
that pins a rule down, or a careful report of something that went wrong are all worth sending, and
none of them needs you to know the whole codebase first.

## Reporting a bug or asking for something

Open an [issue](https://github.com/NuraChain/BaziChe/issues/new/choose); the forms ask for what
helps: what you did, what you expected and what happened, where (the page or the table, the game,
the browser, the language), and what the console or the server's `.logs/` said. Leave out session
cookies, `.env` values, private keys and recovery phrases. A security problem goes to
[SECURITY.md](SECURITY.md), never to an issue.

For anything larger than a small fix, open an issue first that describes the problem before the
solution, so the shape is agreed before the code is written. That matters most where a mistake is
expensive to undo: the wire (`backend/src/schemas.ts`), the database's entities, the sealing of
messages (`nura-e2ee/v1`), a game engine's rules, and anything that moves NURA. The
[design documents](../docs/superpowers/specs) show how earlier work was proposed and decided.

## Setting up

Follow the [quick start](../README.md#quick-start): Node.js 24.11 or newer and PostgreSQL with
`citext` and `pgcrypto`, then `npm ci` and `npm run dev`. Sign in as one of the development
accounts, and with another in a second browser profile you can play against yourself.

## The checks

Every change passes these:

```sh
npm run check          # typechecks and lints both workspaces, then the server's specs
npm test               # every unit spec, with no database
npm run test:shuffle   # the same in random order, which finds specs that lean on each other
```

And where they apply:

- **The database:** `npm run test:db --workspace backend`, with `TEST_DATABASE_URL` naming a
  database you do not mind losing, since it empties the tables before every test. Where Postgres
  asks for a password, write it in that URL: the spec of `npm run setup` types it from there.
- **The build:** `npm run build`, which also fails when the first load or any page outgrows its
  budget.
- **Anything a page draws:** the responsive matrix, against the built server on a port of its own
  with the rate limit raised, on a database a development start has seeded (it signs in as
  `dana.w`):

  ```sh
  PORT=5300 PUBLIC_ORIGIN=http://localhost:5300 API_RATE_MAX=20000 npm start
  QA_BASE=http://localhost:5300 npm run qa
  ```

  The other passes in `tools/qa/` run the same way, and most say at their top what they need.

Never build in a folder a server you care about is serving from: a build deletes the files that
server's pages name. A server that sees a new build finished under it stops with exit code 75, for
whatever supervises it to start it again.

## How the code is written

`npm run check` holds the style: Allman braces, four spaces, single quotes, no trailing commas, LF
line endings, and no return type the compiler would infer by itself. Beyond what a linter sees:

- **Comment only what the code cannot say**: why a choice was made, a constraint from outside the
  code, or a trap the next person would fall into. Never what the code does.
- **Build the final shape.** Nothing has shipped, so there are no migrations, compatibility shims or
  flags guarding an old behaviour. A schema change is a change to an entity, with
  `backend/tests/schema-snapshot.json` recorded again in a commit of its own.
- **The wire is declared once**, in `backend/src/schemas.ts`, and the browser's types come from it.
- **The database is reached through TypeORM**; raw SQL only for what a repository cannot say, with a
  sentence naming which.
- **A private thing answers as a missing one** (404, never 403), and a public route sends only what
  its screen needs.
- **A refused fetch is not an empty list**: a page that could not read something says so.
- **Phone first**: unprefixed utilities are the phone's layout, and wider screens only add to it.
- **Every word of the interface is in all ten languages** (`frontend/src/locales/`), and the
  Persian is written the way people speak it.

Keep each commit to one change, and write its message the way the history does: a type and a
scope, then what is now true, in plain words.

```text
feat(shop): a gift says who sent it
fix(chat): reading a conversation reads its notification
```

## Pull requests

Say what changed and why, and how you checked it: the commands you ran and, for anything visible,
what you looked at in the browser at a phone's width and a desktop's, in English and in Persian,
which reads right to left. Keep unrelated changes apart. Pull requests are reviewed as the
maintainers' time allows; there is no promised turnaround.

## Translations

The interface is in English, Persian, Arabic, Spanish, Portuguese, Hindi, Chinese, Russian, French
and Turkish, one folder per language in `frontend/src/locales/`. Corrections from people who speak a
language are among the most useful contributions there are: a sentence that reads like a
translation is a bug.

## License

By contributing, you agree that your contributions are licensed under the project's
[MIT License](../LICENSE).
