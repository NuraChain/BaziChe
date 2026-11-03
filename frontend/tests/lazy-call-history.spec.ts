import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';

import LazyCallHistory from '../src/components/call/lazy-call-history.component.azeroth';
import '../src/icons/all.ts';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';

/**
 * The Calls tab's list is a chunk of its own, and a chunk the browser could not fetch is said with
 * Try again, never an empty tab. A mock's factory that throws is wrapped in an error of vitest's own,
 * so the module is handed over and its export throws what the browser would.
 */
const { lost, asked } = vi.hoisted(() =>
{
    const counted = { times: 0 };

    return {
        asked: counted,
        lost: () => ({
            get default(): never
            {
                counted.times += 1;

                throw new TypeError('Failed to fetch dynamically imported module: https://baziche.com/assets/call-history.js');
            }
        })
    };
});

vi.mock('../src/components/call/call-history.component.azeroth', lost);

beforeEach(() =>
{
    cleanup();
    useLocale().setLocale('en');
    asked.times = 0;
});

describe('the Calls tab\'s list, when its chunk will not come', () =>
{
    it('says so with Try again, and asks for it again at the press', async () =>
    {
        const { container } = renderTest(() => LazyCallHistory({ pane: false }) as HTMLElement);

        await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull(), { timeout: 4000 });
        expect(container.querySelector('[data-call-history]'), 'no list').toBeNull();

        const before = asked.times;
        const again = [...container.querySelectorAll<HTMLButtonElement>('button')].find((one) => one.textContent?.trim() === 'Try again');

        expect(again).toBeDefined();
        fire(again!, 'click');

        await vi.waitFor(() => expect(asked.times).toBeGreaterThan(before), { timeout: 4000 });
        expect(container.querySelector('[role="alert"]'), 'still said').not.toBeNull();
    });
});
