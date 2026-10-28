import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import type { MatchPlayer } from '../src/data/match.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { BAR_LEFT, BAR_WIDTH, HEIGHT, MIDDLE, POINT_WIDTH, TOP, WIDTH } from '../src/game/backgammon-layout.ts';
import { seedOf, spentBy, type Felt, type Told } from '../src/game/backgammon-felt.ts';
import { PICK_MS, THROW_MS, WALK_MOST, createBackgammonTable, type BackgammonTable } from '../src/game/board/backgammon-table.ts';
import { DIE_PROPERTIES, dieDress } from '../src/game/looks/dice.ts';
import { createDirector, type Director } from '../src/game/stage/director.ts';
import type { Act } from '../src/game/stage/feed.ts';
import type { Sight } from '../src/game/stage/presenter.ts';
import { createStage, type Stage } from '../src/game/stage/stage.ts';
import type { SoundHandle } from '../src/game/sound.ts';
import { START } from '../../backend/src/domains/match/backgammon/board.ts';

type Look = NonNullable<MatchPlayer['look']>;

const row = (points: Record<number, number>) => Array.from({ length: 26 }, (_, point) => points[point] ?? 0);

const felt =(over: Partial<Felt> = {}): Felt => ({
    viewer: 0,
    near: START,
    far: START,
    dice: [],
    opening: [],
    spent: spentBy(over.dice ?? [], []),
    seed: seedOf('m', 5),
    cube: { on: true, value: 1, owner: null },
    score: { near: 0, far: 0 },
    round: 1,
    turn: 'near',
    ...over
});

const sight = (view: Felt, rev = 5, seat: number | null = 0, id = 'm'): Sight<Felt> => ({ id, rev, seat, view });

const act = (rev: number, seat: number, moves: Told[]): Act<Told> => ({ rev, seat, moves });

const flush = async () =>
{
    for (let turn = 0; turn < 12; turn += 1)
    {
        await Promise.resolve();
    }
};

let clock: ManualClock;
let host: HTMLElement;
let stage: Stage;
let director: Director;
let table: BackgammonTable;
let still: boolean;
let broke: unknown[];
let worn: Record<number, Look>;

const elapse = async (ms: number) =>
{
    for (let left = ms; left > 0; left -= 5)
    {
        clock.advance(Math.min(5, left));
        await flush();
    }

    await flush();
};

const play = (acts: Act<Told>[], seen: Sight<Felt>) => director.enqueue((ctx) => table.play(acts, seen, ctx), { estimate: table.estimate(acts) });

const men = (tone?: string) => [...host.querySelectorAll<HTMLElement>(tone === undefined ? '.man' : `.man[data-tone="${ tone }"]`)];

const dice = () => [...host.querySelectorAll<HTMLElement>('.bgt-dice > .die3d')];

const homes = () => [...host.querySelectorAll<HTMLElement>('.bgt-home')];

beforeEach(() =>
{
    const sound: SoundHandle = {
        play: () => undefined,
        wear: () => undefined,
        ready: () => Promise.resolve(),
        setEnabled: () => undefined,
        dispose: () => undefined
    };

    clock = manualClock(1000);
    broke = [];
    still = false;
    worn = {};
    host = document.createElement('div');
    host.className = 'bg-layer';
    document.body.append(host);

    stage = createStage({ clock, quiet: () => still, report: (error) => broke.push(error) });
    director = createDirector(stage, clock, (error) => broke.push(error));
    table = createBackgammonTable({
        host,
        stage,
        sound: () => sound,
        feel: () => undefined,
        say: String,
        looks: (seat) => worn[seat]
    });
});

afterEach(() =>
{
    director.cancel();
    table.dispose();
    host.remove();
    vi.restoreAllMocks();
    expect(broke).toEqual([]);
});

