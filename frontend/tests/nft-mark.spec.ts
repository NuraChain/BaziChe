import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';

import AchievementTile, { type Medal } from '../src/components/social/achievement-tile.component.azeroth';
import '../src/icons/all.ts';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';

/**
 * A legendary achievement held on NuraChain says so on its tile, wherever the tile is drawn: "On
 * NuraChain" linking to the transaction that minted it, "Minting" while it is on its way, and
 * nothing at all for an achievement that is not a token.
 */

const HASH = `0x${ 'cd'.repeat(32) }`;

const medal = (over: Partial<Medal> = {}): Medal => ({
    name: { en: 'Ludo Legend 97', fa: 'افسانه‌ی لودو ۹۷' },
    blurb: { en: 'Won 9,000 games of Ludo.', fa: '۹۰۰۰ بازی لودو برد.' },
    icon: 'dice',
    tier: 'diamond',
    rarity: 'legendary',
    holders: 0.001,
    earnedAt: '2026-11-01T10:00:00.000Z',
    ...over
});

const tile = (one: Medal) => renderTest(() => AchievementTile({ achievement: one }) as HTMLElement).container;

afterEach(() =>
{
    cleanup();
    useLocale().setLocale('en');
});

describe('a legendary achievement on NuraChain', () =>
{
    it('links its tile to the transaction that minted it', () =>
    {
        const link = tile(medal({ nft: { state: 'minted', hash: HASH } })).querySelector('a[data-nft="minted"]');

        expect(link?.textContent).toBe('On NuraChain');
        expect(link?.getAttribute('href')).toBe(`https://explorer.nurachain.net/tx/${ HASH }`);
        expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    });

    it('says one on its way is minting, in the reader’s language', () =>
    {
        useLocale().setLocale('fa');

        expect(tile(medal({ nft: { state: 'minting' } })).querySelector('[data-nft="minting"]')?.textContent).toBe('در حال ساخت…');
    });

    it('says nothing of the chain for an achievement that is no token', () =>
    {
        expect(tile(medal()).querySelector('[data-nft]')).toBeNull();
    });
});
