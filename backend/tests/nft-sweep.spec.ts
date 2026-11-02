import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));

const main = readFileSync(join(HERE, '..', 'src', 'main.ts'), 'utf8');

const sweep = main.slice(main.indexOf('const sweepNfts = () =>'), main.indexOf('handleShutdownSignals('));

const shutdown = main.slice(main.indexOf('beforeShutdown:'), main.indexOf('beforeExit:'));

describe('what mirrors owned looks and legendary achievements on NuraChain', () =>
{
    it('is the server, a minute apart, a pass at a time, on a timer that never holds the process open', () =>
    {
        expect(main).toMatch(/^const NFT_SWEEP_MS = 60_000;$/m);
        expect(sweep).toMatch(/void ports\.jobs\.sweepNfts\(\)/);
        expect(sweep).toMatch(/\.finally\(\(\) =>\s+\{\s+if \(minting !== null\)\s+\{\s+minting = setTimeout\(sweepNfts, NFT_SWEEP_MS\);\s+minting\.unref\(\);/);
        expect(sweep).toMatch(/^minting = setTimeout\(sweepNfts, NFT_SWEEP_MS\);\nminting\.unref\(\);$/m);
    });

    it('says what it moved, and logs a pass that failed without throwing it', () =>
    {
        expect(sweep).toMatch(/log\.info\('nfts moved', \{ \.\.\.moved \}\)/);
        expect(sweep).toMatch(/\.catch\(\(error: unknown\) => log\.error\('nft sweep failed', \{ error \}\)\)/);
    });

    it('is stopped on the way down, before the sockets are let go', () =>
    {
        expect(shutdown).toMatch(/if \(minting !== null\)\s+\{\s+clearTimeout\(minting\);\s+minting = null;/);
        expect(shutdown.indexOf('clearTimeout(minting)')).toBeLessThan(shutdown.indexOf('hub.closeAll('));
    });
});
