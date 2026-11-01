import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';

import EmptyState from '../src/components/ui/empty-state.component.azeroth';
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
});
