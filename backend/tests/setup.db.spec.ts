import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * `npm run setup` as somebody at a terminal runs it, against a real Postgres: a database's bare name,
 * the password typed when Postgres asks for one, and the script ending once it has written the .env.
 * A client Postgres turned away for its password kept its socket, so the setup wrote the .env and never
 * ended, and `npm run dev` waited behind it for ever. OPT-IN, like the other `.db.spec` suites, in a
 * root of its own so no real .env is touched.
 */

const url = process.env.TEST_DATABASE_URL;
const active = url !== undefined && url !== '';

const REPO = fileURLToPath(new URL('../../', import.meta.url));

const PROBE = 'nura_setup_probe';

const STRANGER = 'nura_setup_never';

let base: DataSource;
let root = '';

/**
 * Runs the setup in `root`, its stdin saying it is a terminal unless `terminal` is false, answering the
 * first question about the database and the first about a password once each is asked, and stopping it
 * after `most` milliseconds: a setup that asks anything a second time waits there until then.
 */
const setUp = (answers: { database: string; password?: string }, { terminal = true, most = 20_000 } = {}) => new Promise<{ code: number | null; said: string }>((done) =>
{
    const env = { ...process.env };

    delete env.PGPASSWORD;
    delete env.DATABASE_URL;

    const child = spawn(process.execPath, [...(terminal ? ['--import', pathToFileURL(join(root, 'as-tty.mjs')).href] : []), 'tools/setup.ts'], { cwd: root, env });
    let said = '';
    let asked = 0;
    const late = setTimeout(() => child.kill(), most);

    const hear = (chunk: Buffer) =>
    {
        said += chunk.toString();

        if (asked === 0 && said.includes('Which database'))
        {
            asked = 1;
            child.stdin.write(`${ answers.database }\n`);
        }
        else if (asked === 1 && said.includes('The password of the Postgres user'))
        {
            asked = 2;
            child.stdin.write(`${ answers.password ?? '' }\n`);
        }
    };

    child.stdout.on('data', hear);
    child.stderr.on('data', hear);
    child.on('exit', (code) =>
    {
        clearTimeout(late);
        done({ code, said });
    });
});

describe.skipIf(!active)('npm run setup at a terminal', () =>
{
    beforeAll(async () =>
    {
        base = new DataSource({ type: 'postgres', url, synchronize: false, logging: ['error'] });
        await base.initialize();
        await base.query(`drop database if exists ${ PROBE } with (force)`);

        root = mkdtempSync(join(tmpdir(), 'nura-setup-'));

        for (const file of ['.env.example', 'tools/setup.ts', 'backend/src/dev-origin.ts', 'backend/package.json'])
        {
            mkdirSync(join(root, file, '..'), { recursive: true });
            copyFileSync(join(REPO, file), join(root, file));
        }

        symlinkSync(join(REPO, 'node_modules'), join(root, 'node_modules'), 'junction');
        writeFileSync(join(root, 'as-tty.mjs'), 'Object.defineProperty(process.stdin, \'isTTY\', { value: true, configurable: true });\n');
    }, 60_000);

    afterAll(async () =>
    {
        if (base?.isInitialized)
        {
            await base.query(`drop database if exists ${ PROBE } with (force)`);
            await base.query(`drop database if exists ${ STRANGER } with (force)`);
            await base.destroy();
        }

        if (root !== '')
        {
            rmSync(join(root, 'node_modules'), { force: true });
            rmSync(root, { recursive: true, force: true });
        }
    }, 60_000);

    it('takes a database\'s bare name, asks for the password when Postgres wants one, makes the database, writes the .env and ends', async () =>
    {
        const server = new URL(url ?? '');
        const ran = await setUp({ database: PROBE, password: decodeURIComponent(server.password) });
        const written = existsSync(join(root, '.env')) ? parseEnv(readFileSync(join(root, '.env'), 'utf8')) : {};

        expect(ran.code, `it did not end by itself:\n${ ran.said }`).toBe(0);
        expect(ran.said).toMatch(/Made the database nura_setup_probe\./);
        expect(new URL(written.DATABASE_URL ?? 'x:').pathname).toBe(`/${ PROBE }`);
        expect(await base.query('select 1 from pg_database where datname = $1', [PROBE])).toHaveLength(1);
    }, 60_000);

    it('says a wrong password was refused and asks for the database again, never for the password a second time', async () =>
    {
        rmSync(join(root, '.env'), { force: true });

        const ran = await setUp({ database: STRANGER, password: 'not-the-password' }, { most: 8_000 });

        expect(ran.said).toMatch(/That one cannot be used: Postgres refused that user or its password/);
        expect(ran.said.split('The password of the Postgres user').length - 1, 'the password asked for twice').toBe(1);
        expect(ran.said.split('Which database').length - 1).toBe(2);
        expect(existsSync(join(root, '.env'))).toBe(false);
    }, 30_000);

    it('asks nobody for a password where nobody is at a terminal, says why it stops, and writes nothing', async () =>
    {
        rmSync(join(root, '.env'), { force: true });

        const ran = await setUp({ database: STRANGER, password: 'not-asked-for' }, { terminal: false, most: 8_000 });

        expect(ran.code).toBe(1);
        expect(ran.said).toMatch(/Postgres wants a password for that user/);
        expect(ran.said).not.toMatch(/The password of the Postgres user/);
        expect(existsSync(join(root, '.env'))).toBe(false);
    }, 30_000);
});
