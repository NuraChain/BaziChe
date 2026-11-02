import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Message } from '../src/data/chat.ts';
import { setKeyStore } from '../src/lib/device-keys.ts';
import { forgetSigners, signersFor } from '../src/lib/sealing.ts';
import { createApiSource, forgetArchive, type ChatScope } from '../src/services/chat.source.ts';
import { ApiError, client, fixtureDevice, server } from './fake-api.ts';
import { heldKeyStore, makeDevice, TEST_ACCOUNTS, type TestDevice } from './keys.ts';

/** How often a signer's proof was checked, and whether the next check throws, as the real check does when its code cannot be had. */
const checks = vi.hoisted(() => ({ count: 0, throwNext: false }));

vi.mock('../src/lib/attestation.ts', async (actual) =>
{
    const real = await actual<typeof import('../src/lib/attestation.ts')>();

    return {
        ...real,
        verifyPeerDevice: async (...args: Parameters<typeof real.verifyPeerDevice>) =>
        {
            checks.count += 1;

            if (checks.throwNext)
            {
                checks.throwNext = false;
                throw new TypeError('Failed to fetch dynamically imported module');
            }

            return await real.verifyPeerDevice(...args);
        }
    };
});

/**
 * Who signs in a room, asked of the server once however many lines ask at once.
 *
 * A thread's page is opened all at once, and every line asks who signed it. The answer was kept and
 * the asking was not, so a thread opened cold asked once a line: forty requests for one page, and two
 * hundred where a thread reads back to its first unread. Each line also checked its signer's wallet
 * proof for itself, the same curve work once a line for the same one or two people.
 */

const THREAD = 'c-signed';

const scope: ChatScope = { me: 'alex', blocked: [] };

let mine: TestDevice;
let theirs: TestDevice;
let theirSecond: TestDevice;

const said = (text: string): Message => ({
    id: '',
    conversationId: THREAD,
    from: 'alex',
    kind: 'text',
    text,
    at: 1_700_000_000_000,
    ref: null
});

const asked = () => server.calls.filter((call) => call === 'chat.signers').length;

/**
 * The list answered a few milliseconds after it is asked for, as a server's is. The specs' server
 * answers in the same turn, and which line then asks first is the test runner's order of microtasks:
 * a real page has every line of a page asking while the first request is still on its way.
 */
function slowly()
{
    const answer = client.chat.signers;

    vi.spyOn(client.chat, 'signers').mockImplementation(async (request) =>
    {
        await new Promise((resolve) =>
        {
            setTimeout(resolve, 5);
        });
        return await answer(request);
    });
}

const read = async () => (await createApiSource().thread(THREAD, scope, new AbortController().signal)).messages;

beforeEach(async () =>
{
    mine ??= await makeDevice(TEST_ACCOUNTS.alex);
    theirs ??= await makeDevice(TEST_ACCOUNTS.other);
    theirSecond ??= await makeDevice(TEST_ACCOUNTS.other);

    server.reset();
    server.me = 'alex';
    server.sealDevice = mine.id;
    server.conversations = [{ id: THREAD, kind: 'direct', members: ['alex', 'sara.k'], pinned: false, unread: 0 }];
    server.messages = [];
    server.epochs = {};
    server.conversationDevices = {
        [THREAD]: {
            members: [
                { accountId: 'u-alex', handle: 'alex', address: mine.address, devices: [mine.peer] },
                { accountId: 'u-sara.k', handle: 'sara.k', address: theirs.address, devices: [theirs.peer] }
            ]
        }
    };

    setKeyStore(heldKeyStore(mine));
    forgetSigners();
    forgetArchive();
    checks.count = 0;
    checks.throwNext = false;
});

afterEach(() =>
{
    vi.restoreAllMocks();
});

afterAll(() =>
{
    // Put back the store `setup.ts` installed, or whatever runs next in this worker inherits a browser
    // holding this file's device.
    setKeyStore(heldKeyStore(fixtureDevice('alex')));
    forgetSigners();
    forgetArchive();
});

/** Four lines of the reader's, then nothing held: what a thread opened cold in a new tab is. */
async function fourLines()
{
    const source = createApiSource();

    for (const words of ['one', 'two', 'three', 'four'])
    {
        await source.post(said(words));
    }

    forgetSigners();
    forgetArchive();
    server.calls = [];
    checks.count = 0;
    slowly();
}

