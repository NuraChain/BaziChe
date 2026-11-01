import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';

import Skeleton from '../src/components/ui/skeleton.component.azeroth';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';

const settle = async () =>
{
    for (let step = 0; step < 10; step += 1)
    {
        await Promise.resolve();
    }

    await new Promise((resolve) => setTimeout(resolve, 30));
};

/** What a screen reader is given: every text node but those under something hidden from it. */
const heard = (root: Element) =>
{
    const said: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

    for (let node = walker.nextNode(); node !== null; node = walker.nextNode())
    {
        const text = (node.textContent ?? '').trim();

        if (text !== '' && node.parentElement?.closest('[aria-hidden="true"]') === null)
        {
            said.push(text);
        }
    }

    return said;
};

beforeEach(() =>
{
    cleanup();
    useLocale().setLocale('en');
});

afterEach(() =>
{
    cleanup();
    useLocale().setLocale('en');
});

describe('a placeholder while something is on its way', () =>
{
    it('says it is loading to a screen reader, and nothing more, with its bars hidden from it', () =>
    {
        const { container } = renderTest(() => Skeleton({ lines: 3, avatar: true }) as HTMLElement);
        const root = container.querySelector('[data-skeleton]')!;

        expect(heard(root)).toEqual(['Loading…']);
        expect(root.getAttribute('aria-hidden'), 'the whole placeholder was hidden, words and all').toBeNull();
        expect(root.querySelectorAll('span.block.h-3')).toHaveLength(3);
        expect([...root.querySelectorAll('span.block.h-3, span.rounded-full.h-10')].every((bar) => bar.closest('[aria-hidden="true"]') !== null)).toBe(true);
        expect(root.querySelector('[role="status"], [aria-live]'), 'a placeholder announced itself, once for every one of them on a page').toBeNull();
    });

    it('says it in the reader’s language, and follows a switch', async () =>
    {
        const { container } = renderTest(() => Skeleton({}) as HTMLElement);

        useLocale().setLocale('fa');
        await settle();

        expect(heard(container.querySelector('[data-skeleton]')!)).toEqual(['در حال بارگذاری…']);
    });
});
