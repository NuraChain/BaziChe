import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fire } from '@azerothjs/testing';

import { playAt } from '../src/game/looks/cards.ts';
import { CELEBRATIONS } from '../src/game/looks/celebrations.ts';
import { lightOf } from '../src/game/looks/table.ts';
import { TIMING } from '../src/game/motion.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useDevice } from '../src/stores/device.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useBoard } from '../src/stores/match.store.ts';
import type { MatchView } from '../src/api.ts';
import { act, card, elapse, flush, mounted, type Hokm } from './hokm-mounted.ts';

interface Burst
{
    preset: string;
    at: { x: number; y: number };
    tune: { colors?: readonly string[]; scale?: number };

    /** A signature's layers; its first names it in `preset`. */
    steps?: readonly { effect: string }[];
}

const engine = vi.hoisted(() => ({ made: 0, hosts: [] as HTMLElement[], quiet: [] as (() => boolean)[], bursts: [] as Burst[], disposed: 0 }));

vi.mock('../src/game/vfx/engine.ts', () => ({
    createVfx: (host: HTMLElement, options: { quiet?: () => boolean }) =>
    {
        engine.made += 1;
        engine.hosts.push(host);
        engine.quiet.push(options.quiet ?? (() => false));

        return {
            burst: (preset: string, at: Burst['at'], tune: Burst['tune']) => engine.bursts.push({ preset, at, tune }),
            signature: (steps: readonly { effect: string }[], at: Burst['at'], tune: Burst['tune']) => engine.bursts.push({ preset: steps[0]!.effect, steps, at, tune }),
            stream: () => () => undefined,
            dispose: () =>
            {
                engine.disposed += 1;
            }
        };
    }
}));

type Look = NonNullable<MatchView['players'][number]['look']>;

const WORN: Record<number, Look> = { 0: { face: 'face.glow' }, 1: { face: 'face.neon', back: 'back.gold' }, 2: { face: 'face.ember', back: 'back.ember' } };

const LONG = 20_000;

const five = () => [0, 1, 2, 3].map((seat) => ({ seat, side: seat % 2, held: 5, tricks: 0, out: false }));

const table = (view: Partial<Hokm> = {}, mine: number | null = 0, worn: Record<number, Look> = WORN): MatchView => ({
    id: 'match-1',
    tableId: 'table-1',
    game: 'hokm',
    rev: 3,
    seats: 4,
    players: [0, 1, 2, 3].map((seat) => ({ seat, who: `p${ seat }`, timeouts: 0, ...(worn[seat] === undefined ? {} : { look: worn[seat] }) })) as MatchView['players'],
    turn: 1,
    ...(mine === null ? {} : { mine }),
    startedAt: new Date(400_000).toISOString(),
    remainingMs: 20_000,
    view: {
        kind: 'hokm',
        phase: 'tricks',
        trump: 'spades',
        hakem: 0,
        dealer: 3,
        turn: 1,
        lead: 1,
        hand: mine === null ? [] : [40, 41],
        plays: [],
        trick: [],
        seats: five(),
        points: [0, 0],
        target: 7,
        round: 1,
        needed: 7,
        full: 13,
        ...view
    }
});

const at = (left: number, top: number, width: number, height: number) => ({ x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON: () => ({}) }) as DOMRect;

const boxes = (place: (element: Element) => DOMRect | null) =>
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element)
    {
        return place(this) ?? at(0, 0, 0, 0);
    });

const pointer = (target: Element, type: string, x: number, y: number, more: PointerEventInit = {}) =>
    target.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, pointerId: 7, ...more }));

const inAir = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('.board-flight > .flight')];

const settled = () => new Promise((resolve) => setTimeout(resolve, 30));

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(400_000), seed: 3 });
    useLocale().setLocale('en');
    useDevice().overrideCoarse(false);
    engine.made = 0;
    engine.hosts = [];
    engine.quiet = [];
    engine.bursts = [];
    engine.disposed = 0;
});

afterEach(() =>
{
    cleanup();
    useDevice().overrideCoarse(null);
    vi.restoreAllMocks();
});

