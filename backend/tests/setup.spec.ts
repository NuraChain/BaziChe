import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { DATABASE_OFFERED, NO_ENV, NUMBERS, addedLines, before, machineValues, missingNames, namesIn, wholeEnv, whyNot } from '../../tools/setup.ts';
import { DEV_ORIGIN, DEV_PORT } from '../src/dev-origin.ts';
import { SECRET_LEAST, loadServerConfig, unsafeForProduction } from '../src/env.ts';

const EXAMPLE = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');

const SCRIPTS = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> }).scripts;

const VITE = readFileSync(new URL('../../frontend/vite.config.ts', import.meta.url), 'utf8');

const BUILT = ['.dist-backend/main.js', '.dist-server/entry.server.js', '.dist-frontend/index.html'];

const roots: string[] = [];

const rootWith = (files: Record<string, string>) =>
{
    const root = mkdtempSync(join(tmpdir(), 'nura-setup-'));

    roots.push(root);

    for (const [file, text] of Object.entries({ '.env.example': EXAMPLE, ...files }))
    {
        mkdirSync(join(root, file, '..'), { recursive: true });
        writeFileSync(join(root, file), text);
    }

    return root;
};

const built = Object.fromEntries(BUILT.map((file) => [file, '']));

const every = Object.fromEntries(namesIn(EXAMPLE).map((name) => [name, '']));

const saved = { ...process.env };

const use = (env: Record<string, string | undefined>) =>
{
    for (const name of namesIn(EXAMPLE))
    {
        delete process.env[name];
    }

    Object.assign(process.env, env);
};

afterEach(() =>
{
    for (const root of roots.splice(0))
    {
        rmSync(root, { recursive: true, force: true });
    }

    for (const name of Object.keys(process.env).filter((one) => !(one in saved)))
    {
        delete process.env[name];
    }

    Object.assign(process.env, saved);
});

