import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fire } from '@azerothjs/testing';

import { playAt } from '../src/game/looks/cards.ts';
import { CELEBRATIONS } from '../src/game/looks/celebrations.ts';
import { ENTER_MOST } from '../src/game/looks/entrances.ts';
import { lightOf } from '../src/game/looks/table.ts';
import { CARD_FLY, CARD_GAP, CHIP_FLY, DISC_GAP, GATHER, GATHER_GAP, MUCK, MUCK_GAP, TURN } from '../src/game/poker-beats.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useDevice } from '../src/stores/device.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useBoard, type EventBatch } from '../src/stores/match.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import type { MatchView } from '../src/api.ts';
import { BLINDS, EVERYBODY, elapse, flown, heard, match, places, rows, seated, told, turns } from './poker-mounted.ts';

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

const LONG = 12000;

const folded = { folded: true };

const dressedAs = (worn: Record<number, Look>) => match().players.map((player) => (worn[player.seat] === undefined ? player : { ...player, look: worn[player.seat] }));

const looked = (view: Parameters<typeof match>[0] = {}, more: Partial<MatchView> = {}, worn = WORN) => match(view, { ...more, players: dressedAs(worn) });

const river = (worn = WORN) => looked(
    {
        street: 'river',
        board: [1, 15, 29, 43, 8],
        turn: 2,
        pot: 250,
        pots: [{ amount: 250, eligible: [1, 2] }],
        hole: [],
        seats: rows({ 0: folded, 1: { stack: 1360, bet: 60 }, 2: { stack: 1420 }, 3: { stack: 1490, ...folded }, 4: { stack: 1480, ...folded }, 5: folded })
    },
    { turn: 2 },
    worn
);

const shown = (worn = WORN) => looked(
    {
        hand: 2,
        button: 3,
        turn: 1,
        hole: [4, 17],
        blinds: { small: 10, big: 20, level: 1, next: 9 },
        seats: rows({ 0: { stack: 1500 }, 1: { stack: 1360 }, 2: { stack: 1670 }, 3: { stack: 1490 }, 4: { stack: 1470, bet: 10 }, 5: { stack: 1480, bet: 20 } })
    },
    { rev: 8, turn: 1 },
    worn
);

const tabled = heard(1, told(
    8,
    2,
    { e: 'call', seat: 2, amount: 60 },
    { e: 'show', seat: 1, cards: [5, 18], category: 'pair' },
    { e: 'show', seat: 2, cards: [7, 20], category: 'two-pair' },
    { e: 'pot', amount: 310, winners: [2] },
    { e: 'end', hand: 1, dealt: EVERYBODY },
    { e: 'deal', hand: 2, button: 3, small: 10, big: 20 },
    { e: 'blind', seat: 4, amount: 10 },
    { e: 'blind', seat: 5, amount: 20 }
));

const opening = (): EventBatch => ({
    ...heard(1, told(1, 0, { e: 'deal', hand: 1, button: 2, small: 10, big: 20 }, { e: 'blind', seat: 3, amount: 10 }, { e: 'blind', seat: 4, amount: 20 })),
    opens: () => true
});

const SHOWN = CHIP_FLY + 2 * DISC_GAP + GATHER + 2 * DISC_GAP + GATHER_GAP;

const settled = () => new Promise((resolve) => setTimeout(resolve, 30));

const everyFlight = (animate: { mock: { contexts: unknown[] } }) =>
    [...new Set(animate.mock.contexts.map((one) => (one as Element).closest('.flight')).filter((one): one is HTMLElement => one !== null))];

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(400_000), seed: 3 });
    useLocale().setLocale('en');
    useSettings().reset();
    places();
    engine.made = 0;
    engine.hosts = [];
    engine.quiet = [];
    engine.bursts = [];
    engine.disposed = 0;
});

afterEach(() =>
{
    cleanup();
    vi.restoreAllMocks();
});

