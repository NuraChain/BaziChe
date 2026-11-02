import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, createMemoryHistory, createRouter, createSignal } from 'azerothjs';

import { deleteAsked, messageActions } from '../src/components/chat/actions.ts';
import MessageBubble from '../src/components/chat/message-bubble.component.azeroth';
import '../src/icons/all.ts';
import type { Message } from '../src/data/chat.ts';
import { sealFile } from '../src/lib/chat-file.ts';
import { forgetFile } from '../src/lib/file-held.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { routes } from '../src/routes.ts';
import { ChatFileError, setChatFiles, type ChatFileFailure } from '../src/services/chat-files.ts';
import { useFileLoads } from '../src/stores/file-loads.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import '../src/locales/app-catalogue.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

/**
 * An album in its bubble (MS-D46): one grid of tiles, named by what it holds, its caption once under
 * it, nothing fetched until a tile or "Download all" is pressed, which fetches them one after another,
 * and what kept any of them away said once.
 */

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 400 }, (_, at) => at % 200)]);

const ALBUM = '5a1d0c9e-2b4f-4e8a-9c3d-7f6e5d4c3b2a';

const downloads: string[] = [];

let kept = new Map<string, Uint8Array>();

/** A download held at its door, and one told to fail. */
const fetching = { door: null as Promise<void> | null, refuse: new Map<string, ChatFileFailure>() };

const items = async (count: number, caption = '') =>
{
    const made: Message[] = [];

    for (let place = 0; place < count; place += 1)
    {
        const id = crypto.randomUUID();
        const sealed = await sealFile(JPEG, id);

        kept.set(id, sealed.body);
        made.push({
            id: `m-${ place }`,
            conversationId: 'c-1',
            from: 'sara.k',
            kind: 'file',
            text: place === 0 ? caption : '',
            at: 1_700_000_000_000 + place,
            ref: null,
            file: { id, key: sealed.key, iv: sealed.iv, as: 'photo', mime: 'image/jpeg', name: `p${ place }.jpg`, bytes: 1_048_576, w: 1600, h: 1200, thumb: 'AAAA' },
            album: { id: ALBUM, at: place, of: count, holds: 'photo' }
        });
    }

    return made;
};

const settle = async () =>
{
    for (let turn = 0; turn < 12; turn += 1)
    {
        await Promise.resolve();
    }
};

const show = (all: Message[]) =>
{
    const [list, setList] = createSignal(all);
    const router = createRouter({ routes, history: createMemoryHistory('/app/chats/c-1'), scroll: false });
    const container = renderTest(() => RouterProvider({
        router,
        children: () => MessageBubble({
            get message()
            {
                return list()[0];
            },
            get items()
            {
                return list();
            },
            me: 'alex',
            onActions: () => undefined
        })
    }) as HTMLElement).container;

    return { container, read: (next: Message[]) => setList(next) };
};

const holding = () =>
{
    let release: () => void = () => undefined;

    fetching.door = new Promise<void>((resolve) =>
    {
        release = resolve;
    });

    return () =>
    {
        fetching.door = null;
        release();
    };
};

beforeEach(() =>
{
    resetRuntime();
    setRuntime({ clock: manualClock(1_700_000_100_000), seed: 3 });
    useLocale().setLocale('en');
    downloads.length = 0;
    kept = new Map();
    fetching.door = null;
    fetching.refuse.clear();
    forgetFile();
    useFileLoads().reset();
    setChatFiles({
        upload: () => Promise.resolve(),
        async download(id, progress, signal)
        {
            downloads.push(id);
            progress(0.4);

            if (fetching.door !== null)
            {
                await fetching.door;
            }

            if (signal?.aborted === true)
            {
                throw new ChatFileError('cancelled');
            }

            const refused = fetching.refuse.get(id);

            if (refused !== undefined)
            {
                throw new ChatFileError(refused);
            }

            const body = kept.get(id);

            if (body === undefined)
            {
                throw new ChatFileError('file-missing');
            }

            return body;
        }
    });
});

afterEach(() =>
{
    cleanup();
    setChatFiles(null);
    forgetFile();
});

