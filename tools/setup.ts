/**
 * `npm run setup` writes the root .env for running on this machine, and asks only for the database.
 *
 * It writes every name `.env.example` has, since the server has a value for none: the example's own
 * values, a session secret made here, this machine's address (`HOST` 127.0.0.1, `PUBLIC_ORIGIN`
 * http://localhost and the port), and the database it is given, which it creates when Postgres has
 * none of that name. Beside a `.env` that exists it adds only the names that file lacks, a feature's
 * empty so the feature stays off, and changes nothing written.
 *
 * `npm run dev` and `npm start` run it first (`--before dev|start`): a name neither the .env nor the
 * environment writes stops them here in one sentence, where vite and the server would each have said
 * it in a stack trace, and with no .env at all and somebody at the terminal it runs the setup instead.
 * `npm start` asks for the build as well.
 */
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseEnv } from 'node:util';

import { DEV_ORIGIN } from '../backend/src/dev-origin.ts';

const ROOT = join(import.meta.dirname, '..');

const EXAMPLE = join(ROOT, '.env.example');

const ENV = join(ROOT, '.env');

const BUILT = ['.dist-backend/main.js', '.dist-server/entry.server.js', '.dist-frontend/index.html'];

export const DATABASE_OFFERED = 'postgres://postgres@127.0.0.1:5432/baziche';

const HEADER = '# Written by npm run setup for this machine. Every name stays written: .env.example says what each one is.';

interface Postgres
{
    connect(): Promise<void>;
    query(text: string): Promise<unknown>;
    end(): Promise<void>;
}

type PostgresClient = new (options: { connectionString: string; connectionTimeoutMillis: number }) => Postgres;

export const namesIn = (text: string) => [...text.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]);

/** The names `.env.example` has that neither the .env nor the environment writes. */
export function missingNames(example: string, env: string | null, environment: Record<string, string | undefined>)
{
    const written = env === null ? {} : parseEnv(env);

    return namesIn(example).filter((name) => written[name] === undefined && environment[name] === undefined);
}

/** This machine's values for the names setup chooses; every other name takes the example's. */
export function machineValues(databaseUrl: string, port: string, secret = randomBytes(32).toString('base64url'))
{
    return { DATABASE_URL: databaseUrl, SESSION_SECRET: secret, PUBLIC_ORIGIN: `http://localhost:${ port }`, HOST: '127.0.0.1' };
}

