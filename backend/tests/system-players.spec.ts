import 'reflect-metadata';
import { describe, expect, it } from 'vitest';

import { ForbiddenError } from '@azerothjs/http';
import { getMetadataArgsStorage } from 'typeorm';

import '../src/entities/index.ts';
import { ACTION_KINDS } from '../src/domains/admin/roles.ts';

import { face, type PersonRow } from '../src/domains/admin/people.ts';
import { checkHandle } from '../src/domains/identity/handle.ts';
import { OPENNESS } from '../src/domains/ai/agent.ts';
import { AGENTS } from '../src/domains/ai/agents.ts';
import { adminSystem } from '../src/schemas.ts';
import { gamesAfter, gamesText, playerOf, settingsOf, settingsText, strategiesOf, systemViewOf, unknownGames, type PlayerRow } from '../src/domains/system/admin.ts';
import { systemRefusal } from '../src/domains/system/guard.ts';
import { looksStaff, systemNameOf } from '../src/domains/system/names.ts';
import { poolStep, styleOf, systemUserOf } from '../src/domains/system/pool.ts';
import { SKILLS, SYSTEM_DEFAULTS, gameOn, noAiFigures, systemConfigOf, systemConfigText } from '../src/domains/system/rules.ts';

/** xorshift32, in [0, 1). */
const seeded = (seed: number) =>
{
    let state = (seed * 2654435761) >>> 0 || 1;

    return () =>
    {
        state ^= state << 13;
        state >>>= 0;
        state ^= state >>> 17;
        state ^= state << 5;
        state >>>= 0;

        return state / 2 ** 32;
    };
};

const expressionOf = (name: string) => getMetadataArgsStorage().checks.find((one) => one.name === name)?.expression ?? '';
const wordsIn = (name: string) => [...expressionOf(name).matchAll(/'([a-z-]+)'/g)].map((match) => match[1]);

describe('the system players schema', () =>
{
    it('keeps system players in a table of their own, with the setting key and the staff action kind known', () =>
    {
        const target = (one: { target?: string | Function }) => typeof one.target === 'function' ? one.target.name : '';

        expect(getMetadataArgsStorage().tables.find((one) => target(one) === 'SystemPlayer')?.name).toBe('system_players');
        expect(wordsIn('system_players_skill_known')).toEqual([...SKILLS]);
        expect(expressionOf('system_players_style_range')).toBe('style between 0 and 999');
        expect(wordsIn('settings_key_known')).toContain('system-players');
        expect(wordsIn('staff_actions_kind_known')).toEqual([...ACTION_KINDS]);
    });
});

describe('the system players setting', () =>
{
    it('reads nothing, nonsense and a non-object as the defaults, which ship off', () =>
    {
        for (const value of [null, '', 'not json', '[]', '42', 'null', '"on"'])
        {
            expect(systemConfigOf(value), String(value)).toEqual(SYSTEM_DEFAULTS);
        }

        expect(SYSTEM_DEFAULTS.on).toBe(false);
    });

    it('is on only when it says on: true', () =>
    {
        expect(systemConfigOf('{"on":true}').on).toBe(true);

        for (const on of ['"true"', '1', 'null', 'false'])
        {
            expect(systemConfigOf(`{"on":${ on }}`).on, on).toBe(false);
        }
    });

    it('pulls the wait and the cap into their ranges and keeps whole numbers', () =>
    {
        expect(systemConfigOf('{"wait":1,"most":0}')).toMatchObject({ wait: 5, most: 1 });
        expect(systemConfigOf('{"wait":999,"most":5000}')).toMatchObject({ wait: 120, most: 200 });
        expect(systemConfigOf('{"wait":30.4,"most":12.6}')).toMatchObject({ wait: 30, most: 13 });
        expect(systemConfigOf('{"wait":"30","most":null}')).toMatchObject({ wait: 20, most: 40 });
    });

    it('reads a skill nobody knows as the default, and every known one as itself', () =>
    {
        expect(systemConfigOf('{"skill":"grandmaster"}').skill).toBe('intermediate');
        expect(systemConfigOf('{"skill":7}').skill).toBe('intermediate');

        for (const skill of SKILLS)
        {
            expect(systemConfigOf(JSON.stringify({ skill })).skill).toBe(skill);
        }
    });

    it('keeps only games named like games and switched by a boolean', () =>
    {
        expect(systemConfigOf('{"games":{"chess":false,"hokm":true,"Bad Id":false,"ludo":"off"}}').games).toEqual({ chess: false, hokm: true });
        expect(systemConfigOf('{"games":["chess"]}').games).toEqual({});
    });

    it('writes one text a config reads back as itself, whatever order the games were set in', () =>
    {
        const config = { on: true, games: { poker: false, chess: false }, wait: 45, skill: 'advanced' as const, most: 80 };

        expect(systemConfigOf(systemConfigText(config))).toEqual(config);
        expect(systemConfigText(config)).toBe(systemConfigText({ ...config, games: { chess: false, poker: false } }));
    });

    it('seats at a game only when the switch is on and the game is not switched off', () =>
    {
        const config = { ...SYSTEM_DEFAULTS, on: true, games: { chess: false } };

        expect(gameOn(config, 'chess')).toBe(false);
        expect(gameOn(config, 'hokm')).toBe(true);
        expect(gameOn({ ...config, on: false }, 'hokm')).toBe(false);
    });
});

