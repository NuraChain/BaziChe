import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { createSignal } from 'azerothjs';

import PinBar from '../src/components/chat/pin-bar.component.azeroth';
import type { Message } from '../src/data/chat.ts';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';

type Rendered = HTMLElement;

const line = (id: string, text: string, more: Partial<Message> = {}): Message =>
    ({ id, conversationId: 'c-1', from: 'sara.k', kind: 'text', text, at: 1_000, ref: null, ...more });

/** The bar over a pin, with where it stands among how many, each of which can be changed after. */
const drawn = (first: { at: number; count: number }, unpin?: () => void) =>
{
    const [place, setPlace] = createSignal(first);
    const went: number[] = [];
    const { container } = renderTest(() => PinBar({
        message: line('m-1', 'Meet at nine?'),
        get at()
        {
            return place().at;
        },
        get count()
        {
            return place().count;
        },
        onGo: () => went.push(place().at),
        ...(unpin === undefined ? {} : { onUnpin: unpin })
    }) as Rendered);

    return { container, went, move: setPlace };
};

const marks = (container: HTMLElement) => [...container.querySelectorAll('[data-pin-mark]')].map((one) => one.getAttribute('data-pin-mark'));

beforeEach(() =>
{
    cleanup();
    useLocale().setLocale('en');
});

afterEach(() => cleanup());

describe('the bar a room’s pins stand in', () =>
{
    it('marks where the pin shown stands, four marks at most, following it along past them', async () =>
    {
        const { container, move } = drawn({ at: 0, count: 1 });

        expect(marks(container), 'one pin, one mark').toEqual(['shown']);

        move({ at: 1, count: 3 });
        expect(marks(container)).toEqual(['other', 'shown', 'other']);

        move({ at: 0, count: 6 });
        expect(marks(container)).toEqual(['shown', 'other', 'other', 'other']);

        move({ at: 3, count: 6 });
        expect(marks(container), 'one before it stays in sight').toEqual(['other', 'shown', 'other', 'other']);

        move({ at: 5, count: 6 });
        expect(marks(container), 'the oldest at the end').toEqual(['other', 'other', 'other', 'shown']);
    });

    it('is one press that goes to the pin, and offers to unpin it only to whoever may', () =>
    {
        let unpinned = 0;
        const plain = drawn({ at: 0, count: 2 });

        expect(plain.container.querySelector(`[aria-label="${ useLocale().t('chat.unpin') }"]`)).toBeNull();

        fire(plain.container.querySelector<HTMLButtonElement>('[data-pin-bar] button')!, 'click');
        expect(plain.went).toEqual([0]);

        cleanup();

        const able = drawn({ at: 0, count: 2 }, () =>
        {
            unpinned += 1;
        });

        fire(able.container.querySelector<HTMLButtonElement>(`[aria-label="${ useLocale().t('chat.unpin') }"]`)!, 'click');
        expect(unpinned).toBe(1);
        expect(able.went, 'unpinning goes nowhere').toEqual([]);
    });

    it('says a voice message as a line quotes it, its words in their own direction', () =>
    {
        const { container } = renderTest(() => PinBar({
            message: line('v-1', '', { kind: 'voice', voice: { id: 'f-1', key: 'k', iv: 'i', mime: 'audio/webm', ms: 3_000, wave: [1], bytes: 900 } }),
            at: 0,
            count: 1,
            onGo: () => undefined
        }) as Rendered);

        expect(container.querySelector('[data-pin-gist]')?.textContent).toBe('Voice message (0:03)');
        expect(container.querySelector('[data-pin-gist]')?.getAttribute('dir')).toBe('auto');
    });

    it('says why a pinned line this browser cannot open cannot be read, as the thread says it', () =>
    {
        const { container } = renderTest(() => PinBar({
            message: line('m-2', '', { locked: 'no-epoch-key' }),
            at: 0,
            count: 1,
            onGo: () => undefined
        }) as Rendered);

        expect(container.querySelector('[data-pin-gist]')?.textContent).toBe(useLocale().t('locked.noEpochKey'));
    });
});