describe('poker cards in the look their owner chose', () =>
{
    const seatsOf = (container: HTMLElement) => [0, 1, 2, 3].map((seat) =>
    {
        const place = container.querySelector<HTMLElement>(`.poker-seat[data-seat="${ seat }"]`);

        return [place?.dataset.backs ?? null, place?.dataset.faces ?? null];
    });

    it('dresses each seat in its own backs and faces, the reader\'s two cards in theirs, and nothing in a look this build does not draw', async () =>
    {
        const { container } = await seated(looked());

        expect(seatsOf(container)).toEqual([[null, 'glow'], ['gold', 'neon'], [null, null], [null, null]]);
        expect(container.querySelector<HTMLElement>('.poker-hole')?.dataset.faces).toBe('glow');
        expect(container.querySelector('.poker-seat[data-seat="1"] .poker-backs .card-back')?.closest('[data-backs]')?.getAttribute('data-backs')).toBe('gold');
        expect(container.querySelector('[data-faces="ember"], [data-backs="ember"]'), 'a look nothing draws was named on the table').toBeNull();
        expect(container.querySelector('.poker-board')?.closest('[data-faces], [data-backs]'), 'the board was put in somebody\'s look').toBeNull();
    });

    it('draws a watcher every seat in its look and no cards of their own', async () =>
    {
        const { container } = await seated({ ...looked(), mine: undefined });

        expect(seatsOf(container)).toEqual([[null, 'glow'], ['gold', 'neon'], [null, null], [null, null]]);
        expect(container.querySelector<HTMLElement>('.poker-hole')?.dataset.faces).toBeUndefined();
    });

    it('deals every card in the look of the seat it is dealt to', async () =>
    {
        const animate = vi.spyOn(Element.prototype, 'animate');

        await seated(looked({}, { rev: 1 }), opening());
        await elapse(LONG);

        const cards = everyFlight(animate);
        const backed = (worn: string | undefined) => cards.filter((one) => one.dataset.backs === worn).length;

        expect(backed('gold'), 'a card dealt to the seat in gold backs flew in another back').toBe(2);
        expect(cards.filter((one) => one.dataset.faces === 'glow').length, 'the reader\'s two cards did not come in their faces').toBe(4);
        expect(backed(undefined)).toBe(cards.length - 2);
    });

    it('sends a folded hand to the dealer in its owner\'s backs', async () =>
    {
        const { container, read } = await seated(looked());

        await read(looked({ turn: 2, seats: rows({ ...BLINDS, 1: folded }) }, { rev: 8, turn: 2 }), heard(1, told(8, 1, { e: 'fold', seat: 1, amount: 0 })));

        const [pile] = flown(container);

        expect([pile?.classList.contains('stack'), pile?.dataset.backs]).toEqual([true, 'gold']);

        await elapse(MUCK);
    });

    it('turns the reader\'s cards down and back in their faces when the server will not have the fold', async () =>
    {
        let answer: (outcome: 'failed') => void = () => undefined;

        vi.spyOn(useBoard(), 'play').mockReturnValue(new Promise((resolve) =>
        {
            answer = resolve;
        }));

        const { container } = await seated(looked({ turn: 0, toCall: 20, minRaiseTo: 40, maxRaiseTo: 1500 }, { turn: 0 }));

        fire([...container.querySelectorAll('button')].find((one) => one.textContent?.trim() === 'Fold')!, 'click');

        expect(flown(container).map((one) => one.dataset.faces), 'the cards went face down plain').toEqual(['glow', 'glow']);

        await elapse(TURN + MUCK + MUCK_GAP);
        answer('failed');
        await turns();

        expect(flown(container).map((one) => one.dataset.faces), 'the cards came back plain').toEqual(['glow', 'glow']);

        await elapse(CARD_FLY + MUCK_GAP);
    });
});