describe('system player names', () =>
{
    it('gives the same name for the same seed', () =>
    {
        expect(systemNameOf(seeded(7))).toEqual(systemNameOf(seeded(7)));
    });

    it('makes handles that pass the handle rule, never staff-like, with a display name and a hue', () =>
    {
        for (let seed = 1; seed <= 3000; seed += 1)
        {
            const name = systemNameOf(seeded(seed));

            expect(checkHandle(name.handle), name.handle).toBeNull();
            expect(looksStaff(name.handle), name.handle).toBe(false);
            expect(looksStaff(name.displayName), name.displayName).toBe(false);
            expect(name.displayName.trim().length, name.handle).toBeGreaterThan(0);
            expect(name.displayName.length).toBeLessThanOrEqual(40);
            expect(Number.isInteger(name.hue) && name.hue >= 0 && name.hue <= 359).toBe(true);
        }
    });

    it('reads a staff or machine word in a name as staff-like', () =>
    {
        for (const name of ['admin', 'sara.admin', 'Support Team', 'bot_7', 'nura.k', 'baziche99', 'mod.x', 'the.system'])
        {
            expect(looksStaff(name), name).toBe(true);
        }

        for (const name of ['sara.m', 'amir_h7', 'reza1372', 'Aida', 'Maryam K.', 'سارا'])
        {
            expect(looksStaff(name), name).toBe(false);
        }
    });

    it('rarely repeats over a few thousand seeds, and never in sequence', () =>
    {
        const handles = Array.from({ length: 3000 }, (_, at) => systemNameOf(seeded(at + 1)).handle);
        const counts = new Map<string, number>();

        for (const handle of handles)
        {
            counts.set(handle, (counts.get(handle) ?? 0) + 1);
        }

        // The pool is capped at 200 and a taken handle is drawn again, so a rare repeat costs one retry.
        expect(counts.size / handles.length).toBeGreaterThan(0.97);
        expect(Math.max(...counts.values())).toBeLessThanOrEqual(3);
        expect(handles.some((handle, at) => at > 0 && handle === handles[at - 1])).toBe(false);
    });

    it('gives different names one after another from one stream', () =>
    {
        const random = seeded(11);
        const drawn = Array.from({ length: 200 }, () => systemNameOf(random).handle);

        expect(new Set(drawn).size).toBeGreaterThan(195);
    });
});

describe('the pool', () =>
{
    it('takes an idle one, makes one under the cap, and otherwise leaves the table waiting', () =>
    {
        expect(poolStep(true, 40, 40)).toBe('take');
        expect(poolStep(false, 39, 40)).toBe('make');
        expect(poolStep(false, 40, 40)).toBe('none');
        expect(poolStep(false, 41, 40)).toBe('none');
    });

    it('makes a users row no stranger can message, shown online to nobody, with no picture and no age', () =>
    {
        const user = systemUserOf(systemNameOf(seeded(3)));

        expect(user).toMatchObject({ isMinor: false, allowStrangerMessages: false, showOnline: false, avatar: null, bio: '' });
    });

    it('draws a style from 0 to 999', () =>
    {
        expect(styleOf(() => 0)).toBe(0);
        expect(styleOf(() => 0.999_999_9)).toBe(999);
        expect(styleOf(() => 1)).toBe(999);
    });
});

describe('what a system player may never hold', () =>
{
    it('refuses a session and a wallet to a system player and to nobody else', () =>
    {
        expect(systemRefusal(true, 'session')).toBeInstanceOf(ForbiddenError);
        expect(systemRefusal(true, 'wallet')).toBeInstanceOf(ForbiddenError);
        expect(systemRefusal(false, 'session')).toBeNull();
        expect(systemRefusal(false, 'wallet')).toBeNull();
    });
});

