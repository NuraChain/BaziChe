import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { addFriend } from '../src/lib/add-friend.ts';
import { giveTo } from '../src/lib/donate-sheet.ts';
import { findGame } from '../src/lib/find-game.ts';
import { inviteTo } from '../src/lib/invite-sheet.ts';
import { openLook } from '../src/lib/look-sheet.ts';
import { openMarket } from '../src/lib/market-sheet.ts';
import { aboutPerson } from '../src/lib/person-menu.ts';
import { playWith } from '../src/lib/play-with.ts';
import { resetRuntime } from '../src/lib/runtime.ts';
import { manageVoice } from '../src/lib/voice-manager.ts';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';

/**
 * A chunk the browser could not fetch. A mock's factory that throws is wrapped in an error of
 * vitest's own, so the module is handed over and its export throws what the browser would.
 */
const { lost } = vi.hoisted(() => ({
    lost: () => ({
        get default(): never
        {
            throw new TypeError('Failed to fetch dynamically imported module: https://baziche.com/assets/sheet.js');
        }
    })
}));

vi.mock('../src/components/social/add-friend.component.azeroth', lost);
vi.mock('../src/components/donate/donate-sheet.component.azeroth', lost);
vi.mock('../src/components/games/quick-finder.component.azeroth', lost);
vi.mock('../src/components/games/invite-sheet.component.azeroth', lost);
vi.mock('../src/components/shop/look-sheet.component.azeroth', lost);
vi.mock('../src/components/market/market-sheet.component.azeroth', lost);
vi.mock('../src/components/social/person-actions.component.azeroth', lost);
vi.mock('../src/components/social/play-with-sheet.component.azeroth', lost);
vi.mock('../src/components/voice/voice-manager.component.azeroth', lost);

const SHEETS: readonly (readonly [string, () => unknown])[] = [
    ['add a friend', () => addFriend()],
    ['send NURA', () => giveTo('match-1', 'sara.k', 'Sara')],
    ['find a game', () => findGame('ludo')],
    ['invite to a table', () => inviteTo('table-1')],
    ['a look', () => openLook('dice.glow')],
    ['a market', () => openMarket('match-1')],
    ['a person', () => aboutPerson('sara.k')],
    ['play with', () => playWith('sara.k', true)],
    ['the voice', () => manageVoice('table-1')]
];

const said = () => useToasts().items().map((toast) => toast.text);

beforeEach(() =>
{
    resetRuntime();
    useLocale().setLocale('en');
    useToasts().reset();
    useOverlay().reset();
});

afterEach(() =>
{
    Reflect.deleteProperty(navigator, 'onLine');
});

describe('a sheet that would not come', () =>
{
    it.each(SHEETS)('says the server could not be reached: %s', async (_, open) =>
    {
        void open();

        await vi.waitFor(() => expect(said()).toEqual([useLocale().t('failure.unreached')]), { timeout: 4000 });
        expect(useOverlay().items()).toHaveLength(0);
    });

    it.each(SHEETS)('says the reader is offline when the browser says so: %s', async (_, open) =>
    {
        Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });

        void open();

        await vi.waitFor(() => expect(said()).toEqual([useLocale().t('failure.offline')]), { timeout: 4000 });
    });
});