describe('a hand in a look shown at the end', () =>
{
    it('is turned over in its owner\'s faces from their backs, and bursts in their collection where each card is laid', async () =>
    {
        const animate = vi.spyOn(Element.prototype, 'animate');
        const placed = vi.mocked(Element.prototype.getBoundingClientRect).getMockImplementation()!;

        vi.mocked(Element.prototype.getBoundingClientRect).mockImplementation(function (this: Element)
        {
            return this.classList.contains('poker-burst') ? DOMRect.fromRect({ x: 10, y: 20, width: 380, height: 760 }) : placed.call(this);
        });

        const { container, read } = await seated(river());

        await read(shown(), tabled);
        await elapse(SHOWN);

        const turning = flown(container);

        expect(turning.map((one) => [one.dataset.backs, one.dataset.faces]), 'the first hand turned over is not in its owner\'s look').toEqual([['gold', 'neon'], ['gold', 'neon']]);
        await vi.waitFor(() => expect(engine.made).toBe(1));

        expect(engine.bursts, 'a card burst before it was face up').toEqual([]);

        await elapse(TURN + CARD_GAP);
        await vi.waitFor(() => expect(engine.bursts).toHaveLength(2));

        expect(engine.bursts.map((one) => one.steps), 'a card laid did not play its collection\'s signature').toEqual([0, 1].map(() => playAt('neon', { x: 0, y: 0, width: 20, height: 28 }).steps));
        expect(engine.bursts.map((one) => one.at), 'a card burst away from where it was laid on the felt').toEqual([{ x: 86, y: 544 }, { x: 100, y: 544 }]);
        expect(engine.bursts[0]!.tune.colors).toEqual(lightOf('neon'));
        expect(engine.bursts[0]!.tune.scale).toBeCloseTo(20 / 40);

        await elapse(LONG);

        const turned = everyFlight(animate).filter((one) => one.classList.contains('turning'));

        expect(turned.map((one) => one.dataset.faces ?? null), 'a hand was turned over in another look than its owner\'s, the reader\'s next one included').toEqual(['neon', 'neon', null, null, 'glow', 'glow']);
        expect(everyFlight(animate).filter((one) => one.classList.contains('turning') === false && one.dataset.faces === 'neon' && one.querySelector('.card-face') !== null), 'the hand that was shown went back to the dealer in another look').toHaveLength(2);
        expect(everyFlight(animate).filter((one) => one.classList.contains('turning') === false && one.dataset.faces === undefined && one.querySelector('.card-face') !== null), 'the board and the hand in a look nothing draws did not go back to the dealer plain').toHaveLength(7);

        expect(engine.bursts, 'a hand in a look nothing draws burst').toHaveLength(2);
    });

    it('fetches nothing and plays nothing at a table where nobody wears a look', async () =>
    {
        const { read } = await seated(river({}));

        await read(shown({}), tabled);
        await elapse(LONG);
        await settled();

        expect([engine.made, engine.bursts.length]).toEqual([0, 0]);
    });

    it('draws on the felt under every card, asks the reader\'s wish for less motion, and is let go with the board', async () =>
    {
        const { container, read } = await seated(river());

        await read(shown(), tabled);
        await elapse(SHOWN);
        await vi.waitFor(() => expect(engine.made).toBe(1));

        const [host] = engine.hosts;

        expect(host!.classList.contains('poker-burst')).toBe(true);
        expect(host!.parentElement?.classList.contains('poker-table'), 'the bursts are not drawn on the felt').toBe(true);
        expect(host!.previousElementSibling?.classList.contains('felt-mats'), 'something on the felt but the mats lies under the bursts').toBe(true);
        expect(host!.parentElement?.firstElementChild?.classList.contains('felt-mats'), 'something on the felt lies under the mats').toBe(true);
        expect(container.contains(host!)).toBe(true);

        const reduced = vi.spyOn(useDevice(), 'reducedMotion').mockReturnValue(true);

        expect(engine.quiet[0]!()).toBe(true);

        reduced.mockReturnValue(false);
        cleanup();

        expect(engine.disposed, 'the engine outlived its board').toBe(1);
    });
});

