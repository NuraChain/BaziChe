import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { createSignal } from 'azerothjs';

import ErrorState from '../src/components/ui/error-state.component.azeroth';
import { resetRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { ApiError } from './fake-api.ts';

const SOURCES = import.meta.glob('../src/**/*.azeroth', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const lead = (props: Parameters<typeof ErrorState>[0]) =>
    renderTest(() => ErrorState(props) as unknown as HTMLElement).container.querySelector('[data-error-lead]')?.textContent;

const answered = (status: number, code: string) => new ApiError(status, code, 'x', undefined);

beforeEach(() =>
{
    resetRuntime();
    useLocale().setLocale('en');
});

afterEach(() =>
{
    cleanup();
    Reflect.deleteProperty(navigator, 'onLine');
});

describe('a read that failed', () =>
{
    it('says the lead it was given, or the plain one, when nothing went wrong on the way', () =>
    {
        expect(lead({ lead: 'The games could not be read.' })).toBe('The games could not be read.');
        expect(lead({})).toBe(useLocale().t('state.errorLead'));
        expect(lead({ error: new Error('a fault in the page') })).toBe(useLocale().t('state.errorLead'));
    });

    it('says what went wrong on the way in place of any lead', () =>
    {
        const t = useLocale().t;

        expect(lead({ error: new TypeError('Failed to fetch'), lead: 'The games could not be read.' })).toBe(t('failure.unreached'));
        expect(lead({ error: answered(500, 'internal') })).toBe(t('failure.server'));
        expect(lead({ error: answered(502, 'unknown') })).toBe(t('failure.down'));
        expect(lead({ error: new DOMException('signal timed out', 'TimeoutError') })).toBe(t('failure.timeout'));
        expect(lead({ error: answered(429, 'too-many-requests') })).toBe(t('failure.busy'));

        Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });

        expect(lead({ error: new TypeError('Failed to fetch') })).toBe(t('failure.offline'));
    });

    it('keeps its lead for a refusal, which is the page\'s to word', () =>
    {
        expect(lead({ error: answered(404, 'not-found'), lead: 'No such game.' })).toBe('No such game.');
        expect(lead({ error: answered(404, 'not-found') })).toBe(useLocale().t('state.errorLead'));
        expect(lead({ error: answered(503, 'chain-unreachable'), lead: 'NuraChain could not be reached just now.' })).toBe('NuraChain could not be reached just now.');
    });

    it('follows the failure as it changes, in the line it drew', () =>
    {
        const [error, setError] = createSignal<unknown>(null);
        const { container } = renderTest(() => ErrorState({
            get error()
            {
                return error();
            }
        }) as unknown as HTMLElement);
        const line = container.querySelector('[data-error-lead]');

        expect(line?.textContent).toBe(useLocale().t('state.errorLead'));

        setError(() => answered(500, 'internal'));

        expect(container.querySelector('[data-error-lead]')).toBe(line);
        expect(line?.textContent).toBe(useLocale().t('failure.server'));
    });

    it('says it in Persian', () =>
    {
        useLocale().setLocale('fa');

        expect(lead({ error: answered(503, 'unknown') })).toBe('سرور الان جواب نمی‌ده. یه کم دیگه دوباره امتحان کن.');
    });
});

describe('every page that says a read failed', () =>
{
    it('is handed what the read failed with, but where no request failed behind it', () =>
    {
        const bare: Record<string, number> = {};

        for (const [path, source] of Object.entries(SOURCES))
        {
            const tags = source.split('<ErrorState').slice(1).map((rest) => rest.slice(0, rest.indexOf('/>')));
            const unhanded = tags.filter((tag) => !tag.includes(' error={')).length;

            if (unhanded > 0)
            {
                bare[path.replace('../src/', '')] = unhanded;
            }
        }

        expect(bare).toEqual({
            'components/games/watch-board.component.azeroth': 1,
            'pages/app/check.page.azeroth': 1,
            'pages/app/play.page.azeroth': 2
        });
    });
});