describe('hokm cards in the look their owner chose', () =>
{
    const backsOf = (container: HTMLElement) => [0, 1, 2, 3].map((seat) => container.querySelector<HTMLElement>(`.hokm-seat[data-seat="${ seat }"]`)?.dataset.backs ?? null);

    it('backs each seat in its own look, the reader\'s hand in their faces, and nothing in a look this build does not draw', async () =>
    {
        const { container } = await mounted(table());

        expect(backsOf(container)).toEqual([null, 'gold', null, null]);
        expect(container.querySelector<HTMLElement>('.hokm-hands')?.dataset.faces).toBe('glow');
        expect(container.querySelector('[data-faces="ember"], [data-backs="ember"]'), 'a look nothing draws was named on the table').toBeNull();
        expect(container.querySelector('.hokm-seat[data-seat="1"] .hokm-pile .card-back')?.closest('[data-backs]')?.getAttribute('data-backs'), 'the pile beside a seat is not in its backs').toBe('gold');
    });

    it('lays each card on the felt in the faces of whoever laid it', async () =>
    {
        const { container } = await mounted(table({ trick: [12, 13], lead: 1, turn: 3 }));
        const faces = (at: number) => container.querySelector<HTMLElement>(`.hokm-trick[data-card="${ at }"]`)?.dataset.faces ?? null;

        expect([faces(12), faces(13)]).toEqual(['neon', null]);
    });

    it('keeps every node it dressed when the same game is read again, and dresses a new game in its own looks', async () =>
    {
        const { container, read, match } = await mounted(table());
        const seat = container.querySelector('.hokm-seat[data-seat="1"]');
        const hands = container.querySelector('.hokm-hands');

        read(match());
        await flush();

        expect(container.querySelector('.hokm-seat[data-seat="1"]'), 'a seat was drawn again for a read that changed nothing').toBe(seat);
        expect(container.querySelector('.hokm-hands')).toBe(hands);
        expect(backsOf(container)).toEqual([null, 'gold', null, null]);

        read({ ...table({}, 0, { 1: { back: 'back.neon' }, 3: { back: 'back.shiraz' } }), id: 'match-2' });
        await flush();

        expect(backsOf(container), 'a seat kept the backs of the game before').toEqual([null, 'neon', null, 'shiraz']);
        expect(container.querySelector<HTMLElement>('.hokm-hands')?.dataset.faces, 'the hand kept the faces of the game before').toBeUndefined();
    });

    it('draws a watcher every player\'s things in their look, and no hand', async () =>
    {
        const { container, send } = await mounted(table({}, null));

        expect(backsOf(container)).toEqual([null, 'gold', null, null]);
        expect(container.querySelector('.hokm-hands')).toBeNull();

        send([card(4, 1, 12)]);
        await flush();

        expect(container.querySelector<HTMLElement>('.hokm-trick[data-card="12"]')?.dataset.faces).toBe('neon');
    });
});

describe('a hokm card flying in its owner\'s look', () =>
{
    it('leaves a pile as its player\'s back and is turned over to their face, and flies plain for a look nothing draws', async () =>
    {
        const { container, send } = await mounted(table());

        send([card(4, 1, 12)]);
        await flush();

        const [theirs] = inAir(container);

        expect([theirs?.dataset.backs, theirs?.dataset.faces]).toEqual(['gold', 'neon']);
        expect(theirs?.querySelector('.card-back')?.closest('[data-backs]'), 'the back in the air is not in the look the box carries').toBe(theirs);

        await elapse(TIMING.FLY_THEIRS);
        send([card(5, 2, 13)]);
        await flush();

        const [plain] = inAir(container);

        expect([plain?.hasAttribute('data-backs'), plain?.hasAttribute('data-faces')]).toEqual([false, false]);
    });

    it('flies the reader\'s own card in their faces to the felt, and back to the hand when it is refused', async () =>
    {
        let answer: (outcome: 'stale') => void = () => undefined;

        vi.spyOn(useBoard(), 'play').mockReturnValue(new Promise((resolve) =>
        {
            answer = resolve;
        }));
        boxes((element) => (element.classList.contains('hokm-trick') ? at(200, 200, 44, 60) : null));

        const { container } = await mounted(table({ turn: 0, lead: 0, plays: [40, 41] }));

        fire(container.querySelector<HTMLButtonElement>('.card-hold[data-card="40"]')!, 'click');

        expect(inAir(container).map((one) => one.dataset.faces), 'the card left the hand plain').toEqual(['glow']);

        await elapse(TIMING.FLY + 20);
        answer('stale');
        await flush();

        expect(inAir(container).map((one) => one.dataset.faces), 'the refused card came back plain').toEqual(['glow']);
    });

    it('deals every packet in the backs of the seat it is dealt to, and keeps the deck the house\'s', async () =>
    {
        const animate = vi.spyOn(Element.prototype, 'animate');
        const naming = table({ phase: 'trump', trump: undefined, turn: 0, lead: 0, hand: [], seats: [0, 1, 2, 3].map((seat) => ({ seat, side: seat % 2, held: seat === 0 ? 5 : 0, tricks: 0, out: false })) }, 1, { 1: { back: 'back.gold' }, 2: { back: 'back.neon' }, 3: { face: 'face.shiraz' } });
        const { container, send } = await mounted(naming);

        expect(container.querySelector('.hokm-deck')?.closest('[data-backs]'), 'the deck was put in somebody\'s backs').toBeNull();

        send([act(4, 0, { e: 'trump', seat: 0, suit: 'spades' })], { hand: [1, 4, 9, 14, 17, 22, 27, 30, 35, 40, 43, 47, 50], plays: [] });
        await elapse(LONG, 5);

        const packets = [...new Set(animate.mock.contexts.map((one) => (one as Element).closest('.flight.stack')).filter((one): one is HTMLElement => one !== null))];
        const counted = (worn: string | undefined) => packets.filter((one) => one.dataset.backs === worn).length;

        expect(packets.length, 'the deal is not eleven packets').toBe(11);
        expect([counted('gold'), counted('neon'), counted(undefined)], 'a packet was not in the backs of the seat it went to').toEqual([3, 3, 5]);
    });
});

