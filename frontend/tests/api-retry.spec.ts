import { afterEach, describe, expect, it, vi } from 'vitest';

import { sent } from '../src/lib/read-again.ts';

const lost = () => new TypeError('The network connection was lost.');

describe('a request the network failed', () =>
{
    afterEach(() =>
    {
        vi.unstubAllGlobals();
    });

    it('is a read asked once more, as Safari fails the first one over a connection gone stale', async () =>
    {
        const fetched = vi.fn().mockRejectedValueOnce(lost()).mockResolvedValue(new Response('{}', { status: 200 }));
        vi.stubGlobal('fetch', fetched);

        expect((await sent(new Request('https://nura.example/api/games'), 15_000)).status).toBe(200);
        expect(fetched).toHaveBeenCalledTimes(2);
    });

    it('fails a read the second try fails too', async () =>
    {
        const fetched = vi.fn().mockRejectedValue(lost());
        vi.stubGlobal('fetch', fetched);

        await expect(sent(new Request('https://nura.example/api/games'), 15_000)).rejects.toThrow(TypeError);
        expect(fetched).toHaveBeenCalledTimes(2);
    });

    it('never sends a write twice', async () =>
    {
        const fetched = vi.fn().mockRejectedValue(lost());
        vi.stubGlobal('fetch', fetched);

        await expect(sent(new Request('https://nura.example/api/calls/1/accept', { method: 'POST', body: '{}' }), 15_000)).rejects.toThrow(TypeError);
        expect(fetched).toHaveBeenCalledTimes(1);
    });

    it('is not asked again when it timed out or was called off', async () =>
    {
        const fetched = vi.fn().mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));
        vi.stubGlobal('fetch', fetched);

        await expect(sent(new Request('https://nura.example/api/games'), 15_000)).rejects.toThrow();
        expect(fetched).toHaveBeenCalledTimes(1);

        const called = new AbortController();
        const aborted = vi.fn().mockImplementation(() =>
        {
            called.abort();

            return Promise.reject(lost());
        });
        vi.stubGlobal('fetch', aborted);

        await expect(sent(new Request('https://nura.example/api/games', { signal: called.signal }), 15_000)).rejects.toThrow(TypeError);
        expect(aborted).toHaveBeenCalledTimes(1);
    });
});