describe('an album in its bubble', () =>
{
    it('is one grid in one bubble, every item a tile in its row, named by what it holds', async () =>
    {
        const { container } = show(await items(4));
        const grid = container.querySelector('[data-album]');

        expect(container.querySelectorAll('.bubble')).toHaveLength(1);
        expect(grid?.getAttribute('data-album')).toBe(ALBUM);
        expect(grid?.getAttribute('role')).toBe('group');
        expect(grid?.getAttribute('aria-label')).toBe('4 photos');
        expect(container.querySelectorAll('[data-album] [data-row]'), 'two and two').toHaveLength(2);
        expect(container.querySelector('[data-all]')?.textContent?.trim(), 'how much they come to, said once under the grid').toBe('Download all (4 MB)');
        expect(container.querySelector('[data-file]'), 'not a photo alone').toBeNull();
    });

    it('marks a video’s tile with its length alone, and a photo’s with nothing, so a narrow tile is never crossed by words', async () =>
    {
        const [first, second, third] = await items(3);
        const film = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, ...Array.from({ length: 200 }, (_, at) => at % 100)]);
        const id = crypto.randomUUID();
        const sealed = await sealFile(film, id);

        kept.set(id, sealed.body);

        const video: Message = { ...second, file: { ...second.file!, id, key: sealed.key, iv: sealed.iv, as: 'video', mime: 'video/mp4', ms: 3_000 } };
        const all = [first, video, third].map((one) => ({ ...one, album: { ...one.album!, holds: 'both' as const } }));
        const { container } = show(all);
        const chips = () => [...container.querySelectorAll('[data-tile]')].map((tile) => tile.querySelector('[data-size]')?.textContent?.trim() ?? null);

        expect(chips()).toEqual([null, '0:03', null]);
        expect(container.querySelector('[data-size]')?.className, 'on one line').toContain('whitespace-nowrap');

        useLocale().setLocale('fa');

        await vi.waitFor(() => expect(chips()).toEqual([null, '۰:۰۳', null]));

        fire(container.querySelector(`[data-tile="${ id }"] [data-download]`)!, 'click');

        await vi.waitFor(() => expect(container.querySelector(`[data-tile="${ id }"] video`)).not.toBeNull());
        expect(chips(), 'nothing on a video that has come').toEqual([null, null, null]);
    });

    it('says its caption once, under the grid', async () =>
    {
        const { container } = show(await items(3, 'Our trip'));

        expect(container.textContent?.split('Our trip')).toHaveLength(2);
    });

    it('is a photo alone when only one of its items is here', async () =>
    {
        const { container } = show((await items(3)).slice(0, 1));

        expect(container.querySelector('[data-album]')).toBeNull();
        expect(container.querySelector('[data-file]')).not.toBeNull();
    });

    it('fetches nothing until asked, and Download all fetches them one after another', async () =>
    {
        const all = await items(3);
        const { container } = show(all);

        expect(downloads, 'nothing fetched').toEqual([]);
        expect(container.querySelector('[data-all]')?.textContent).toContain('Download all (3 MB)');

        const release = holding();

        fire(container.querySelector('[data-all]')!, 'click');
        await vi.waitFor(() => expect(downloads).toHaveLength(1));
        await settle();

        expect(downloads, 'one at a time').toEqual([all[0].file?.id]);
        expect(container.querySelector('[data-all]'), 'not offered while they come').toBeNull();

        release();

        await vi.waitFor(() => expect(container.querySelectorAll('button[aria-label="Open the photo"]')).toHaveLength(3));
        expect(downloads, 'each once, in order').toEqual(all.map((one) => one.file?.id));
        expect(container.querySelector('[data-all]'), 'nothing left to fetch').toBeNull();
    });

    it('offers to fetch only what is left once a tile was fetched by hand', async () =>
    {
        const all = await items(3);
        const { container } = show(all);

        fire(container.querySelector(`[data-tile="${ all[1].file?.id }"] [data-download]`)!, 'click');
        await vi.waitFor(() => expect(container.querySelectorAll('button[aria-label="Open the photo"]')).toHaveLength(1));

        expect(container.querySelector('[data-all]')?.textContent).toContain('Download all (2 MB)');

        fire(container.querySelector('[data-all]')!, 'click');
        await vi.waitFor(() => expect(container.querySelectorAll('button[aria-label="Open the photo"]')).toHaveLength(3));

        expect(downloads, 'the one already here not fetched again').toEqual([all[1].file?.id, all[0].file?.id, all[2].file?.id]);
    });

    it('does not fetch again one the reader fetched by hand while the rest were coming', async () =>
    {
        const all = await items(3);
        const { container } = show(all);
        const release = holding();

        fire(container.querySelector('[data-all]')!, 'click');
        await vi.waitFor(() => expect(downloads).toHaveLength(1));

        fire(container.querySelector(`[data-tile="${ all[2].file?.id }"] [data-download]`)!, 'click');
        await vi.waitFor(() => expect(downloads).toHaveLength(2));

        release();

        await vi.waitFor(() => expect(container.querySelectorAll('button[aria-label="Open the photo"]')).toHaveLength(3));
        await settle();

        expect(downloads.filter((id) => id === all[2].file?.id), 'asked for once').toHaveLength(1);
        expect(downloads, 'every one once').toHaveLength(3);
    });

    it('stops fetching the rest once the reader stops the one on its way', async () =>
    {
        const all = await items(3);
        const { container } = show(all);
        const release = holding();

        fire(container.querySelector('[data-all]')!, 'click');
        await vi.waitFor(() => expect(downloads).toHaveLength(1));
        await settle();

        fire(container.querySelector(`[data-tile="${ all[0].file?.id }"] [data-download]`)!, 'click');
        release();
        await settle();
        await settle();

        expect(downloads, 'the rest never asked for').toEqual([all[0].file?.id]);
        await vi.waitFor(() => expect(container.querySelector('[data-all]')?.textContent).toContain('Download all (3 MB)'));
    });

    it('says what kept one away once, the worst first, and tries again the ones that could not be fetched', async () =>
    {
        const all = await items(3);
        const { container } = show(all);
        const worst = () => container.querySelector('[data-album] > [data-fault]');

        fetching.refuse.set(all[0].file!.id, 'network');
        kept.set(all[2].file!.id, new Uint8Array(kept.get(all[2].file!.id)!).map((byte, at) => (at === 3 ? byte ^ 1 : byte)));

        fire(container.querySelector('[data-all]')!, 'click');

        await vi.waitFor(() => expect(worst()?.getAttribute('data-fault')).toBe('tampered'));
        expect(worst()?.getAttribute('role'), 'as an alarm').toBe('alert');
        expect(worst()?.textContent).toContain('Try again');

        const stuck = container.querySelector<HTMLButtonElement>(`[data-tile="${ all[2].file?.id }"] [data-download]`);

        expect(stuck?.disabled, 'a tile that was tampered with offers nothing to press').toBe(true);
        expect(stuck?.getAttribute('aria-label'), 'and says why').toBe('This file was changed after it was sent, so it is not shown.');

        fetching.refuse.clear();
        fire([...worst()!.querySelectorAll('button')].find((one) => one.textContent?.includes('Try again'))!, 'click');

        await vi.waitFor(() => expect(container.querySelector(`[data-tile="${ all[0].file?.id }"] button[aria-label="Open the photo"]`)).not.toBeNull());
        expect(downloads.filter((id) => id === all[0].file?.id), 'the one that failed, again').toHaveLength(2);
        expect(downloads.filter((id) => id === all[2].file?.id), 'not the one that was tampered with').toHaveLength(1);
    });

    it('does not fetch again, from Download all, one that was refused when pressed by hand', async () =>
    {
        const all = await items(3);
        const { container } = show(all);

        kept.delete(all[0].file!.id);
        fire(container.querySelector(`[data-tile="${ all[0].file?.id }"] [data-download]`)!, 'click');
        await vi.waitFor(() => expect(container.querySelector('[data-album] > [data-fault]')?.getAttribute('data-fault')).toBe('gone'));

        expect(container.querySelector('[data-all]')?.textContent, 'what is left').toContain('Download all (2 MB)');

        fire(container.querySelector('[data-all]')!, 'click');
        await vi.waitFor(() => expect(container.querySelectorAll('button[aria-label="Open the photo"]')).toHaveLength(2));

        expect(downloads.filter((id) => id === all[0].file?.id), 'asked for once').toHaveLength(1);
    });

    it('keeps every tile through a re-read of the thread', async () =>
    {
        const all = await items(3);
        const { container, read } = show(all);
        const before = [...container.querySelectorAll('[data-tile]')];

        read(all.map((one) => ({ ...one, file: { ...one.file! }, album: { ...one.album! } })));
        await settle();

        const after = [...container.querySelectorAll('[data-tile]')];

        expect(after).toHaveLength(3);
        expect(after.every((tile, place) => tile === before[place]), 'the same nodes').toBe(true);
    });

    it('asks, before it is deleted, about the album that goes whole, and is offered as an album', async () =>
    {
        const [first] = await items(4);
        const line: Message = { ...first, album: undefined, kind: 'text', text: 'hi', file: undefined };
        const t = useLocale().t;
        const labelOf = (message: Message, me: string) => messageActions(t, message, me, { onDelete: () => undefined, onTake: () => undefined }).find((one) => one.id === 'delete' || one.id === 'take')?.label;

        expect(deleteAsked(first, t)).toEqual({
            title: 'Delete these 4 photos?',
            lead: 'They go together, for everybody in the conversation, along with their reactions. Anybody who already saw them may still remember them.',
            confirm: 'Delete album'
        });
        expect(deleteAsked(first, t, 'Sara Kamali'), 'when the staff take it').toEqual({
            title: 'Delete Sara Kamali’s 4 photos?',
            lead: 'They go together, for everybody in the group, along with their reactions. Sara Kamali isn’t told.',
            confirm: 'Delete album'
        });
        expect(deleteAsked(line, t), 'a line alone as it was').toEqual({
            title: 'Delete this message?',
            lead: 'It goes for everybody in the conversation, along with its reactions. Anybody who already read it may still remember it.',
            confirm: 'Delete message'
        });
        expect(deleteAsked(line, t, 'Sara Kamali')).toEqual({
            title: 'Delete Sara Kamali’s message?',
            lead: 'It goes for everybody in the group, along with its reactions. Sara Kamali isn’t told.',
            confirm: 'Delete message'
        });
        expect([labelOf(first, 'sara.k'), labelOf(first, 'alex'), labelOf(line, 'sara.k')]).toEqual(['Delete album', 'Delete album', 'Delete message']);

        useLocale().setLocale('fa');

        expect(deleteAsked(first, useLocale().t).title).toBe('این ۴ عکس رو حذف کنی؟');
        expect(deleteAsked(first, useLocale().t, 'سارا').title).toBe('این ۴ عکس رو که سارا فرستاده حذف کنی؟');
    });

    it('is named in the reader’s language', async () =>
    {
        useLocale().setLocale('fa');

        const { container } = show(await items(5));

        expect(container.querySelector('[data-album]')?.getAttribute('aria-label')).toBe('۵ عکس');
    });
});