describe('the signature where a hokm card in a look is laid', () =>
{
    const trick = () => boxes((element) => (element.classList.contains('hokm-trick') ? at(200, 200, 60, 85) : null));

    it('plays its faces\' collection\'s signature where it lands, sized to the card, and nothing while it is in the air', async () =>
    {
        trick();

        const { send } = await mounted(table());

        send([card(4, 1, 12)]);
        await flush();
        await vi.waitFor(() => expect(engine.made, 'the engine was not readied as the card left').toBe(1));
        await elapse(TIMING.FLY_THEIRS - 10);

        expect(engine.bursts, 'the burst played while the card was in the air').toEqual([]);

        await elapse(10);
        await vi.waitFor(() => expect(engine.bursts).toHaveLength(1));

        const [landing] = engine.bursts;

        expect(landing!.steps, 'the card did not play its collection\'s signature').toBe(playAt('neon', at(0, 0, 60, 85)).steps);
        expect(landing!.at).toEqual({ x: 230, y: 242.5 });
        expect(landing!.tune.colors).toEqual(lightOf('neon'));
        expect(landing!.tune.scale).toBeCloseTo(60 / 40);
    });

    it('plays the reader\'s own in their faces\' collection', async () =>
    {
        trick();
        vi.spyOn(useBoard(), 'play').mockReturnValue(new Promise(() => undefined));

        const { container } = await mounted(table({ turn: 0, lead: 0, plays: [40, 41] }));

        fire(container.querySelector<HTMLButtonElement>('.card-hold[data-card="40"]')!, 'click');
        await elapse(TIMING.FLY + 10);
        await vi.waitFor(() => expect(engine.bursts.map((one) => one.preset)).toEqual(['pulse']));

        expect(engine.bursts[0]!.steps).toBe(playAt('glow', at(0, 0, 60, 85)).steps);
        expect(engine.bursts[0]!.tune.colors).toEqual(lightOf('glow'));
    });

    it('plays a legendary collection\'s own signature, in its own light', async () =>
    {
        trick();

        const { send } = await mounted(table({}, 0, { 1: { face: 'face.void' } }));

        send([card(4, 1, 12)]);
        await elapse(TIMING.FLY_THEIRS);
        await vi.waitFor(() => expect(engine.bursts.map((one) => one.preset)).toEqual(['implosion']));

        expect(engine.bursts[0]!.steps!.map((one) => one.effect)).toEqual(['implosion', 'release']);
        expect(engine.bursts[0]!.tune.colors).toEqual(lightOf('void'));
    });

    it('fetches nothing and plays nothing for a card in Classic or in a look nothing draws', async () =>
    {
        trick();

        const { send } = await mounted(table({}, 0, { 0: { face: 'face.glow' }, 2: { face: 'face.ember' } }));

        send([card(4, 1, 12)]);
        await elapse(TIMING.FLY_THEIRS);
        send([card(5, 2, 13)]);
        await elapse(TIMING.FLY_THEIRS);
        await settled();

        expect([engine.made, engine.bursts.length]).toEqual([0, 0]);
    });

    it('asks the reader\'s wish for less motion, and is let go with the board', async () =>
    {
        trick();

        const { send } = await mounted(table());

        send([card(4, 1, 12)]);
        await flush();
        await vi.waitFor(() => expect(engine.made).toBe(1));

        const reduced = vi.spyOn(useDevice(), 'reducedMotion').mockReturnValue(true);

        expect(engine.quiet[0]!()).toBe(true);

        reduced.mockReturnValue(false);

        expect(engine.quiet[0]!()).toBe(false);

        cleanup();

        expect(engine.disposed, 'the engine outlived its board').toBe(1);
    });

    it('draws under every card on the felt, in a layer the table keeps when it starts again', async () =>
    {
        trick();

        const { container, send, read } = await mounted(table());

        send([card(4, 1, 12)]);
        await flush();
        await vi.waitFor(() => expect(engine.made).toBe(1));

        const [host] = engine.hosts;
        const canvas = document.createElement('canvas');
        const left = document.createElement('span');

        host!.append(canvas);
        container.querySelector('.board-flight')?.append(left);

        expect(host!.classList.contains('hokm-burst')).toBe(true);
        expect(host!.parentElement?.classList.contains('hokm-table'), 'the bursts are not drawn on the felt').toBe(true);
        expect(host!.previousElementSibling?.classList.contains('felt-mats'), 'something on the felt but the mats lies under the bursts').toBe(true);
        expect(host!.parentElement?.firstElementChild?.classList.contains('felt-mats'), 'something on the felt lies under the mats').toBe(true);

        await elapse(TIMING.FLY_THEIRS);
        read({ ...table({}, 0, { 1: { face: 'face.gold' } }), id: 'match-2' });
        await elapse(TIMING.FLY_THEIRS);

        expect(left.isConnected, 'the new game did not start the table again').toBe(false);
        expect(canvas.isConnected, 'starting again took away what the bursts are drawn on').toBe(true);

        send([card(4, 1, 13)]);
        await elapse(TIMING.FLY_THEIRS);
        await vi.waitFor(() => expect(engine.bursts.map((one) => one.preset)).toEqual(['sparks', 'burst']));

        expect(engine.hosts.every((one) => one.isConnected), 'a burst was drawn on a felt that is gone').toBe(true);
    });
});