describe('the reader\'s two cards leaning toward the pointer', () =>
{
    const at = (left: number, top: number, width: number, height: number) => ({ x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON: () => ({}) }) as DOMRect;

    const pocket = (container: HTMLElement) => container.querySelector<HTMLElement>('.poker-pocket')!;

    const leaning = (container: HTMLElement) => [pocket(container).style.getPropertyValue('--hx'), pocket(container).style.getPropertyValue('--hy')];

    const pointer = (target: Element, type: string, x: number, y: number, pointerType: string) =>
        target.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, pointerId: 7, pointerType }));

    beforeEach(() =>
    {
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element)
        {
            return this.classList.contains('poker-pocket') ? at(100, 400, 40, 56) : at(0, 0, 0, 0);
        });
    });

    it('follows a mouse across a card in a look, and lets go when it leaves', async () =>
    {
        const { container } = await seated(looked());

        pointer(pocket(container), 'pointermove', 130, 414, 'mouse');

        expect(leaning(container)).toEqual(['0.750', '0.250']);

        pocket(container).dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse', pointerId: 7 }));

        expect(leaning(container)).toEqual(['', '']);
    });

    it('leans for no finger, and for no card in Classic', async () =>
    {
        const worn = await seated(looked());

        pointer(pocket(worn.container), 'pointermove', 130, 414, 'touch');

        expect(leaning(worn.container)).toEqual(['', '']);

        cleanup();

        const plain = await seated(looked({}, {}, {}));

        pointer(pocket(plain.container), 'pointermove', 130, 414, 'mouse');

        expect(leaning(plain.container)).toEqual(['', '']);
    });
});

describe('the felt in front of each poker seat', () =>
{
    const FELTS: Record<number, Look> = { 1: { felt: 'felt.jade' }, 2: { felt: 'felt.ember' }, 4: { felt: 'felt.storm', face: 'face.neon' } };

    const mats = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('.felt-mats > .felt-mat')];

    const worn = (container: HTMLElement) => mats(container).map((mat) => [mat.dataset.seat, mat.dataset.mat]);

    it('lays a mat where the plate of each seat that wears a felt is placed, and none for Classic or a look this build does not draw', async () =>
    {
        const { container } = await seated(looked({}, {}, FELTS));

        expect(worn(container)).toEqual([['1', 'jade'], ['4', 'storm']]);

        for (const mat of mats(container))
        {
            const seat = container.querySelector<HTMLElement>(`.poker-seat[data-seat="${ mat.dataset.seat }"]`);

            expect(mat.style.getPropertyValue('--x'), 'a mat lay away from its seat').toBe(seat?.style.getPropertyValue('--x'));
            expect(mat.style.getPropertyValue('--y'), 'a mat lay away from its seat').toBe(seat?.style.getPropertyValue('--y'));
        }

        expect(container.querySelector('.felt-mats')?.getAttribute('aria-hidden')).toBe('true');
        expect(container.querySelector('.felt-mats')?.nextElementSibling?.classList.contains('poker-burst'), 'the mats are not under the bursts').toBe(true);
    });

    it('lights the mat of the seat on turn, and none once the game is over', async () =>
    {
        const lit = (container: HTMLElement) => mats(container).filter((mat) => mat.dataset.turn === 'true').map((mat) => mat.dataset.seat);
        const playing = await seated(looked({ turn: 4 }, { turn: 4 }, FELTS));

        expect(lit(playing.container)).toEqual(['4']);

        cleanup();

        const another = await seated(looked({ turn: 2 }, { turn: 2 }, FELTS));

        expect(lit(another.container), 'a mat was lit for a seat whose turn it is not').toEqual([]);

        cleanup();

        const over = await seated(looked({ turn: 4 }, { turn: 4, finishedAt: new Date(500_000).toISOString() }, FELTS));

        expect(lit(over.container), 'a mat was lit after the game ended').toEqual([]);
    });

    it('keeps each mat through a read that changes nothing, and lays a new game\'s in its own felts', async () =>
    {
        const { container, read } = await seated(looked({}, {}, FELTS));
        const [first] = mats(container);

        await read(looked({}, {}, FELTS));

        expect(mats(container)[0], 'a mat was drawn again for a read that changed nothing').toBe(first);

        await read({ ...looked({}, {}, { 2: { felt: 'felt.gold' }, 4: { felt: 'felt.oni' } }), id: 'match-2' });

        expect(worn(container), 'a seat kept the felt of the game before').toEqual([['2', 'gold'], ['4', 'oni']]);
    });

    it('lays every player\'s mat for somebody watching', async () =>
    {
        const { container } = await seated({ ...looked({}, {}, FELTS), mine: undefined });

        expect(worn(container)).toEqual([['1', 'jade'], ['4', 'storm']]);
    });
});

