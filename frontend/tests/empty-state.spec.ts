import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';

import EmptyState from '../src/components/ui/empty-state.component.azeroth';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';

const PAGES = import.meta.glob('../src/pages/**/*.page.azeroth', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const settle = async () =>
{
    for (let step = 0; step < 10; step += 1)
    {
        await Promise.resolve();
    }

    await new Promise((resolve) => setTimeout(resolve, 30));
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

describe('an empty state', () =>
{
    it('says its lead and its next step in the language the reader switches to while it is drawn', async () =>
    {
        const locale = useLocale();
        const { container } = renderTest(() => EmptyState({
            get title()
            {
                return locale.t('groups.none');
            },
            get lead()
            {
                return locale.t('groups.noneLead');
            },
            get action()
            {
                return locale.t('groups.create');
            },
            onAction: () => undefined
        }) as HTMLElement);
        const said = () => [...container.querySelectorAll('p, button')].map((one) => one.textContent?.trim());

        expect(said()).toEqual([locale.t('groups.none'), locale.t('groups.noneLead'), locale.t('groups.create')]);

        locale.setLocale('fa');
        await settle();

        expect(said(), 'the lead or the next step kept the language it was first drawn in').toEqual([locale.t('groups.none'), locale.t('groups.noneLead'), locale.t('groups.create')]);
        expect(said()[1]).not.toBe('A group is a handful of people and a standing game. Make one, or join one below.');
    });

    it('balances its words over their lines, so no line holds one word alone', () =>
    {
        const { container } = renderTest(() => EmptyState({ title: 'Nothing for “zz”.', lead: 'Check the spelling, or try a shorter word.' }) as HTMLElement);

        expect([...container.querySelectorAll('p')].map((one) => one.classList.contains('text-balance'))).toEqual([true, true]);
    });

    it('names the page when it is the whole of it, and only then', async () =>
    {
        const { container } = renderTest(() => EmptyState({ title: 'No such group.', heading: true }) as HTMLElement);

        expect(container.querySelector('h1')?.textContent).toBe('No such group.');
        expect(container.querySelector('h1')?.classList.contains('text-balance')).toBe(true);

        cleanup();

        const plain = renderTest(() => EmptyState({ title: 'No friends yet' }) as HTMLElement).container;

        expect(plain.querySelector('h1')).toBeNull();
        expect(plain.querySelector('p.title')?.textContent).toBe('No friends yet');
    });

    it('names every page that says the thing it shows is not there', () =>
    {
        const unnamed: string[] = [];
        let found = 0;

        for (const [path, source] of Object.entries(PAGES))
        {
            for (const tag of source.split('<EmptyState').slice(1).map((rest) => rest.slice(0, rest.indexOf('/>'))))
            {
                if (/'[\w.]*(notFound|missing\.title)'/.test(tag))
                {
                    found += 1;

                    if (!/\bheading\b/.test(tag))
                    {
                        unnamed.push(path.replace('../src/', ''));
                    }
                }
            }
        }

        expect(found, 'the pages that say something is not there were not found').toBeGreaterThanOrEqual(9);
        expect(unnamed).toEqual([]);
    });

    it('says its heading in the language the reader switches to', async () =>
    {
        const { container } = renderTest(() => EmptyState({
            get title()
            {
                return useLocale().t('page.missing.title');
            },
            heading: true
        }) as HTMLElement);

        useLocale().setLocale('fa');
        await settle();

        expect(container.querySelector('h1')?.textContent).toBe('اینجا صفحه‌ای نیست.');
    });
});