describe('backgammon checkers in the look their owner chose', () =>
{
    it('dresses each side’s fifteen in their owner’s look, and none in Classic or in a look this build does not draw', () =>
    {
        worn = { 0: { checkers: 'checkers.inferno' }, 1: { checkers: 'checkers.nowhere' } };
        table.reset(sight(felt()));

        expect(men('light').map((man) => man.dataset.checkers)).toEqual(Array.from({ length: 15 }, () => 'inferno'));
        expect(men('dark').filter((man) => man.hasAttribute('data-checkers')), 'a look nothing draws was named on the board').toEqual([]);

        worn = { 1: { checkers: 'checkers.void', dice: 'dice.gold' } };
        table.reset(sight(felt(), 5, 0, 'n'));

        expect(men('light').filter((man) => man.hasAttribute('data-checkers')), 'a side kept the look of the game before').toEqual([]);
        expect(men('dark').map((man) => man.dataset.checkers)).toEqual(Array.from({ length: 15 }, () => 'void'));
    });

    it('dresses the reader’s own side by their seat wherever they sit', () =>
    {
        worn = { 1: { checkers: 'checkers.jade' } };
        table.reset(sight(felt({ viewer: 1 }), 5, 1));

        expect(men('dark').every((man) => man.dataset.checkers === 'jade')).toBe(true);
        expect(men('light').some((man) => man.hasAttribute('data-checkers'))).toBe(false);
    });

    it('writes the count of a tall stack on its owner’s look', () =>
    {
        worn = { 0: { checkers: 'checkers.storm' } };
        table.reset(sight(felt({ near: row({ 6: 8, 5: 7 }), far: row({ 12: 15 }) })));

        const counts = [...host.querySelectorAll<HTMLElement>('.bgt-count')];

        expect(counts.map((tag) => [tag.dataset.checkers, tag.dataset.tone])).toEqual([['storm', 'light'], ['storm', 'light'], [undefined, 'dark']]);
    });

    it('keeps a checker’s look as it moves', async () =>
    {
        worn = { 0: { checkers: 'checkers.astral' } };
        table.reset(sight(felt({ dice: [5, 3] })));
        play([act(6, 0, [{ e: 'move', seat: 0, from: 13, to: 8, die: 5, hit: false }])], sight(felt({ near: row({ 24: 2, 13: 4, 8: 4, 6: 5 }) }), 6));
        await elapse(WALK_MOST + 200);

        expect(men('light').every((man) => man.dataset.checkers === 'astral')).toBe(true);
    });
});

describe('a backgammon home board in the look its owner chose', () =>
{
    it('lays each player’s home board over the six points of their home, the reader’s bottom right and the other’s turned round at the top', () =>
    {
        worn = { 0: { home: 'home.jade' }, 1: { home: 'home.frost' } };
        table.reset(sight(felt()));

        const [near, far] = ['near', 'far'].map((side) => homes().find((one) => one.dataset.side === side)!);

        expect(homes()).toHaveLength(2);
        expect(near.dataset.home).toBe('jade');
        expect(far.dataset.home).toBe('frost');

        for (const [one, top] of [[near, MIDDLE], [far, TOP]] as const)
        {
            expect(one.style.left).toBe(`${ ((BAR_LEFT + BAR_WIDTH) / WIDTH * 100).toFixed(3) }%`);
            expect(one.style.top).toBe(`${ (top / HEIGHT * 100).toFixed(3) }%`);
            expect(one.style.width).toBe(`${ (POINT_WIDTH * 6 / WIDTH * 100).toFixed(3) }%`);
            expect(one.style.height).toBe(`${ ((MIDDLE - TOP) / HEIGHT * 100).toFixed(3) }%`);
            expect(one.getAttribute('aria-hidden')).toBe('true');
        }
    });

    it('lays none in Classic or in a look this build does not draw, and follows the reader’s seat', () =>
    {
        worn = { 0: { home: 'home.nowhere' }, 1: { home: 'home.gold' } };
        table.reset(sight(felt({ viewer: 1 }), 5, 1));

        expect(homes().map((one) => [one.dataset.side, one.dataset.home])).toEqual([['near', 'gold']]);
    });

    it('goes with the table', () =>
    {
        worn = { 0: { home: 'home.jade' }, 1: { home: 'home.frost' } };
        table.reset(sight(felt()));

        expect(homes()).toHaveLength(2);

        table.dispose();

        expect(host.querySelectorAll('.bgt-home'), 'a home board outlived its table').toHaveLength(0);
    });

    it('is the node it was through a re-read, its look changed where it stands at a new game, and goes with its look', () =>
    {
        worn = { 0: { home: 'home.oni' } };
        table.reset(sight(felt()));

        const first = homes()[0];

        table.reset(sight(felt({ dice: [4, 2] }), 6));

        expect(homes()[0], 'a home board was laid again for a read that changed nothing').toBe(first);

        worn = { 0: { home: 'home.phoenix' } };
        table.reset(sight(felt(), 5, 0, 'n'));

        expect(homes()[0]).toBe(first);
        expect(first.dataset.home).toBe('phoenix');

        worn = {};
        table.reset(sight(felt(), 5, 0, 'o'));

        expect(homes()).toEqual([]);
        expect(first.isConnected, 'a home board stayed after its look was taken off').toBe(false);
    });
});