describe('the chips of each poker seat', () =>
{
    const CHIPS: Record<number, Look> = { 1: { chips: 'chips.inferno' }, 2: { chips: 'chips.ember' }, 4: { chips: 'chips.oni', face: 'face.neon' } };

    const discsIn = (animate: { mock: { contexts: unknown[] } }) => everyFlight(animate).filter((one) => one.classList.contains('chip-stack'));

    it('dresses each seat in its chips, the bet in front of it with them, and nothing in Classic, in a look nothing draws or in the pot', async () =>
    {
        const { container } = await seated(looked({ seats: rows({ 1: { stack: 1480, bet: 20 }, 4: { stack: 1490, bet: 10 } }) }, {}, CHIPS));
        const worn = [0, 1, 2, 3, 4, 5].map((seat) => container.querySelector<HTMLElement>(`.poker-seat[data-seat="${ seat }"]`)?.dataset.chips ?? null);

        expect(worn).toEqual([null, 'inferno', null, null, 'oni', null]);
        expect(container.querySelector('.poker-seat[data-seat="1"] .poker-bet > .chip-stack')?.closest('[data-chips]')?.getAttribute('data-chips'), 'a bet is not in the chips of the seat it lies in front of').toBe('inferno');
        expect(container.querySelector('.poker-pot > .chip-stack')?.closest('[data-chips]'), 'the pot was put in somebody\'s chips').toBeNull();
        expect(container.querySelector('[data-chips="ember"]'), 'a look nothing draws was named on the table').toBeNull();
    });

    it('pours each blind in the chips of the seat that puts it in, and in none for a seat in Classic', async () =>
    {
        const animate = vi.spyOn(Element.prototype, 'animate');

        await seated(looked({}, { rev: 1 }, { 4: { chips: 'chips.oni' } }), opening());
        await elapse(LONG);

        const discs = discsIn(animate);

        expect(discs.length, 'no chips flew').toBeGreaterThan(0);
        expect(new Set(discs.map((one) => one.dataset.chips ?? null)), 'the blinds did not fly, one in its seat\'s chips and one plain').toEqual(new Set(['oni', null]));
    });

    it('gathers each bet to the pot in its seat\'s chips, and pays the pot out in the house\'s', async () =>
    {
        const animate = vi.spyOn(Element.prototype, 'animate');
        const worn: Record<number, Look> = { 1: { chips: 'chips.jade' }, 2: { chips: 'chips.storm' }, 4: { chips: 'chips.oni' }, 5: { chips: 'chips.gold' } };
        const { read } = await seated(river(worn));

        await read(shown(worn), tabled);
        await elapse(LONG);

        const discs = discsIn(animate);
        const dressed = new Set(discs.map((one) => one.dataset.chips ?? null));

        expect(dressed.has('jade'), 'the bet gathered from seat 1 was not in its chips').toBe(true);
        expect(dressed.has('storm'), 'the call and the bet gathered from seat 2 were not in its chips').toBe(true);
        expect(dressed.has('oni') && dressed.has('gold'), 'the next hand\'s blinds were not in their seats\' chips').toBe(true);
        expect(discs.filter((one) => one.dataset.chips === undefined).length, 'the pot paid out in somebody\'s chips').toBeGreaterThan(0);
    });

    it('pours a bet nobody could call back to its seat in its chips', async () =>
    {
        const animate = vi.spyOn(Element.prototype, 'animate');
        const worn: Record<number, Look> = { 1: { chips: 'chips.jade' } };
        const shoved = looked(
            {
                turn: 2,
                pot: 1530,
                pots: [{ amount: 1530, eligible: [1, 2] }],
                hole: [],
                seats: rows({ 0: folded, 1: { stack: 0, bet: 1500, allIn: true }, 2: { stack: 1000 }, 3: { stack: 1490, bet: 10, ...folded }, 4: { stack: 1480, bet: 20, ...folded }, 5: folded })
            },
            { turn: 2 },
            worn
        );
        const next = looked(
            {
                hand: 2,
                button: 3,
                turn: 1,
                hole: [4, 17],
                blinds: { small: 10, big: 20, level: 1, next: 9 },
                seats: rows({ 0: { stack: 1500 }, 1: { stack: 500 }, 2: { stack: 2030 }, 3: { stack: 1490 }, 4: { stack: 1470, bet: 10 }, 5: { stack: 1480, bet: 20 } })
            },
            { rev: 8, turn: 1 },
            worn
        );
        const { read } = await seated(shoved);

        await read(next, heard(1, told(
            8,
            2,
            { e: 'allin', seat: 2, amount: 1000 },
            { e: 'board', street: 'flop', cards: [1, 15, 29] },
            { e: 'board', street: 'turn', cards: [43] },
            { e: 'board', street: 'river', cards: [8] },
            { e: 'refund', seat: 1, amount: 500 },
            { e: 'show', seat: 1, cards: [5, 18], category: 'pair' },
            { e: 'show', seat: 2, cards: [7, 20], category: 'two-pair' },
            { e: 'pot', amount: 2030, winners: [2] },
            { e: 'end', hand: 1, dealt: EVERYBODY },
            { e: 'deal', hand: 2, button: 3, small: 10, big: 20 },
            { e: 'blind', seat: 4, amount: 10 },
            { e: 'blind', seat: 5, amount: 20 }
        )));
        await elapse(LONG);

        const back = discsIn(animate).filter((one) => one.style.left === '135px' && one.style.top === '615px');

        expect(back.length, 'nothing went back to seat 1').toBeGreaterThan(0);
        expect(back.map((one) => one.dataset.chips ?? null), 'the chips nobody called went back in another look').toEqual(back.map(() => 'jade'));
    });

    it('racks a stack that walks out off the felt in its seat\'s chips', async () =>
    {
        const animate = vi.spyOn(Element.prototype, 'animate');
        const worn: Record<number, Look> = { 5: { chips: 'chips.gold' } };
        const { read } = await seated(looked({}, {}, worn));

        await read(looked({ seats: rows({ ...BLINDS, 5: { stack: 0, out: true } }) }, { rev: 8 }, worn), heard(1, told(8, 5, { e: 'forfeit', seat: 5, reason: 'left', place: 6 })));
        await elapse(LONG);

        const discs = discsIn(animate);

        expect(discs.length, 'no stack was racked off').toBeGreaterThan(0);
        expect(new Set(discs.map((one) => one.dataset.chips ?? null)), 'a stack walked off the felt in another look').toEqual(new Set(['gold']));
    });
});

