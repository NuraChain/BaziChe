import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';

import Skeleton from '../src/components/ui/skeleton.component.azeroth';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';

const SOURCES = import.meta.glob('../src/{components,pages}/**/*.azeroth', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const WORDS = '<span class="sr-only">{ locale.t(\'common.loading\') }</span>';

/** Each file's lines, by the path a reader of a failure would look for, its comments blank. */
const files = () => Object.entries(SOURCES).map(([path, text]) => ({
    file: path.replace('../src/', ''),
    lines: text.split('\n').map((line) => (/^\s*(\/\*\*|\*|\/\/)/.test(line) ? '' : line))
}));

/** The skeletons of each file in runs: one that follows another within four lines stands in the same placeholder. */
const runs = (lines: string[]) =>
{
    const found: number[][] = [];

    lines.forEach((line, at) =>
    {
        if (!line.includes('<Skeleton'))
        {
            return;
        }

        const last = found.at(-1);

        if (last !== undefined && at - last[last.length - 1] <= 4)
        {
            last.push(at);
        }
        else
        {
            found.push([at]);
        }
    });

    return found;
};

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

describe('a page with something on its way says so once', () =>
{
    it('in every group that stands for a list on its way, first', () =>
    {
        const silent = files().flatMap(({ file, lines }) => lines.flatMap((line, at) =>
        {
            if (!line.includes('data-reading'))
            {
                return [];
            }

            const said = line.includes('common.loading') || line.includes('data-reading>{ locale.t(') || lines[at + 1]?.trim() === WORDS;

            return said ? [] : [`${ file }:${ at + 1 }`];
        }));

        expect(silent, 'a group whose skeletons the stylesheet silences said nothing itself').toEqual([]);
    });

    it('as a group wherever more than one skeleton stands for one thing, so a screen reader is not told twice', () =>
    {
        const loose = files().flatMap(({ file, lines }) => runs(lines)
            .filter((run) => run.length > 1)
            .filter((run) => !lines.slice(Math.max(0, run[0] - 4), run[0] + 1).some((line) => line.includes('data-reading')))
            .map((run) => `${ file }:${ run[0] + 1 } (${ run.length } skeletons)`));

        expect(loose).toEqual([]);
    });

    it('and never hides a placeholder whole, which says nothing at all', () =>
    {
        const hidden = files().flatMap(({ file, lines }) => lines.flatMap((line, at) =>
            line.includes('<Skeleton') && lines.slice(Math.max(0, at - 2), at).some((above) => above.includes('aria-hidden="true"')) ? [`${ file }:${ at + 1 }`] : []));

        expect(hidden).toEqual([]);
    });
});