const quoted = (value: string) => (/[\s#'"`]/.test(value) ? (value.includes('\'') ? `"${ value }"` : `'${ value }'`) : value);

/** A whole .env: the example with its comments and values, this machine's where it chooses them. */
export function wholeEnv(example: string, mine: Record<string, string>)
{
    const written = Object.entries(mine).reduce(
        (text, [name, value]) => text.replace(new RegExp(`^${ name }=.*$`, 'm'), () => `${ name }=${ quoted(value) }`),
        example.replace(/^(?:#.*\r?\n)+\r?\n/, '')
    );

    return `${ HEADER }\n\n${ written }`;
}

/** The names the server refuses empty that setup does not choose itself: one added takes the example's value. */
export const NUMBERS: readonly string[] = ['PORT', 'API_RATE_MAX', 'DATABASE_POOL_MAX'];

/** The lines added to a .env that lacks names: this machine's value where setup chooses one, the example's for a number, and empty for a feature's, which keeps it off. */
export function addedLines(example: string, missing: readonly string[], mine: Record<string, string>)
{
    const theirs = parseEnv(example);

    return missing.map((name) => `${ name }=${ quoted(mine[name] ?? (NUMBERS.includes(name) ? theirs[name] ?? '' : '')) }`);
}

const nameOf = (url: string) => decodeURIComponent(new URL(url).pathname.slice(1));

/** Connects to the database the url names, and creates it when Postgres has none of that name. */
async function reach(url: string)
{
    const { Client } = createRequire(join(ROOT, 'backend', 'package.json'))('pg') as { Client: PostgresClient };
    const name = nameOf(url);

    if (name === '' || name.includes('/'))
    {
        throw new Error('the url names no database: end it with one, such as /baziche');
    }

    const target = new Client({ connectionString: url, connectionTimeoutMillis: 5000 });

    try
    {
        await target.connect();
        await target.end();

        return 'reached';
    }
    catch (error)
    {
        if ((error as { code?: string }).code !== '3D000')
        {
            throw error;
        }
    }

    const server = new URL(url);

    server.pathname = '/postgres';

    const admin = new Client({ connectionString: server.toString(), connectionTimeoutMillis: 5000 });

    await admin.connect();

    try
    {
        await admin.query(`create database "${ name.replaceAll('"', '""') }"`);
    }
    finally
    {
        await admin.end();
    }

    return 'made';
}

export function whyNot(error: unknown)
{
    const code = (error as { code?: string }).code ?? '';

    if (code === 'ECONNREFUSED')
    {
        return 'nothing answers at that host and port: is Postgres running?';
    }

    if (code === '28P01' || code === '28000')
    {
        return 'Postgres refused that user or its password: write the password into the url, postgres://user:password@host:port/name';
    }

    if (code === '42501')
    {
        return 'that user may not make databases: make it in psql (create database <name>), then run npm run setup again';
    }

    return error instanceof Error ? error.message : String(error);
}

const say = (text: string) => process.stdout.write(`${ text }\n`);

async function ask(question: string, offered: string)
{
    const reader = createInterface({ input: process.stdin, output: process.stdout });

    try
    {
        return (await reader.question(`${ question } [${ offered }]: `)).trim() || offered;
    }
    finally
    {
        reader.close();
    }
}

async function database()
{
    for (let tries = 0; tries < (process.stdin.isTTY === true ? 3 : 1); tries += 1)
    {
        const url = await ask('Which Postgres database should it use?', process.env.DATABASE_URL ?? DATABASE_OFFERED);

        try
        {
            say(await reach(url) === 'made' ? `Made the database ${ nameOf(url) }.` : `Reached the database ${ nameOf(url) }.`);

            return url;
        }
        catch (error)
        {
            say(`That one cannot be used: ${ whyNot(error) }.`);
        }
    }

    throw new Error('No database could be reached, so nothing was written.');
}

export async function setup()
{
    const example = readFileSync(EXAMPLE, 'utf8');
    const port = parseEnv(example).PORT ?? '4900';

    if (!existsSync(ENV))
    {
        say('There is no root .env yet: this writes one for running on this machine, and asks only for the database.');

        const mine = machineValues(await database(), port);

        writeFileSync(ENV, wholeEnv(example, mine));
        say(`Wrote .env. npm run dev serves the app at ${ DEV_ORIGIN }; npm run build, then npm start, serves it at ${ mine.PUBLIC_ORIGIN }.`);

        return;
    }

    const env = readFileSync(ENV, 'utf8');
    const missing = missingNames(example, env, {});

    if (missing.length === 0)
    {
        say('The root .env already writes every name .env.example has.');

        return;
    }

    const mine = machineValues(missing.includes('DATABASE_URL') ? await database() : '', parseEnv(env).PORT ?? port);

    appendFileSync(ENV, `${ env.endsWith('\n') ? '' : '\n' }\n# Added by npm run setup: the names .env.example has that this file did not. A feature's is empty, so it stays off.\n${ addedLines(example, missing, mine).join('\n') }\n`);
    say(`Added to .env: ${ missing.join(', ') }.`);
}

export const NO_ENV = 'There is no root .env yet. Run npm run setup once: it asks only for the database, and writes the rest for this machine.';

/** What stops `npm run dev` or `npm start` before it starts, said in one sentence: null when nothing does. */
export function before(command: 'dev' | 'start', root: string, environment: Record<string, string | undefined>)
{
    if (command === 'start' && BUILT.some((file) => !existsSync(join(root, file))))
    {
        return 'There is nothing built to start yet: run npm run build first, then npm start.';
    }

    const envFile = join(root, '.env');
    const env = existsSync(envFile) ? readFileSync(envFile, 'utf8') : null;
    const missing = missingNames(readFileSync(join(root, '.env.example'), 'utf8'), env, environment);

    if (missing.length === 0)
    {
        return null;
    }

    return env === null
        ? NO_ENV
        : `The root .env lacks ${ missing.join(', ') }. Run npm run setup: it adds them, a feature's empty so it stays off, and changes nothing written.`;
}

if (import.meta.main)
{
    const [flag, command] = process.argv.slice(2);

    try
    {
        if (flag !== '--before' || (command !== 'dev' && command !== 'start'))
        {
            await setup();
        }
        else
        {
            const stopped = before(command, ROOT, process.env);

            if (stopped === NO_ENV && process.stdin.isTTY === true)
            {
                await setup();
            }
            else if (stopped !== null)
            {
                say(stopped);
                process.exitCode = 1;
            }
        }
    }
    catch (error)
    {
        say(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}
