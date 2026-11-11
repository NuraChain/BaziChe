import { describe, it, expect, beforeEach } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';

import RulesSheet from '../src/components/games/rules-sheet.component.azeroth';
import { GAME_RULES } from '../src/data/game-rules.ts';
import type { GameId } from '../src/data/games.ts';
import '../src/locales/app-catalogue.ts';
import { en } from '../src/locales/en/index.ts';
import { fa } from '../src/locales/fa/index.ts';
import { useLocale } from '../src/stores/locale.store.ts';

type Rendered = HTMLElement;

const GAMES = Object.keys(GAME_RULES) as GameId[];

const LAZY = ['ar', 'es', 'fr', 'hi', 'pt', 'ru', 'tr', 'zh'] as const;

beforeEach(() =>
{
    cleanup();
    useLocale().setLocale('en');
});

const open = (game: GameId) => renderTest(() => RulesSheet({ game, overlayId: 'rules', close: () => undefined }) as Rendered).container;

describe('the full rules of a game', () =>
{
    it('shows every section of a game, each with its points one to a line', () =>
    {
        for (const game of GAMES)
        {
            const sheet = open(game);
            const sections = [...sheet.querySelectorAll('section')];

            expect(sections, game).toHaveLength(GAME_RULES[game].length);

            sections.forEach((section, index) =>
            {
                expect(section.querySelector('h3')?.textContent).toBe(en[GAME_RULES[game][index].title]);
                expect(section.querySelectorAll('li').length, `${ game } ${ index + 1 }`).toBe((en[GAME_RULES[game][index].points] as string).split('\n').length);
            });

            cleanup();
        }
    });

    it('is headed with the game\'s name, and reads in Persian too', () =>
    {
        useLocale().setLocale('fa');

        const sheet = open('backgammon');

        expect(sheet.querySelector('h2')?.textContent).toContain('قوانین');
        expect(sheet.querySelector('h3')?.textContent).toBe(fa['rules.backgammon.1.title']);
    });

    // Eight whole dictionaries are loaded here, which takes longer than a test is usually given.
    it('says the same rules in every language, point for point', async () =>
    {
        const keys = GAMES.flatMap((game) => GAME_RULES[game].flatMap((section) => [section.title, section.points]));
        const lines = (said: string) => said.split('\n').length;

        for (const lang of LAZY)
        {
            const dictionary = (await import(`../src/locales/${ lang }/index.ts`))[lang] as Record<string, string>;

            for (const key of [...keys, 'rules.title', 'rules.open', 'rules.heading'] as (keyof typeof en)[])
            {
                expect(typeof dictionary[key] === 'string' && dictionary[key].trim() !== '', `${ lang } ${ key }`).toBe(true);
                expect(lines(dictionary[key]), `${ lang } ${ key }`).toBe(lines(en[key] as string));
            }
        }

        for (const key of keys)
        {
            expect(lines(fa[key] as string), `fa ${ key }`).toBe(lines(en[key] as string));
        }
    }, 60_000);
});
