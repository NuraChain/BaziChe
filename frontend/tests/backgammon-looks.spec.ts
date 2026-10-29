import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import type { MatchPlayer } from '../src/data/match.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { BAR_LEFT, BAR_WIDTH, BOTTOM, DICE_X, HEIGHT, MIDDLE, POINT_WIDTH, RADIUS, TOP, WIDTH, columnOf } from '../src/game/backgammon-layout.ts';
import { seedOf, spentBy, type Felt, type Told } from '../src/game/backgammon-felt.ts';
import { OFF, slotAt } from '../src/game/backgammon-men.ts';
import { KNOCK_MS, PICK_MS, THROW_MS, WALK_MOST, createBackgammonTable, type BackgammonTable } from '../src/game/board/backgammon-table.ts';
import { BORNE, ENTRIES } from '../src/game/looks/backgammon.ts';
import { CELEBRATIONS } from '../src/game/looks/celebrations.ts';
import { ENTER_MOST } from '../src/game/looks/entrances.ts';
import { DIE_PROPERTIES, dieDress } from '../src/game/looks/dice.ts';
import { CAPTURES, CRITICALS, burstOf, lightOf } from '../src/game/looks/table.ts';
import { restOf } from '../src/game/stage/dice.ts';
import { createDirector, type Director } from '../src/game/stage/director.ts';
import type { Act } from '../src/game/stage/feed.ts';
import { LAYER } from '../src/game/stage/layers.ts';
import type { Sight } from '../src/game/stage/presenter.ts';
import { createStage, type Stage } from '../src/game/stage/stage.ts';
import type { Cue, SoundHandle } from '../src/game/sound.ts';
import { START } from '../../backend/src/domains/match/backgammon/board.ts';

interface Drawn
{
    el: Element;
    options: KeyframeAnimationOptions;
    at: number;
}

interface Burst
{
    preset: string;
    at: { x: number; y: number };
    tune: { colors?: readonly string[]; scale?: number };
    when: number;

    /** A signature's layers; its first names it in `preset`. */
    steps?: readonly { effect: string }[];
}

const engine = vi.hoisted(() => ({ made: 0, layers: [] as (number | undefined)[], quiet: [] as (() => boolean)[], bursts: [] as Omit<Burst, 'when'>[], disposed: 0, now: (): number => 0 }));

vi.mock('../src/game/vfx/engine.ts', () => ({
    createVfx: (_host: HTMLElement, options: { layer?: number; quiet?: () => boolean }) =>
    {
        engine.made += 1;
        engine.layers.push(options.layer);
        engine.quiet.push(options.quiet ?? (() => false));

        return {
            burst: (preset: string, at: Burst['at'], tune: Burst['tune']) => engine.bursts.push({ preset, at, tune, when: engine.now() } as Burst),
            signature: (steps: readonly { effect: string }[], at: Burst['at'], tune: Burst['tune']) => engine.bursts.push({ preset: steps[0]!.effect, steps, at, tune, when: engine.now() } as Burst),
            stream: () => () => undefined,
            dispose: () =>
            {
                engine.disposed += 1;
            }
        };
    }
}));

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

/** How far apart in CSS pixels the board's units lie: the host is sized so that one unit is one pixel. */
const EM = 40;

const FITS = 40;

let clock: ManualClock;
let host: HTMLElement;
let stage: Stage;
let director: Director;
let table: BackgammonTable;
let cues: Cue[];
let heard: { cue: Cue; at: number }[];
let drawn: Drawn[];
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

const bursts = () => engine.bursts as Burst[];

/** What the table said in a look's voice: a voice is named `<collection>.<moment>`, and nothing else is. */
const voiced = () => cues.filter((cue) => cue.includes('.'));

/** When each die thrown so far comes to rest: the moment its toss began and how long it runs. */
const landings = () => drawn.filter((one) => one.el.classList.contains('die3d-body')).map((one) => one.at + Number(one.options.duration));