describe('who signs in a room', () =>
{
    it('is asked once for a page of lines opened together, and whoever signed them is checked once', async () =>
    {
        await fourLines();

        const thread = await read();

        expect(thread.map((line) => [line.text, line.locked])).toEqual([
            ['one', undefined],
            ['two', undefined],
            ['three', undefined],
            ['four', undefined]
        ]);
        expect(asked(), 'one request for the four lines').toBe(1);
        expect(checks.count, 'the one device that signed all four, checked once').toBe(1);
    });

    it('is asked once more for every line that missed together, and a plain ask then shares that answer', async () =>
    {
        const first = await signersFor(THREAD);

        server.calls = [];
        server.conversationDevices[THREAD].members[1].devices = [theirs.peer, theirSecond.peer];

        const again = await Promise.all([signersFor(THREAD, true), signersFor(THREAD, true), signersFor(THREAD)]);

        expect(asked(), 'one more request, not one a caller').toBe(1);
        expect(again[1]).toBe(again[0]);
        expect(again[2], 'an ask while the answer is on its way waits for it').toBe(again[0]);
        expect(again[0].map((one) => one.id)).toContain(theirSecond.id);
        expect(first.map((one) => one.id)).not.toContain(theirSecond.id);
    });

    it('is asked afresh once what was held is forgotten, whatever was on its way then', async () =>
    {
        const before = signersFor(THREAD);

        forgetSigners();
        server.conversationDevices[THREAD].members[1].devices = [theirs.peer, theirSecond.peer];
        await before;

        const after = await signersFor(THREAD);

        expect(asked(), 'the answer begun before the forgetting is not kept').toBe(2);
        expect(after.map((one) => one.id)).toContain(theirSecond.id);
    });

    it('is asked again after a request that failed', async () =>
    {
        vi.spyOn(client.chat, 'signers').mockRejectedValueOnce(new ApiError(503, 'unavailable', 'Down.', undefined));

        await expect(signersFor(THREAD)).rejects.toThrow();

        const answer = await signersFor(THREAD);

        expect(answer.map((one) => one.id).sort()).toEqual([mine.id, theirs.id].sort());
    });

    it('is asked once more for a line signed by a device enrolled since the list was had', async () =>
    {
        const phone = await makeDevice(TEST_ACCOUNTS.alex);
        const alex = server.conversationDevices[THREAD].members[0];

        // The new phone says something, and this browser's list of who signs here is from before it.
        alex.devices = [mine.peer, phone.peer];
        setKeyStore(heldKeyStore(phone));
        server.sealDevice = phone.id;
        await createApiSource().post(said('from the new phone'));

        alex.devices = [mine.peer];
        forgetSigners();
        await signersFor(THREAD);
        alex.devices = [mine.peer, phone.peer];

        setKeyStore(heldKeyStore(mine));
        server.sealDevice = mine.id;
        forgetArchive();
        server.calls = [];

        const thread = await read();

        expect(thread.map((line) => [line.text, line.locked]), 'a device the held list did not know is not a device that never was').toEqual([['from the new phone', undefined]]);
        expect(asked(), 'asked once more').toBe(1);
    });

    it('keeps a newer answer when an older request fails after it', async () =>
    {
        let fail: (reason: unknown) => void = () => undefined;

        vi.spyOn(client.chat, 'signers').mockImplementationOnce(async () => await new Promise<never>((...settle) =>
        {
            fail = settle[1];
        }));

        const older = signersFor(THREAD);

        forgetSigners();

        const newer = await signersFor(THREAD);

        fail(new ApiError(503, 'unavailable', 'Down.', undefined));
        await expect(older).rejects.toThrow();
        server.calls = [];

        expect(await signersFor(THREAD)).toBe(newer);
        expect(asked(), 'the newer answer is still the one held').toBe(0);
    });

    it('checks a signer again after a check that could not be made', async () =>
    {
        await fourLines();
        checks.throwNext = true;

        await expect(read(), 'the check could not be made, so the page cannot be opened').rejects.toThrow();

        const thread = await read();

        expect(thread.map((line) => line.locked)).toEqual([undefined, undefined, undefined, undefined]);
        expect(asked(), 'the list itself was had once').toBe(1);
    });
});