describe('a poker winner\'s celebration in the look they chose', () =>
{
    const cheersOf = () => engine.bursts.filter((one) => Object.values(CELEBRATIONS).some((steps) => one.steps === steps));

    const gone = { 2: { stack: 0, out: true }, 3: { stack: 0, out: true }, 4: { stack: 0, out: true }, 5: { stack: 0, out: true } };

    const dressed = (view: MatchView, worn: Record<number, Look>) => ({ ...view, players: view.players.map((player) => (worn[player.seat] === undefined ? player : { ...player, look: worn[player.seat] })) }) as MatchView;

    const won = async (worn: Record<number, Look>) =>
    {
        const placed = vi.mocked(Element.prototype.getBoundingClientRect).getMockImplementation()!;

        vi.mocked(Element.prototype.getBoundingClientRect).mockImplementation(function (this: Element)
        {
            if (this.classList.contains('poker-burst'))
            {
                return DOMRect.fromRect({ x: 10, y: 20, width: 380, height: 760 });
            }

            return this.matches('.poker-seat[data-seat="0"]') ? DOMRect.fromRect({ x: 150, y: 600, width: 100, height: 60 }) : placed.call(this);
        });

        const before = dressed(match({ button: 0, turn: 1, pots: [{ amount: 30, eligible: [0, 1] }], seats: rows({ ...gone, 0: { stack: 4490, bet: 10 }, 1: { stack: 4480, bet: 20 } }) }), worn);
        const after = dressed(match(
            { button: 0, turn: undefined, pot: 0, pots: [], winner: 0, seats: rows({ ...gone, 0: { stack: 4520 }, 1: { stack: 0, out: true } }), last: { board: [], shown: [], pots: [{ amount: 30, winners: [0] }] } },
            { rev: 8, turn: undefined, finishedAt: new Date(401_000).toISOString() }
        ), worn);
        const { read } = await seated(before);

        await read(after, heard(1, told(8, 1, { e: 'forfeit', seat: 1, reason: 'left', place: 2 }, { e: 'pot', amount: 30, winners: [0] }, { e: 'end', hand: 1, dealt: [0, 1] }, { e: 'finish', seat: 0 })));
        await elapse(LONG);
    };

    it('rises from the winner\'s seat in its light, sized to the seat, and from no seat that lost', async () =>
    {
        await won({ 0: { celebration: 'celebration.phoenix' }, 1: { celebration: 'celebration.oni' } });
        await vi.waitFor(() => expect(cheersOf()).toHaveLength(1));

        const [cheered] = cheersOf();

        expect(cheered!.steps).toBe(CELEBRATIONS.phoenix);
        expect(cheered!.at).toEqual({ x: 190, y: 610 });
        expect(cheered!.tune.colors).toEqual(lightOf('phoenix'));
        expect(cheered!.tune.scale).toBeCloseTo(100 / 40);
    });

    it('rises from no seat that wears none', async () =>
    {
        await won({ 1: { celebration: 'celebration.oni' } });
        await settled();

        expect(cheersOf()).toEqual([]);
    });
});