describe('the .env setup writes for this machine', () =>
{
    it('writes every name the example has, once, this machine\'s value where it chooses one and the example\'s everywhere else', () =>
    {
        const mine = machineValues('postgres://postgres:pw@127.0.0.1:5432/baziche', '4900', 's'.repeat(43));
        const env = wholeEnv(EXAMPLE, mine);
        const written = parseEnv(env);
        const theirs = parseEnv(EXAMPLE);

        expect(namesIn(env)).toEqual(namesIn(EXAMPLE));
        expect([written.DATABASE_URL, written.SESSION_SECRET, written.PUBLIC_ORIGIN, written.HOST])
            .toEqual(['postgres://postgres:pw@127.0.0.1:5432/baziche', 's'.repeat(43), 'http://localhost:4900', '127.0.0.1']);

        for (const name of namesIn(EXAMPLE).filter((one) => !(one in mine)))
        {
            expect(written[name], name).toBe(theirs[name]);
        }

        expect(env, 'it says what wrote it').toMatch(/^# Written by npm run setup/);
        expect(env, 'it still tells whoever opens it to copy the example').not.toMatch(/Copy to \.env/);
    });

    it('makes a session secret production takes, and a new one each time', () =>
    {
        const one = machineValues('', '4900');

        expect(one.SESSION_SECRET.length).toBeGreaterThanOrEqual(SECRET_LEAST);
        expect(one.SESSION_SECRET).not.toBe(machineValues('', '4900').SESSION_SECRET);
        expect(unsafeForProduction(one.SESSION_SECRET, one.PUBLIC_ORIGIN)).toEqual([]);
    });

    it('quotes a value the .env would cut, and reads back what it was given', () =>
    {
        for (const url of ['postgres://postgres:p#ss word@127.0.0.1:5432/baziche', 'postgres://postgres:it\'s@127.0.0.1:5432/baziche'])
        {
            expect(parseEnv(wholeEnv(EXAMPLE, machineValues(url, '4900'))).DATABASE_URL, url).toBe(url);
        }
    });

    it('adds to a .env only the names it lacks: this machine\'s value where setup chooses one, the example\'s number, and a feature\'s empty', () =>
    {
        const env = 'DATABASE_URL=postgres://a@b/c\nPORT=5300\nNURA_VAULT_ADDRESS=\n';
        const missing = missingNames(EXAMPLE, env, {});
        const lines = addedLines(EXAMPLE, missing, machineValues('', '5300', 'x'.repeat(43))).join('\n');
        const added = parseEnv(lines);

        expect(missing).not.toContain('DATABASE_URL');
        expect(missing).not.toContain('PORT');
        expect(missing, 'a name written empty was taken for one missing').not.toContain('NURA_VAULT_ADDRESS');
        expect(namesIn(lines)).toEqual(missing);
        expect([added.SESSION_SECRET, added.PUBLIC_ORIGIN, added.HOST]).toEqual(['x'.repeat(43), 'http://localhost:5300', '127.0.0.1']);
        expect([added.API_RATE_MAX, added.DATABASE_POOL_MAX]).toEqual([parseEnv(EXAMPLE).API_RATE_MAX, parseEnv(EXAMPLE).DATABASE_POOL_MAX]);
        expect([added.NURA_SHOP_ADDRESS, added.NURA_CHAIN_ID, added.ADMIN_WALLET_ADDRESS], 'a feature was turned on by being added').toEqual(['', '', '']);
    });

    it('adds the example\'s value for exactly the names the server refuses empty that it does not choose itself', () =>
    {
        const valid = parseEnv(wholeEnv(EXAMPLE, machineValues('postgres://a@b/c', '4900')));
        const chosen = Object.keys(machineValues('', '4900'));
        const refusedEmpty = namesIn(EXAMPLE).filter((name) =>
        {
            use({ ...valid, [name]: '' });

            try
            {
                loadServerConfig();

                return false;
            }
            catch
            {
                return true;
            }
        });

        expect(refusedEmpty.filter((name) => !chosen.includes(name)).sort()).toEqual([...NUMBERS].sort());
    });

    it('counts a name as written when the .env writes it, even empty, or the environment does', () =>
    {
        expect(missingNames('A=1\nB=\nC=x\nD=4\n', 'A=\n', { C: 'y' })).toEqual(['B', 'D']);
        expect(missingNames('A=1\n', null, {})).toEqual(['A']);
    });

    it('says in words why a database cannot be used', () =>
    {
        expect(whyNot({ code: 'ECONNREFUSED' })).toMatch(/is Postgres running/);
        expect(whyNot({ code: '28P01' })).toMatch(/write the password into the url/);
        expect(whyNot({ code: '42501' })).toMatch(/create database/);
        expect(whyNot(new TypeError('Invalid URL'))).toBe('Invalid URL');
        expect(new URL(DATABASE_OFFERED).hostname).toBe('127.0.0.1');
    });
});

describe('what stops npm run dev or npm start before it starts', () =>
{
    it('is nothing once every name is written, in a .env or by the environment, as the passes and a container write them', () =>
    {
        const env = wholeEnv(EXAMPLE, machineValues('postgres://a@b/c', '4900'));

        expect(before('dev', rootWith({ '.env': env }), {})).toBeNull();
        expect(before('start', rootWith({ '.env': env, ...built }), {})).toBeNull();
        expect(before('dev', rootWith({}), every), 'every name in the environment, and no .env').toBeNull();
    });

    it('is the setup with no .env, a .env that lacks names by their names, and npm start with nothing built', () =>
    {
        expect(before('dev', rootWith({}), {})).toBe(NO_ENV);
        expect(before('start', rootWith({ ...built }), {})).toBe(NO_ENV);
        expect(before('dev', rootWith({ '.env': 'DATABASE_URL=postgres://a@b/c\n' }), {})).toBe(
            `The root .env lacks ${ namesIn(EXAMPLE).filter((name) => name !== 'DATABASE_URL').join(', ') }. Run npm run setup: it adds them, a feature's empty so it stays off, and changes nothing written.`
        );
        expect(before('start', rootWith({ '.env': wholeEnv(EXAMPLE, machineValues('postgres://a@b/c', '4900')) }), {})).toMatch(/run npm run build first/);
    });
});

describe('npm run dev and npm start', () =>
{
    it('ask the setup first, which a person can also run alone', () =>
    {
        expect([SCRIPTS.setup, SCRIPTS.predev, SCRIPTS.prestart]).toEqual(['node tools/setup.ts', 'node tools/setup.ts --before dev', 'node tools/setup.ts --before start']);
    });

    it('serve development on the one port the api takes as the browser\'s origin', () =>
    {
        expect(DEV_ORIGIN).toBe(`http://localhost:${ DEV_PORT }`);
        expect(VITE).toMatch(/port: DEV_PORT,\s+strictPort: true,/);
    });
});
