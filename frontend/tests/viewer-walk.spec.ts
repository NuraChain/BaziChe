import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Message } from '../src/data/chat.ts';
import { threadWalk } from '../src/lib/media-viewer.ts';
import { useChat } from '../src/stores/chat.store.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

/** What the viewer walks from a thread: the thread's photos and videos, and past them the room's older ones, as the gallery lists them. */

const line = (id: string, at: number): Message => ({
    id,
    conversationId: 'c-1',
    from: 'sara.k',
    kind: 'file',
    text: '',
    at,
    ref: null,
    file: { id: `f-${ id }`, key: 'k', iv: 'i', as: 'photo', mime: 'image/jpeg', name: `${ id }.jpg`, bytes: 10, w: 4, h: 3 }
});

afterEach(() => vi.restoreAllMocks());

describe('the walk a thread hands the viewer', () =>
{
    it('is the thread, then the room’s older ones a page at a time, passing over a page the thread holds already', async () =>
    {
        const chat = useChat();
        const held = [ line('m5', 5), line('m6', 6) ];
        const asked: string[] = [];

        vi.spyOn(chat, 'messages').mockReturnValue(held);
        vi.spyOn(chat, 'media').mockImplementation((id, kind, cursor) =>
        {
            asked.push(`${ id } ${ kind } ${ cursor ?? '' }`);

            if (cursor === undefined)
            {
                return Promise.resolve({ messages: [ held[1], held[0] ], cursor: 'm5' });
            }

            return Promise.resolve(cursor === 'm5' ? { messages: [ line('m4', 4), line('m3', 3) ], cursor: 'm3' } : { messages: [ line('m2', 2) ] });
        });

        const walk = threadWalk('c-1');

        expect(walk.list().map((one) => one.id)).toEqual([ 'm5', 'm6' ]);
        expect(await walk.older?.(), 'there may be more').toBe(true);
        expect(asked, 'the first page held nothing new, so the next was read').toEqual([ 'c-1 media ', 'c-1 media m5' ]);
        expect(walk.list().map((one) => one.id)).toEqual([ 'm5', 'm6', 'm4', 'm3' ]);

        expect(await walk.older?.(), 'the last page').toBe(false);
        expect(walk.list().map((one) => one.id)).toEqual([ 'm5', 'm6', 'm4', 'm3', 'm2' ]);
    });

    it('reads the thread as it is now, once the thread itself reads further back', () =>
    {
        const chat = useChat();
        const lines = vi.spyOn(chat, 'messages').mockReturnValue([ line('m5', 5) ]);
        const walk = threadWalk('c-1');

        lines.mockReturnValue([ line('m4', 4), line('m5', 5) ]);

        expect(walk.list().map((one) => one.id)).toEqual([ 'm4', 'm5' ]);
    });
});
