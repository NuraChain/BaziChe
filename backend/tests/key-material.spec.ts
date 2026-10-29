import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { toHex } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Hardhat's twenty accounts, from the mnemonic it publishes: the only private keys this repository may hold. */
const PUBLISHED = new Set(Array.from({ length: 20 }, (_, addressIndex) =>
    toHex(mnemonicToAccount('test test test test test test test test test test test junk', { addressIndex }).getHdKey().privateKey!)));

const SKIP = new Set(['node_modules', 'out', '.vite', 'public', 'bed-src', 'sound-src']);

const TEXT = /\.(ts|mjs|js|cjs|azeroth|json|md|sh|example)$/;

/** Thirty-two bytes written as hex in a string, with or without 0x: the shape of a private key. */
const LITERAL = /(['"`])(?:0x)?([0-9a-fA-F]{64})\1/g;

const KEYISH = /private.?key|privateKeyToAccount|secret|mnemonic|\bkey\b|_KEY\b/i;

const filesUnder = (path: string): string[] =>
{
    const full = join(ROOT, path);

    if (!statSync(full).isDirectory())
    {
        return [path];
    }

    return readdirSync(full).filter((name) => !SKIP.has(name)).flatMap((name) =>
    {
        const inner = join(path, name);
        return statSync(join(ROOT, inner)).isDirectory() ? filesUnder(inner) : TEXT.test(name) ? [inner] : [];
    });
};

/** Every 64-hex string in `text` with the line it stands on, and whether it is one of hardhat's. */
const keysIn = (text: string) => text.split('\n').flatMap((line, at) =>
    [...line.matchAll(LITERAL)].map((found) => ({ line: at + 1, said: line, published: PUBLISHED.has(`0x${ found[2]!.toLowerCase() }`) })));

const found = (paths: readonly string[]) => paths.flatMap(filesUnder).flatMap((file) =>
    keysIn(readFileSync(join(ROOT, file), 'utf8')).map((key) => ({ ...key, file: file.replaceAll('\\', '/') })));

describe('key material in the repository', () =>
{
    it('reads a key wherever it is written, with 0x or without, and knows hardhat\'s own', () =>
    {
        const stranger = '11'.repeat(32);
        const hardhat = [...PUBLISHED][0]!;

        expect(PUBLISHED.size).toBe(20);
        expect(keysIn(`const KEY = '0x${ stranger }';\nconst other = "${ stranger }";\nsign(\`${ hardhat }\`);`).map((key) => [key.line, key.published])).toEqual([[1, false], [2, false], [3, true]]);
        expect(keysIn(`const order = 0x${ stranger }n;\nconst short = '0x${ '1'.repeat(63) }';`)).toEqual([]);
    });

    it('ships no key but the development fixtures\', each one of hardhat\'s published accounts', () =>
    {
        const keys = found(['backend/src', 'frontend/src']);

        expect(keys.length, 'nothing found: the walk reads no file').toBeGreaterThan(0);
        expect(keys.filter((key) => !key.published).map((key) => `${ key.file }:${ key.line }`)).toEqual([]);
        expect([...new Set(keys.map((key) => key.file))]).toEqual(['backend/src/db/wallet-fixtures.ts']);
    });

    it('signs in the QA passes only as hardhat\'s published accounts', () =>
    {
        expect(found(['tools']).filter((key) => !key.published).map((key) => `${ key.file }:${ key.line }`)).toEqual([]);
    });

    it('names no key in the specs or the documents but one of hardhat\'s, whatever else is written there as hex', () =>
    {
        const keyish = found(['backend/tests', 'frontend/tests', 'docs', 'README.md', 'CLAUDE.md', 'backend/CLAUDE.md', 'frontend/CLAUDE.md', '.claude/rules'])
            .filter((key) => !key.published && KEYISH.test(key.said));

        expect(keyish.map((key) => `${ key.file }:${ key.line }`)).toEqual([]);
    });

    it('writes every secret in .env.example empty', () =>
    {
        const secrets = readFileSync(join(ROOT, '.env.example'), 'utf8').split(/\r?\n/)
            .map((line) => /^([A-Z0-9_]*(?:SECRET|KEY|TOKEN)[A-Z0-9_]*)=(.*)$/.exec(line))
            .filter((written) => written !== null);

        expect(secrets.map((written) => written[1])).toEqual(expect.arrayContaining(['SESSION_SECRET', 'NURA_REFEREE_KEY', 'VAPID_PRIVATE_KEY', 'METRICS_TOKEN']));
        expect(secrets.filter((written) => written[2]!.trim() !== '').map((written) => written[1])).toEqual([]);
    });
});