describe('a card of the reader\'s hand leaning toward the pointer', () =>
{
    const hold = (container: HTMLElement) => container.querySelector<HTMLElement>('.card-hold[data-card="40"]')!;

    const leaning = (container: HTMLElement) => [hold(container).style.getPropertyValue('--hx'), hold(container).style.getPropertyValue('--hy')];

    beforeEach(() =>
    {
        boxes((element) => (element.classList.contains('card-hold') ? at(100, 400, 60, 84) : null));
    });

    it('follows a mouse across the card, and lets go when it leaves', async () =>
    {
        const { container } = await mounted(table());

        pointer(hold(container), 'pointermove', 145, 421, { pointerType: 'mouse' });

        expect(leaning(container)).toEqual(['0.750', '0.250']);

        pointer(hold(container), 'pointermove', 115, 463, { pointerType: 'mouse' });

        expect(leaning(container)).toEqual(['0.250', '0.750']);

        hold(container).dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse', pointerId: 7 }));

        expect(leaning(container), 'the card went on leaning after the pointer had left').toEqual(['', '']);
    });

    it('leans for no finger, and for no card in Classic', async () =>
    {
        const worn = await mounted(table());

        pointer(hold(worn.container), 'pointermove', 145, 421, { pointerType: 'touch' });

        expect(leaning(worn.container)).toEqual(['', '']);

        cleanup();

        const plain = await mounted(table({}, 0, {}));

        pointer(hold(plain.container), 'pointermove', 145, 421, { pointerType: 'mouse' });

        expect(leaning(plain.container)).toEqual(['', '']);
    });
});