const dieAt = (seed: number, index: number, count: number) =>
{
    const spot = restOf(seed, index, count);

    return { x: DICE_X + spot.x * EM, y: 820 / 2 + spot.y * EM };
};

beforeEach(() =>
{
    const animate = Element.prototype.animate;
    const real = window.getComputedStyle.bind(window);
    const sound: SoundHandle = {
        play: (cue) =>
        {
            cues.push(cue);
            heard.push({ cue, at: clock.now() });
        },
        wear: () => undefined,
        ready: () => Promise.resolve(),
        setEnabled: () => undefined,
        dispose: () => undefined
    };

    clock = manualClock(1000);
    cues = [];
    heard = [];
    drawn = [];
    broke = [];
    still = false;
    worn = {};
    engine.made = 0;
    engine.layers = [];
    engine.quiet = [];
    engine.bursts = [];
    engine.disposed = 0;
    engine.now = () => clock.now();
    host = document.createElement('div');
    host.className = 'bg-layer';
    Object.defineProperty(host, 'clientWidth', { configurable: true, get: () => WIDTH });
    Object.defineProperty(host, 'clientHeight', { configurable: true, get: () => 820 });
    document.body.append(host);

    vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => (el instanceof HTMLElement && el.classList.contains('bgt-dice') ? { fontSize: `${ EM }px` } as CSSStyleDeclaration : real(el, pseudo)));
    vi.spyOn(Element.prototype, 'animate').mockImplementation(function (this: Element, frames, options)
    {
        drawn.push({ el: this, options: options as KeyframeAnimationOptions, at: clock.now() });

        return animate.call(this, frames, options);
    });

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

describe('the moments of a backgammon table, in their players’ looks', () =>
{
    const checker = RADIUS * 2 / FITS;

    it('plays each die’s landing where it comes to rest, in its thrower’s collection and sized to it, and nothing while it flies', async () =>
    {
        worn = { 0: { dice: 'dice.gold' } };
        table.reset(sight(felt()));
        play([act(6, 0, [{ e: 'roll', seat: 0, dice: [5, 2] }])], sight(felt({ dice: [5, 2], seed: seedOf('m', 6) }), 6));
        await elapse(PICK_MS + 200);

        expect(bursts(), 'a landing played while the dice were in the air').toEqual([]);
        expect(voiced()).toEqual([]);

        await elapse(THROW_MS + 600);

        const landed = landings();
        const seed = seedOf('m', 6);

        expect(bursts()).toHaveLength(2);
        expect(voiced()).toEqual(['gold.die', 'gold.die']);

        for (const [index, burst] of bursts().entries())
        {
            expect(burst.preset).toBe(burstOf('gold').effect);
            expect(burst.at.x).toBeCloseTo(dieAt(seed, index, 2).x);
            expect(burst.at.y).toBeCloseTo(dieAt(seed, index, 2).y);
            expect(burst.tune.colors).toEqual(lightOf('gold'));
            expect(burst.tune.scale).toBeCloseTo(EM / FITS);
            expect(burst.when, 'a die’s landing played before it landed').toBeGreaterThanOrEqual(landed[index]!);
            expect(burst.when - landed[index]!, 'a die’s landing played long after it landed').toBeLessThanOrEqual(10);
        }
    });

    it('plays doubles as its thrower’s critical reveal over the pair once both have landed, and no landing of their own', async () =>
    {
        worn = { 0: { dice: 'dice.storm' } };
        table.reset(sight(felt()));
        play([act(6, 0, [{ e: 'roll', seat: 0, dice: [4, 4] }])], sight(felt({ dice: [4, 4], seed: seedOf('m', 6) }), 6));
        await elapse(PICK_MS + THROW_MS + 600);

        const seed = seedOf('m', 6);
        const [one, two] = [dieAt(seed, 0, 2), dieAt(seed, 1, 2)];
        const [reveal] = bursts();

        expect(bursts()).toHaveLength(1);
        expect(reveal!.steps).toBe(CRITICALS.storm);
        expect(reveal!.at.x).toBeCloseTo((one.x + two.x) / 2);
        expect(reveal!.at.y).toBeCloseTo((one.y + two.y) / 2);
        expect(reveal!.tune.colors).toEqual(lightOf('storm'));
        expect(reveal!.tune.scale).toBeGreaterThan(EM / FITS);
        expect(reveal!.when).toBeGreaterThanOrEqual(Math.max(...landings()));
        expect(voiced()).toEqual(['storm.die', 'storm.die']);
    });

    it('plays a hit as its hitter’s capture where the blot stood, at the moment the two meet, with its voice', async () =>
    {
        worn = { 0: { checkers: 'checkers.inferno' }, 1: { checkers: 'checkers.frost' } };
        table.reset(sight(felt({ near: row({ 13: 1, 6: 14 }), far: row({ 17: 1, 12: 14 }), dice: [5, 3] })));
        play([act(6, 0, [{ e: 'move', seat: 0, from: 13, to: 8, die: 5, hit: true }])], sight(felt({ near: row({ 8: 1, 6: 14 }), far: row({ 25: 1, 12: 14 }) }), 6));
        await flush();

        const knock = drawn.find((one) => one.options.delay !== undefined && Number(one.options.delay) > 0)!;
        const contact = knock.at + Number(knock.options.delay);

        await elapse(contact - clock.now() - 10);

        expect(bursts(), 'the capture played before the two met').toEqual([]);
        expect(voiced()).toEqual([]);

        await elapse(WALK_MOST + KNOCK_MS);

        const [taken] = bursts();

        expect(bursts()).toHaveLength(1);
        expect(taken!.steps).toBe(CAPTURES.inferno);
        expect(taken!.at.x).toBeCloseTo(columnOf(8).x + POINT_WIDTH / 2);
        expect(taken!.at.y).toBeCloseTo(BOTTOM - RADIUS);
        expect(taken!.tune.colors).toEqual(lightOf('inferno'));
        expect(taken!.tune.scale).toBeCloseTo(checker);
        expect(taken!.when - contact).toBeLessThanOrEqual(5);
        expect(heard.filter((one) => one.cue.includes('.'))).toEqual([{ cue: 'inferno.capture', at: taken!.when }]);
    });

    it('plays a checker coming in from the bar as its owner’s entry where it lands, with its voice', async () =>
    {
        worn = { 0: { checkers: 'checkers.void' } };
        table.reset(sight(felt({ near: row({ 25: 1, 6: 14 }), far: row({ 12: 15 }), dice: [6, 3] })));
        play([act(6, 0, [{ e: 'move', seat: 0, from: 25, to: 19, die: 6, hit: false }])], sight(felt({ near: row({ 19: 1, 6: 14 }), far: row({ 12: 15 }) }), 6));
        await flush();

        const lift = drawn.find((one) => one.el.classList.contains('man'))!;
        const landing = lift.at + Number(lift.options.duration);

        await elapse(landing - clock.now() - 10);

        expect(bursts()).toEqual([]);

        await elapse(200);

        const [entry] = bursts();

        expect(bursts()).toHaveLength(1);
        expect(entry!.steps).toBe(ENTRIES.void);
        expect(entry!.at.x).toBeCloseTo(columnOf(19).x + POINT_WIDTH / 2);
        expect(entry!.at.y).toBeCloseTo(TOP + RADIUS);
        expect(entry!.tune.scale).toBeCloseTo(checker);
        expect(entry!.when - landing).toBeLessThanOrEqual(5);
        expect(voiced()).toEqual(['void.spawn']);
    });

    it('plays a checker borne off as its owner’s short signature where it lies in the tray, with its voice', async () =>
    {
        worn = { 0: { checkers: 'checkers.phoenix' } };
        table.reset(sight(felt({ near: row({ 3: 2, 0: 13 }), far: row({ 12: 15 }), dice: [3, 1] })));
        play([act(6, 0, [{ e: 'move', seat: 0, from: 3, to: 0, die: 3, hit: false }])], sight(felt({ near: row({ 3: 1, 0: 14 }), far: row({ 12: 15 }), dice: [3, 1] }), 6));
        await elapse(WALK_MOST + 200);

        const tray = slotAt('near', OFF, 13);
        const [borne] = bursts();

        expect(bursts()).toHaveLength(1);
        expect(borne!.steps).toBe(BORNE.phoenix);
        expect(borne!.at.x).toBeCloseTo(tray.x);
        expect(borne!.at.y).toBeCloseTo(tray.y);
        expect(borne!.tune.colors).toEqual(lightOf('phoenix'));
        expect(voiced()).toEqual(['phoenix.pawn']);
    });

    it('plays the reader’s own hit as they make it, and nothing as they take it back', async () =>
    {
        worn = { 0: { checkers: 'checkers.oni' } };
        table.reset(sight(felt({ near: row({ 13: 1, 6: 14 }), far: row({ 18: 1, 12: 14 }), dice: [6, 3] })));

        void table.hop({ side: 'near', from: 13, to: 7, hit: true });
        await elapse(WALK_MOST + KNOCK_MS);

        expect(bursts().map((one) => one.steps)).toEqual([CAPTURES.oni]);

        void table.unhop({ side: 'near', from: 13, to: 7, hit: true });
        await elapse(WALK_MOST + KNOCK_MS);

        expect(bursts(), 'taking a hit back played it again').toHaveLength(1);
        expect(voiced()).toEqual(['oni.capture']);
    });

    it('plays nothing as the reader takes back a checker they brought in from the bar', async () =>
    {
        worn = { 0: { checkers: 'checkers.storm' } };
        table.reset(sight(felt({ near: row({ 25: 1, 6: 14 }), far: row({ 12: 15 }), dice: [6, 3] })));

        void table.hop({ side: 'near', from: 25, to: 19, hit: false });
        await elapse(WALK_MOST + 200);

        expect(bursts().map((one) => one.steps)).toEqual([ENTRIES.storm]);

        void table.unhop({ side: 'near', from: 25, to: 19, hit: false });
        await elapse(WALK_MOST + 200);

        expect(bursts(), 'taking an entry back played it again').toHaveLength(1);
        expect(voiced()).toEqual(['storm.spawn']);
    });

    it('plays a checker carried in from the bar past its first point as an entry where it is set down', async () =>
    {
        worn = { 0: { checkers: 'checkers.jade' } };
        table.reset(sight(felt({ near: row({ 25: 1, 6: 14 }), far: row({ 12: 15 }), dice: [6, 3] })));
        table.grab(25);
        table.drag(columnOf(16).x, TOP + RADIUS);
        void table.hop({ side: 'near', from: 25, to: 19, hit: false }, true);
        void table.hop({ side: 'near', from: 19, to: 16, hit: false });
        await elapse(WALK_MOST + 200);

        expect(bursts().map((one) => [one.steps, one.at.x])).toEqual([[ENTRIES.jade, columnOf(16).x + POINT_WIDTH / 2]]);
        expect(voiced()).toEqual(['jade.spawn']);
    });

    it('draws every moment under the checkers and the dice, and lets it go to one fade for somebody who asked for less motion', async () =>
    {
        worn = { 0: { dice: 'dice.void' } };
        table.reset(sight(felt()));
        play([act(6, 0, [{ e: 'roll', seat: 0, dice: [3, 1] }])], sight(felt({ dice: [3, 1], seed: seedOf('m', 6) }), 6));
        await elapse(PICK_MS + THROW_MS + 600);

        expect(engine.made).toBe(1);
        expect(engine.layers[0]).toBe(LAYER.glow);
        expect(LAYER.glow).toBeLessThan(LAYER.piece);
        expect(LAYER.glow).toBeLessThan(LAYER.dice);
        expect(engine.quiet[0]!()).toBe(false);

        still = true;

        expect(engine.quiet[0]!(), 'the effects did not ask the table whether to move').toBe(true);
    });

    it('fetches the engine as soon as a checker in a look is drawn, so its first moment plays on time', async () =>
    {
        worn = { 1: { checkers: 'checkers.gold' } };
        table.reset(sight(felt()));

        await vi.waitFor(() => expect(engine.made).toBe(1));
    });

    it('plays nothing and fetches nothing for a table where nobody chose a look, and lets the engine go with the table', async () =>
    {
        worn = { 0: { home: 'home.gold' } };
        table.reset(sight(felt({ near: row({ 13: 1, 6: 14 }), far: row({ 17: 1, 12: 14 }), dice: [5, 3] })));
        play([act(6, 0, [{ e: 'move', seat: 0, from: 13, to: 8, die: 5, hit: true }, { e: 'roll', seat: 1, dice: [2, 2] }])], sight(felt({ near: row({ 8: 1, 6: 14 }), far: row({ 25: 1, 12: 14 }), dice: [2, 2], seed: seedOf('m', 6), turn: 'far' }), 6));
        await elapse(WALK_MOST + KNOCK_MS + PICK_MS + THROW_MS + 600);
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(engine.made, 'the engine was fetched for a table whose only look has no moment').toBe(0);
        expect(voiced()).toEqual([]);

        worn = { 1: { dice: 'dice.frost' } };
        table.reset(sight(felt({ dice: [5, 5], turn: 'far' }), 7, 0, 'n'));
        await vi.waitFor(() => expect(engine.made).toBe(1));

        table.dispose();

        expect(engine.disposed).toBe(1);
    });
});

describe('a backgammon winner’s celebration in the look they chose', () =>
{
    const cheersOf = () => bursts().filter((one) => Object.values(CELEBRATIONS).some((steps) => one.steps === steps));

    /** The last game of the match won by `winner`, read by the player in seat 0. */
    const won = async (winner: 0 | 1) =>
    {
        const theirs = winner === 1;
        const home = row({ 1: 1, 0: 14 });
        const behind = row({ 20: 15 });
        const before = felt({ near: theirs ? behind : home, far: theirs ? home : behind, turn: theirs ? 'far' : 'near' });
        const after = sight(felt({ near: theirs ? behind : row({ 0: 15 }), far: theirs ? row({ 0: 15 }) : behind, score: theirs ? { near: 0, far: 2 } : { near: 2, far: 0 } }), 6);

        table.reset(sight(before));
        play([act(6, winner, [
            { e: 'move', seat: winner, from: 1, to: 0, die: 1, hit: false },
            { e: 'game', seat: winner, how: 'gammon', points: 2, cube: 1 },
            { e: 'finish', seat: winner }
        ])], after);
        await elapse(400 + PICK_MS + 3000);
    };

    it('rises from the middle of the winner’s home board in its light, sized to the board, with its voice', async () =>
    {
        worn = { 0: { celebration: 'celebration.jade' }, 1: { celebration: 'celebration.oni' } };
        await won(0);
        await vi.waitFor(() => expect(cheersOf()).toHaveLength(1));

        const [cheered] = cheersOf();

        expect(cheered!.steps).toBe(CELEBRATIONS.jade);
        expect(cheered!.at.x).toBeCloseTo(BAR_LEFT + BAR_WIDTH + POINT_WIDTH * 3);
        expect(cheered!.at.y).toBeCloseTo((MIDDLE * 3 - TOP) / 2);
        expect(cheered!.tune.colors).toEqual(lightOf('jade'));
        expect(cheered!.tune.scale).toBe(Math.min(3, POINT_WIDTH * 6 / FITS));
        expect(voiced().filter((cue) => cue.endsWith('.victory')), 'the side that lost was heard celebrating').toEqual(['jade.victory']);
    });

    it('rises from the far home board for a winner across the table', async () =>
    {
        worn = { 1: { celebration: 'celebration.oni' } };
        await won(1);
        await vi.waitFor(() => expect(cheersOf()).toHaveLength(1));

        expect(cheersOf()[0]!.steps).toBe(CELEBRATIONS.oni);
        expect(cheersOf()[0]!.at.y).toBeCloseTo((TOP + MIDDLE) / 2);
    });

    it('rises for nobody at a game the match goes on after', async () =>
    {
        worn = { 0: { celebration: 'celebration.jade' } };

        table.reset(sight(felt({ near: row({ 1: 1, 0: 14 }), far: row({ 20: 15 }), turn: 'near' })));
        play([act(6, 0, [
            { e: 'move', seat: 0, from: 1, to: 0, die: 1, hit: false },
            { e: 'game', seat: 0, how: 'single', points: 1, cube: 1 }
        ])], sight(felt({ score: { near: 1, far: 0 } }), 6));
        await elapse(400 + PICK_MS + 3000);
        await flush();

        expect(cheersOf(), 'a game inside the match was celebrated as its end').toEqual([]);
        expect(voiced().filter((cue) => cue.endsWith('.victory'))).toEqual([]);
    });

    it('rises for nobody when the winner wears none', async () =>
    {
        worn = { 1: { celebration: 'celebration.oni' } };
        await won(0);
        await flush();

        expect(cheersOf()).toEqual([]);
        expect(voiced().filter((cue) => cue.endsWith('.victory'))).toEqual([]);
    });
});

describe('a backgammon side’s entrance in the look of its home board, as a game opens', () =>
{
    const entrancesOf = () => bursts().filter((one) => one.steps !== undefined && one.steps.length > 0 && Object.values(CELEBRATIONS).some((steps) => one.steps!.every((step, index) => step === steps[index])));

    it('rises from the middle of each side’s home board, the first layers of its collection, every layer for a whole set, in its light and with its voice', async () =>
    {
        worn = { 0: { home: 'home.frost', dice: 'dice.storm' }, 1: { home: 'home.void', dice: 'dice.void', checkers: 'checkers.void', celebration: 'celebration.void' } };
        table.reset(sight(felt()));
        table.enter();
        await vi.waitFor(() => expect(entrancesOf()).toHaveLength(2));

        const near = entrancesOf().find((one) => one.steps![0] === CELEBRATIONS.frost[0])!;
        const far = entrancesOf().find((one) => one.steps![0] === CELEBRATIONS.void[0])!;

        expect(near.steps).toEqual(CELEBRATIONS.frost.slice(0, 2));
        expect(near.at.x).toBeCloseTo(BAR_LEFT + BAR_WIDTH + POINT_WIDTH * 3);
        expect(near.at.y).toBeCloseTo((MIDDLE * 3 - TOP) / 2);
        expect(near.tune.colors).toEqual(lightOf('frost'));
        expect(near.tune.scale).toBe(Math.min(ENTER_MOST, POINT_WIDTH * 6 / FITS));
        expect(far.steps, 'a whole set was played short').toEqual(CELEBRATIONS.void);
        expect(far.at.y, 'the far side entered from the near home board').toBeCloseTo((TOP + MIDDLE) / 2);
        expect(voiced().filter((cue) => cue.endsWith('.spawn')).sort()).toEqual(['frost.spawn', 'void.spawn']);
    });

    it.each([{}, { dice: 'dice.void', checkers: 'checkers.void' }, { home: 'home.ember' }])('rises for nobody whose home board is %o', async (look) =>
    {
        worn = { 0: look, 1: look };
        table.reset(sight(felt()));
        table.enter();
        await flush();

        expect(entrancesOf()).toEqual([]);
        expect(voiced().filter((cue) => cue.endsWith('.spawn'))).toEqual([]);
    });
});