describe('backgammon dice in the look of whoever throws them', () =>
{
    const dressed = (die: HTMLElement) => Object.fromEntries(DIE_PROPERTIES.map((name) => [name, die.style.getPropertyValue(name)]));

    it('throws a roll in its roller’s look, and the next roller’s in their own or plain', async () =>
    {
        worn = { 0: { dice: 'dice.neon' } };
        table.reset(sight(felt()));
        play([act(6, 0, [{ e: 'roll', seat: 0, dice: [5, 2] }])], sight(felt({ dice: [5, 2], seed: seedOf('m', 6) }), 6));
        await elapse(PICK_MS + 40);

        expect(dice().map((die) => die.dataset.look)).toEqual(['neon', 'neon']);
        expect(dressed(dice()[0])).toEqual(dieDress('neon'));

        await elapse(THROW_MS + 400);
        play([act(7, 1, [{ e: 'move', seat: 0, from: 13, to: 8, die: 5, hit: false }, { e: 'move', seat: 0, from: 8, to: 6, die: 2, hit: false }, { e: 'roll', seat: 1, dice: [6, 3] }])], sight(felt({ dice: [6, 3], seed: seedOf('m', 7), turn: 'far' }), 7));
        await elapse(2 * WALK_MOST + PICK_MS + 80);

        expect(dice().map((die) => die.hasAttribute('data-look')), 'one seat’s dice were thrown in another’s look').toEqual([false, false]);
        expect(DIE_PROPERTIES.map((name) => dice()[0].style.getPropertyValue(name)).join('')).toBe('');
    });

    it('throws each opening die in its own thrower’s look, and lays the opening’s pair as its starter’s', async () =>
    {
        worn = { 0: { dice: 'dice.jade' }, 1: { dice: 'dice.storm' } };
        table.reset(sight(felt({ opening: [0, 0], turn: 'near' }), 1));
        play([act(2, 0, [{ e: 'throw', seat: 0, die: 6 }])], sight(felt({ opening: [6, 0], turn: 'far' }), 2));
        await elapse(THROW_MS + 200);
        play([act(3, 1, [{ e: 'throw', seat: 1, die: 2 }])], sight(felt({ opening: [6, 2], turn: 'far' }), 3));
        await elapse(80);

        expect(dice().map((die) => die.dataset.look)).toEqual(['jade', 'storm']);

        await elapse(THROW_MS + 200);
        play([act(4, 1, [{ e: 'opening', seat: 0, dice: [6, 2] }])], sight(felt({ dice: [6, 2], seed: seedOf('m', 4), turn: 'near' }), 4));
        await elapse(PICK_MS + 400);

        expect(dice().map((die) => die.dataset.look)).toEqual(['jade', 'jade']);
    });

    it('draws an opening read again with each die in its own thrower’s look', () =>
    {
        worn = { 0: { dice: 'dice.jade' }, 1: { dice: 'dice.storm' } };
        table.reset(sight(felt({ opening: [6, 2], turn: 'far' }), 3));

        expect(dice().map((die) => [die.dataset.face, die.dataset.look])).toEqual([['6', 'jade'], ['2', 'storm']]);
    });

    it('draws the dice a board is put right to in the look of whoever is to move', async () =>
    {
        worn = { 0: { dice: 'dice.neon' }, 1: { dice: 'dice.phoenix' } };
        table.reset(sight(felt()));
        director.enqueue((ctx) => table.settle(sight(felt({ dice: [5, 2], seed: seedOf('m', 6), turn: 'far' }), 6), ctx));
        await elapse(PICK_MS + 400);

        expect(dice().map((die) => die.dataset.look)).toEqual(['phoenix', 'phoenix']);
    });

    it('lays the blank dice the reader taps to roll in the reader’s own look', () =>
    {
        worn = { 0: { dice: 'dice.shiraz' }, 1: { dice: 'dice.glow' } };
        table.reset(sight(felt()));
        table.invite('roll');

        expect(dice()).toHaveLength(2);
        expect(dice().map((die) => [die.hasAttribute('data-blank'), die.dataset.look])).toEqual([[true, 'shiraz'], [true, 'shiraz']]);
    });

    it('draws a roll read again in the look of whoever it is to move', () =>
    {
        worn = { 0: { dice: 'dice.neon' }, 1: { dice: 'dice.astral' } };
        table.reset(sight(felt({ dice: [6, 1], turn: 'far' })));

        expect(dice().map((die) => die.dataset.look)).toEqual(['astral', 'astral']);
    });
});