describe('the staff page for system players', () =>
{
    it('keeps only the games switched off, since a game absent is on', () =>
    {
        expect(gamesAfter({ chess: false }, { chess: true, poker: false })).toEqual({ poker: false });
        expect(gamesAfter({}, { hokm: true })).toEqual({});
        expect(gamesText({ ...SYSTEM_DEFAULTS, games: { poker: false, chess: false } })).toBe('off: chess, poker');
        expect(gamesText(SYSTEM_DEFAULTS)).toBe('all on');
    });

    it('names the games a change asks for that the site does not have', () =>
    {
        expect(unknownGames({ chess: false, tetris: true }, ['chess', 'hokm'])).toEqual(['tetris']);
        expect(unknownGames({}, ['chess'])).toEqual([]);
    });

    it('takes settings only inside their ranges', () =>
    {
        expect(settingsOf({ wait: 30, skill: 'semi-pro', most: 60 })).toEqual({ wait: 30, skill: 'semi-pro', most: 60 });

        for (const said of [{ wait: 4, skill: 'casual', most: 10 }, { wait: 20.5, skill: 'casual', most: 10 }, { wait: 20, skill: 'pro', most: 10 }, { wait: 20, skill: 'casual', most: 201 }])
        {
            expect(settingsOf(said), JSON.stringify(said)).toBeNull();
        }

        expect(settingsText(SYSTEM_DEFAULTS)).toBe('wait 20s, skill intermediate, most 40');
    });

    it('shows each game on or off with its figures, and the runtime\'s figures as they are', () =>
    {
        const view = systemViewOf(
            { ...SYSTEM_DEFAULTS, on: true, games: { poker: false } },
            [{ game: 'chess', seated: 1, playing: 2, live: 1, today: 4 }, { game: 'poker', seated: 0, playing: 0, live: 0, today: 0 }],
            { size: 12, retired: 1 },
            noAiFigures()
        );

        expect(view).toEqual({
            on: true,
            wait: 20,
            skill: 'intermediate',
            most: 40,
            games: [{ game: 'chess', on: true, seated: 1, playing: 2, live: 1, today: 4 }, { game: 'poker', on: false, seated: 0, playing: 0, live: 0, today: 0 }],
            pool: { size: 12, retired: 1 },
            ai: { decisions: 0, averageMs: 0, worstMs: 0, fallbacks: 0, errors: [] }
        });
    });

    it('names the strategy live for each game from the registry, open or hidden, and none for a game no agent plays', () =>
    {
        const strategies = strategiesOf(AGENTS, OPENNESS);
        const view = systemViewOf(
            SYSTEM_DEFAULTS,
            [{ game: 'chess', seated: 0, playing: 0, live: 0, today: 0 }, { game: 'hokm', seated: 0, playing: 0, live: 0, today: 0 }, { game: 'go', seated: 0, playing: 0, live: 0, today: 0 }],
            { size: 0, retired: 0 },
            noAiFigures(),
            strategies
        );

        expect(Object.keys(strategies).sort()).toEqual(Object.keys(AGENTS).sort());
        expect(view.games[0].strategy).toEqual({ agent: AGENTS.chess.id, version: AGENTS.chess.version, sees: 'open' });
        expect(view.games[1].strategy).toEqual({ agent: AGENTS.hokm.id, version: AGENTS.hokm.version, sees: 'hidden' });
        expect(view.games[2]).not.toHaveProperty('strategy');
        expect(adminSystem.parse(view)).toEqual(view);
    });

    it('shows a pool row with where it is now only when it is somewhere, and when it retired only once it has', () =>
    {
        const row: PlayerRow = {
            id: '00000000-0000-4000-8000-000000000001',
            at_key: '1',
            handle: 'sara.m',
            display_name: 'Sara',
            hue: 200,
            skill: 'advanced',
            style: 412,
            played: 9,
            retired_at: null,
            created_at: new Date('2026-11-01T10:00:00Z'),
            table_code: null,
            table_game: null,
            playing: null
        };

        expect(playerOf(row)).toEqual({ handle: 'sara.m', displayName: 'Sara', hue: 200, skill: 'advanced', style: 412, played: 9, retired: false, createdAt: '2026-11-01T10:00:00.000Z' });
        expect(playerOf({ ...row, table_code: 'ab12', table_game: 'hokm', playing: true, retired_at: new Date('2026-11-02T10:00:00Z') })).toMatchObject({
            at: { table: 'ab12', game: 'hokm', playing: true },
            retired: true,
            retiredAt: '2026-11-02T10:00:00.000Z'
        });
    });
});

describe('the system mark in the staff\'s people', () =>
{
    const row: PersonRow = {
        id: '00000000-0000-4000-8000-000000000002',
        at_key: '1',
        handle: 'amir_h7',
        display_name: 'Amir',
        hue: 30,
        avatar: null,
        created_at: new Date('2026-11-01T10:00:00Z'),
        is_minor: false,
        is_suspended: false,
        address: null,
        staff_role: null,
        owner: false,
        ranked: false,
        reports: 0,
        system: true
    };

    it('is said only to a viewer holding the ability, and only of a system player', () =>
    {
        expect(face(row, true).system).toBe(true);
        expect('system' in face(row, false)).toBe(false);
        expect('system' in face({ ...row, system: false }, true)).toBe(false);
    });
});
