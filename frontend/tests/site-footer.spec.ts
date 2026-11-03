import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';

import SiteFooter from '../src/components/layout/site-footer.component.azeroth';
import { GAMES } from '../src/data/games.ts';
import '../src/locales/app-catalogue.ts';
import { landing as trLanding } from '../src/locales/tr/landing.ts';
import { registerCatalogue, useLocale } from '../src/stores/locale.store.ts';

const SOURCES = import.meta.glob(['../src/sections/*.azeroth', '../src/pages/landing.page.azeroth'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const REPO = 'https://github.com/NuraChain/BaziChe';

const footer = () => renderTest(() => SiteFooter() as HTMLElement).container;

const said = (node: Element | null) => (node?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** Every link of the footer's columns by what it says. */
const ways = (container: HTMLElement) =>
    Object.fromEntries([...container.querySelectorAll('nav a')].map((link) => [said(link), link.getAttribute('href')]));

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

describe('the foot of the public pages', () =>
{
    it('leads round the product, to each game, to its source and to the chain it runs on', () =>
    {
        const container = footer();

        expect([...container.querySelectorAll('nav h2')].map(said)).toEqual(['Play', 'Games', 'Open source', 'NuraChain']);
        expect(ways(container)).toEqual({
            'Games': '/#games',
            'Friends and chats': '/#together',
            'Leaderboards': '/#compete',
            'Start playing': '/app',
            ...Object.fromEntries(GAMES.map((game) => [useLocale().t(`games.${ game.id }.name`), `/app/games/${ game.slug }`])),
            'Source code': REPO,
            'Run your own server': `${ REPO }/blob/main/docs/operations/self-hosting.md`,
            'Contribute': `${ REPO }/blob/main/.github/CONTRIBUTING.md`,
            'Report a security issue': `${ REPO }/security/policy`,
            'MIT License': `${ REPO }/blob/main/LICENSE`,
            'About NuraChain': 'https://nurachain.net',
            'Block explorer': 'https://explorer.nurachain.net',
            'NuraChain on GitHub': 'https://github.com/NuraChain'
        });
        expect(container.querySelector('nav')?.getAttribute('aria-label')).toBe('More links');
    });

    it('names where the brand can be followed, each drawn from its mark in the file beside the page', () =>
    {
        const container = footer();
        const places = [...container.querySelectorAll('[data-elsewhere]')];

        expect(places.map((place) => [place.getAttribute('aria-label'), place.getAttribute('href')])).toEqual([
            ['Baziche on GitHub', REPO],
            ['Baziche on Telegram', 'https://t.me/bazichecom'],
            ['Baziche on Discord', 'https://discord.gg/H2jTm7F2gK'],
            ['NuraChain on X', 'https://x.com/nurachainnet']
        ]);
        expect(places.map((place) => place.querySelector('use')?.getAttribute('href'))).toEqual([
            '/brand-marks.svg#github',
            '/brand-marks.svg#telegram',
            '/brand-marks.svg#discord',
            '/brand-marks.svg#x'
        ]);
        expect(places.every((place) => place.querySelector('svg')?.getAttribute('aria-hidden') === 'true'), 'a mark says nothing its link does not').toBe(true);
        expect(container.querySelector('[data-elsewhere]')?.closest('ul')?.getAttribute('aria-label')).toBe('Follow us');
    });

    it('ends with the year and the framework it is built with', () =>
    {
        const container = footer();
        const year = String(new Date().getFullYear());

        expect(said(container.querySelector('[data-rights]'))).toBe(`© ${ year } Baziche. All rights reserved.`);
        expect(container.querySelector('[data-rights]')?.classList.contains('flex'), 'a row of flex items drops the spaces between them').toBe(false);
        expect(said(container.querySelector('[data-built-with]'))).toBe('Built with AzerothJS');
        expect(container.querySelector('[data-built-with] a')?.getAttribute('href')).toBe('https://github.com/AzerothJS/AzerothJS');
        expect(said(container.querySelector('[data-built-with] a'))).toBe('AzerothJS');
    });

    it('leads only to a page of its own or to an address over https', () =>
    {
        const container = footer();
        const all = [...container.querySelectorAll('a')].map((link) => link.getAttribute('href') ?? '');

        expect(all.filter((href) => !/^(\/|https:\/\/)/.test(href))).toEqual([]);
    });

    it('says it in Persian, the framework’s name where the sentence puts it', () =>
    {
        useLocale().setLocale('fa');

        const container = footer();

        expect([...container.querySelectorAll('nav h2')].map(said)).toEqual(['بازی', 'بازی‌ها', 'متن‌باز', 'شبکه‌ی NuraChain']);
        expect(said(container.querySelector('[data-built-with]'))).toBe('ساخته‌شده با AzerothJS');
        expect(container.querySelector('[data-elsewhere]')?.getAttribute('aria-label')).toBe('بازیچه توی گیت‌هاب');
    });

    it('puts the name first where the language does', () =>
    {
        registerCatalogue({ tr: trLanding });
        useLocale().setLocale('tr');

        const container = footer();

        expect(said(container.querySelector('[data-built-with]'))).toBe('AzerothJS ile yapıldı');
        expect(container.querySelector('[data-built-with]')?.firstElementChild?.tagName, 'the link opens the sentence').toBe('A');
    });

    it('has every place on the landing its links name', () =>
    {
        const rows = SOURCES['../src/sections/scene-rows.section.azeroth'];
        const landing = SOURCES['../src/pages/landing.page.azeroth'];

        expect(SOURCES['../src/sections/scene-games.section.azeroth']).toContain('<section id="games"');
        expect(rows, 'a section of rows is named by its beat').toMatch(/<section id=\{ props\.beat \}/);
        expect(landing).toContain('<SceneRows beat="together"');
        expect(landing).toContain('<SceneRows beat="compete"');
    });
});