describe('the felt in front of each hokm seat', () =>
{
    const FELTS: Record<number, Look> = { 0: { felt: 'felt.inferno' }, 2: { felt: 'felt.ember' }, 3: { felt: 'felt.frost', back: 'back.gold' } };

    const mats = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('.felt-mats > .felt-mat')];

    const worn = (container: HTMLElement) => mats(container).map((mat) => [mat.dataset.seat, mat.dataset.mat]);

    it('lays a mat on the side of each seat that wears a felt, and none for Classic or a look this build does not draw', async () =>
    {
        const { container } = await mounted(table({}, 0, FELTS));

        expect(worn(container)).toEqual([['0', 'inferno'], ['3', 'frost']]);
        expect(mats(container)[0]?.dataset.side, 'the reader\'s mat is not at the foot of the table').toBe('bottom');

        for (const mat of mats(container))
        {
            expect(mat.dataset.side, 'a mat lay on another side than its seat').toBe(container.querySelector<HTMLElement>(`.hokm-seat[data-seat="${ mat.dataset.seat }"]`)?.dataset.side);
        }

        expect(container.querySelector('.felt-mats')?.getAttribute('aria-hidden')).toBe('true');
        expect(container.querySelector('.felt-mats')?.nextElementSibling?.classList.contains('hokm-burst'), 'the mats are not under the bursts').toBe(true);
    });

    it('lights the mat of the seat on turn and no other', async () =>
    {
        const lit = async (turn: number) =>
        {
            cleanup();

            const { container } = await mounted(table({ turn, lead: turn }, 0, FELTS));

            return mats(container).filter((mat) => mat.dataset.turn === 'true').map((mat) => mat.dataset.seat);
        };

        expect(await lit(3)).toEqual(['3']);
        expect(await lit(0)).toEqual(['0']);
        expect(await lit(1), 'a mat was lit for a seat whose turn it is not').toEqual([]);
    });

    it('keeps each mat through a read that changes nothing, and lays a new game\'s in its own felts', async () =>
    {
        const { container, read, match } = await mounted(table({}, 0, FELTS));
        const [first] = mats(container);

        read(match());
        await flush();

        expect(mats(container)[0], 'a mat was drawn again for a read that changed nothing').toBe(first);

        read({ ...table({}, 0, { 1: { felt: 'felt.gold' }, 3: { felt: 'felt.oni' } }), id: 'match-2' });
        await flush();

        expect(worn(container), 'a seat kept the felt of the game before').toEqual([['1', 'gold'], ['3', 'oni']]);
    });

    it('lays every player\'s mat for somebody watching', async () =>
    {
        const { container } = await mounted(table({}, null, FELTS));

        expect(worn(container)).toEqual([['0', 'inferno'], ['3', 'frost']]);
    });
});

describe('a hokm winner\'s celebration in the look they chose', () =>
{
    const cheersOf = () => engine.bursts.filter((one) => Object.values(CELEBRATIONS).some((steps) => one.steps === steps));

    const seats = () => boxes((element) => (element.matches('.hokm-seat[data-seat="0"]') ? at(100, 400, 120, 120) : element.matches('.hokm-seat[data-seat="2"]') ? at(100, 0, 120, 120) : null));

    const ended = { finishedAt: new Date(401_000).toISOString() };

    it('rises from each winner\'s seat in its light, sized to the seat, and from no seat that lost', async () =>
    {
        seats();

        const { send } = await mounted(table({}, 0, { 0: { celebration: 'celebration.phoenix' }, 1: { celebration: 'celebration.oni' }, 2: { celebration: 'celebration.jade' } }));

        send([act(4, 1, { e: 'forfeit', seat: 1 }, { e: 'finish', side: 0 })], {}, ended);
        await elapse(LONG, 20);
        await vi.waitFor(() => expect(cheersOf()).toHaveLength(2));

        const [first, second] = cheersOf();

        expect(first!.steps).toBe(CELEBRATIONS.phoenix);
        expect(first!.at).toEqual({ x: 160, y: 460 });
        expect(first!.tune.colors).toEqual(lightOf('phoenix'));
        expect(first!.tune.scale).toBe(3);
        expect(second!.steps, 'a partner on the winning side did not celebrate').toBe(CELEBRATIONS.jade);
        expect(second!.at).toEqual({ x: 160, y: 60 });
    });

    it('rises from no seat that wears none, and fetches no engine for it', async () =>
    {
        seats();

        const { send } = await mounted(table({}, 0, { 1: { celebration: 'celebration.oni' } }));

        send([act(4, 1, { e: 'forfeit', seat: 1 }, { e: 'finish', side: 0 })], {}, ended);
        await elapse(LONG, 20);
        await settled();

        expect(cheersOf()).toEqual([]);
        expect(engine.made, 'an engine was fetched to celebrate nothing').toBe(0);
    });
});
