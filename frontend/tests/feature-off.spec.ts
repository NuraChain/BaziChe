import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';

import FeatureOff, { SWITCHED_BY, type Feature } from '../src/components/app/feature-off.component.azeroth';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { establishAccount } from './fake-api.ts';

const SAID: Record<Feature, [string, string]> = {
    shop: ['The shop is turned off right now', 'This server sells no looks yet.'],
    paid: ['Playing for NURA is turned off right now', 'Every table on this server is free until it is turned on.'],
    donations: ['Sending NURA is turned off right now', 'Nobody on this server can send NURA to a player until it is turned on.'],
    markets: ['Backing a winner is turned off right now', 'Nobody on this server can back a winner with NURA until it is turned on.']
};

const shown = (feature: Feature, brief = false) => renderTest(() => FeatureOff({ feature, brief }) as unknown as HTMLElement).container;

beforeEach(() =>
{
    cleanup();
    useLocale().setLocale('en');
    useSession().reset();
});

afterEach(() =>
{
    cleanup();
    useSession().reset();
    useLocale().setLocale('en');
});

describe('a feature this server does not run', () =>
{
    it('says it is turned off and what that means, and only that it is off where room is short', () =>
    {
        for (const [feature, [title, lead]] of Object.entries(SAID) as [Feature, [string, string]][])
        {
            const whole = shown(feature);
            const note = whole.querySelector(`[role="note"][data-off="${ feature }"]`);

            expect(note?.textContent, feature).toContain(title);
            expect(note?.textContent, feature).toContain(lead);
            cleanup();

            expect(shown(feature, true).textContent?.trim(), feature).toBe(title);
            cleanup();
        }
    });

    it('tells whoever runs the money which settings turn it on, and nobody else', () =>
    {
        for (const [staff, told] of [[undefined, false], ['moderator', false], ['admin', true], ['owner', true]] as const)
        {
            useSession().establish(establishAccount('alex', staff === undefined ? {} : { staff }));

            const how = shown('markets').querySelector('[data-off-how]');

            expect(how !== null, String(staff)).toBe(told);

            for (const name of told ? SWITCHED_BY.markets : [])
            {
                expect(how?.textContent, name).toContain(name);
            }

            cleanup();
        }
    });

    it('says it in Persian', () =>
    {
        useLocale().setLocale('fa');

        expect(shown('paid', true).textContent?.trim()).toBe('بازی با NURA فعلاً خاموشه');
    });
});