describe('a poker seat’s entrance in the look of its felt, as a game opens', () =>
{
    const entrancesOf = () => engine.bursts.filter((one) => one.steps !== undefined && one.steps.length > 0 && Object.values(CELEBRATIONS).some((steps) => one.steps!.every((step, index) => step === steps[index])));

    const chairs = () =>
    {
        const placed = vi.mocked(Element.prototype.getBoundingClientRect).getMockImplementation()!;

        vi.mocked(Element.prototype.getBoundingClientRect).mockImplementation(function (this: Element)
        {
            if (this.classList.contains('poker-burst'))
            {
                return DOMRect.fromRect({ x: 10, y: 20, width: 380, height: 760 });
            }

            return this.matches('.poker-seat[data-seat="1"]') ? DOMRect.fromRect({ x: 150, y: 600, width: 100, height: 60 }) : placed.call(this);
        });
    };

    it('rises from each seat in a felt look as the game opens here, the first layers of its collection, every layer for a whole set', async () =>
    {
        chairs();
        await seated(looked({}, { rev: 1 }, { 1: { felt: 'felt.void' }, 2: { felt: 'felt.gold', back: 'back.gold', face: 'face.gold', chips: 'chips.gold', celebration: 'celebration.gold' } }), opening());
        await vi.waitFor(() => expect(entrancesOf()).toHaveLength(2));

        const one = entrancesOf().find((burst) => burst.steps![0] === CELEBRATIONS.void[0])!;
        const set = entrancesOf().find((burst) => burst.steps![0] === CELEBRATIONS.gold[0])!;

        expect(one.steps).toEqual(CELEBRATIONS.void.slice(0, 2));
        expect(one.at).toEqual({ x: 190, y: 610 });
        expect(one.tune.colors).toEqual(lightOf('void'));
        expect(one.tune.scale).toBeCloseTo(Math.min(ENTER_MOST, 100 / 40));
        expect(set.steps, 'a whole set was played short').toEqual(CELEBRATIONS.gold);
    });

    it('rises for nobody when a seat’s felt is Classic, or the game was already open', async () =>
    {
        await seated(looked({}, { rev: 1 }, { 1: { back: 'back.void' } }), opening());
        await settled();

        expect(entrancesOf()).toEqual([]);

        cleanup();
        engine.bursts = [];
        await seated(looked({}, { rev: 1 }, { 1: { felt: 'felt.void' } }), { ...opening(), opens: () => false });
        await settled();

        expect(entrancesOf(), 'a game already open was entered again').toEqual([]);
    });
});
