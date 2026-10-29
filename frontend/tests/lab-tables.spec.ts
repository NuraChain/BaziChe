import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { createSignal } from 'azerothjs';

import LabTables from '../src/components/shop/lab-tables.component.azeroth';
import { CELL, MARGIN } from '../src/game/layout.ts';
import { FINALES, MATE_SQUARES } from '../src/game/looks/chess.ts';
import { dieDress } from '../src/game/looks/dice.ts';
import { CRITICALS } from '../src/game/looks/table.ts';
import { ARRIVAL_CELLS, TRAILS } from '../src/game/looks/ludo.ts';
import { momentOf, retune, STAGES, type TableMoment } from '../src/game/looks/moments.ts';
import type { Collection } from '../src/game/looks/table.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import '../src/locales/shop-catalogue.ts';
import { useDevice } from '../src/stores/device.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import { forgetVoices, voices } from './fake-voices.ts';

type Rendered = HTMLElement;

interface Signed
{
    host: HTMLElement;
    steps: readonly { effect: string }[];
    scale: number | undefined;
    tune: Record<string, unknown>;
}

interface Streamed
{
    kind: string;
    at: () => { x: number; y: number } | null;
    stopped: boolean;
}

/** Every effect the stages' engines were asked for, and how each engine was made and let go. */
const engine = vi.hoisted(() => ({ made: [] as { host: HTMLElement; layer?: number; quiet?: () => boolean; quality?: string; disposed?: boolean }[], signed: [] as Signed[], streams: [] as Streamed[], disposed: 0, warmed: 0 }));

vi.mock('../src/game/vfx/lazy.ts', () => ({
    lazyVfx: (host: HTMLElement, options: { layer?: number; quiet?: () => boolean } = {}) =>
    {
        engine.made.push({ host, ...options });

        const vfx = {
            signature: (steps: readonly { effect: string }[], _at: unknown, tune: { scale?: number }) => engine.signed.push({ host, steps, scale: tune.scale, tune }),
            stream: (kind: string, at: Streamed['at']) =>
            {
                const running = { kind, at, stopped: false };

                engine.streams.push(running);

                return () =>
                {
                    running.stopped = true;
                };
            }
        };

        return {
            warm: () =>
            {
                engine.warmed += 1;
            },
            play: (effect: (one: typeof vfx) => void) =>
            {
                effect(vfx);

                return Promise.resolve();
            },
            dispose: () =>
            {
                engine.disposed += 1;
                engine.made.find((one) => one.host === host && one.disposed !== true)!.disposed = true;
            }
        };
    }
}));

vi.mock('../src/game/sound.ts', async (original) => ({
    ...await original<typeof import('../src/game/sound.ts')>(),
    createVoices: (await import('./fake-voices.ts')).createVoices
}));

/** How wide every scene is drawn, so that a moment sized to a cell or a square has a size to be measured by. */
const WIDE = 420;

/** A Ludo cell and a chess square in a scene `WIDE` pixels across. */
const LUDO_CELL = CELL / (MARGIN + 9 * CELL) * WIDE;

const CHESS_SQUARE = 112 / 556 * WIDE;

let clock: ManualClock;
let animated: { el: Element; frames: Keyframe[] }[];

/** The tables drawn, once their scenes are mounted: `mount` runs a microtask after the render. */
const tables = async (collection: Collection = 'inferno') =>
{
    const root = renderTest(() => LabTables({ collection }) as Rendered).container;

    await mounted();

    return root;
};

const mounted = async () =>
{
    for (let step = 0; step < 4; step += 1)
    {
        await Promise.resolve();
    }
};

const stage = (root: ParentNode, game: string) => root.querySelector<HTMLElement>(`[data-lab-stage="${ game }"]`)!;

const press = (root: ParentNode, game: string, words: string) =>
{
    const button = [...stage(root, game).querySelectorAll<HTMLButtonElement>('button')].find((one) => one.textContent?.trim() === words);

    expect(button, `${ game } offered no “${ words }”`).toBeDefined();
    fire(button!, 'click');
};

const said = () => voices.made[0]?.played.map((one) => one.cue) ?? [];

beforeEach(() =>
{
    resetRuntime();
    clock = manualClock(1_000);
    setRuntime({ clock, seed: 2 });
    engine.made = [];
    engine.signed = [];
    engine.streams = [];
    engine.disposed = 0;
    engine.warmed = 0;
    animated = [];
    forgetVoices();
    useSettings().reset();
    useLocale().setLocale('en');

    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(WIDE);

    const animate = Element.prototype.animate;

    vi.spyOn(Element.prototype, 'animate').mockImplementation(function (this: Element, frames: Keyframe[] | PropertyIndexedKeyframes | null, options?: number | KeyframeAnimationOptions)
    {
        animated.push({ el: this, frames: frames as Keyframe[] });

        return animate.call(this, frames, options);
    });
});

afterEach(() =>
{
    cleanup();
    vi.restoreAllMocks();
    resetRuntime();
});

describe('the fitting room’s tables', () =>
{
    it('draws a stage for each game, each with a press for every moment its table plays a look at', async () =>
    {
        const root = await tables();

        expect([...root.querySelectorAll('[data-lab-stage]')].map((one) => one.getAttribute('data-lab-stage'))).toEqual(['ludo', 'cards', 'backgammon', 'chess']);
        expect([...root.querySelectorAll('[data-lab-stage] h3')].map((one) => one.textContent)).toEqual(['Ludo', 'Hokm and poker', 'Backgammon', 'Chess']);
        expect([...stage(root, 'ludo').querySelectorAll('button')].map((one) => one.textContent?.trim())).toEqual(['Die lands', 'A six', 'A walk', 'Out of the yard', 'A capture', 'Entrance', 'Entrance in the whole set', 'A win']);
        expect(stage(root, 'cards').querySelectorAll('button')).toHaveLength(STAGES.cards.length);
        expect(stage(root, 'backgammon').querySelectorAll('button')).toHaveLength(STAGES.backgammon.length);
        expect(stage(root, 'chess').querySelectorAll('button')).toHaveLength(STAGES.chess.length);
        expect(stage(root, 'chess').querySelector('ul')?.getAttribute('aria-label')).toBe('Moments at Chess');
        expect(root.querySelector('#lab-tables')?.textContent).toBe('At the table');
    });

    it('draws every table in the collection’s own looks, by the boards’ own classes, and somebody else’s pawn in Classic', async () =>
    {
        const root = await tables('jade');
        const ludo = stage(root, 'ludo');
        const pawns = [...ludo.querySelectorAll<HTMLImageElement>('[data-body]')].map((one) => one.getAttribute('src'));

        expect(ludo.querySelector('.lb-yard')?.getAttribute('data-yard')).toBe('jade');
        expect(pawns.filter((one) => one === '/pawns/jade-red.svg'), 'the corner’s own pawns were not in its look').toHaveLength(5);
        expect(pawns, 'somebody else’s pawn was drawn in the reader’s look').toContain('/board/pawn-blue.svg');
        expect(ludo.querySelector<HTMLElement>('.die3d')?.style.getPropertyValue('--die-lit')).toBe(dieDress('jade')['--die-lit']);

        const cards = stage(root, 'cards');

        expect(cards.querySelector('.felt-mat')?.getAttribute('data-mat')).toBe('jade');
        expect(cards.querySelector('.felt-mat')?.hasAttribute('data-turn'), 'the felt was not lit for its owner’s turn').toBe(true);
        expect([...cards.querySelectorAll('[data-faces]')].map((one) => one.getAttribute('data-faces'))).toEqual(['jade', 'jade']);
        expect(cards.querySelector('[data-backs]')?.getAttribute('data-backs')).toBe('jade');
        expect(cards.querySelector('.chip-stack')?.getAttribute('data-chips')).toBe('jade');

        const board = stage(root, 'backgammon');
        const men = [...board.querySelectorAll('.man')];

        expect(board.querySelector('.bgt-home')?.getAttribute('data-home')).toBe('jade');
        expect(men.every((one) => one.getAttribute('data-checkers') === 'jade')).toBe(true);
        expect(new Set(men.map((one) => one.getAttribute('data-tone'))), 'both sides’ checkers were not drawn').toEqual(new Set(['light', 'dark']));
        expect(board.querySelectorAll('.man[data-off]'), 'nothing lay borne off in the tray').toHaveLength(3);
        expect(board.querySelector<HTMLElement>('[data-lab-scene="backgammon"]')?.style.getPropertyValue('--layer-inlay'), 'the home board was not laid under the checkers').toBe('1');
        expect([...board.querySelectorAll<HTMLElement>('.die3d')].map((one) => one.dataset.look)).toEqual(['jade', 'jade']);

        const chess = stage(root, 'chess').querySelector<HTMLElement>('[data-lab-scene="chess"]')!;

        expect(chess.style.getPropertyValue('--piece-wk')).toContain('/pieces/jade-wk.svg');
        expect(chess.style.getPropertyValue('--piece-bk')).toContain('/pieces/jade-bk.svg');
        expect(chess.style.getPropertyValue('--layer-piece'), 'the pieces lay under the effects').toBe('10');
    });

    it('dresses the same nodes in another collection, and wears its voices instead', async () =>
    {
        const [collection, setCollection] = createSignal<Collection>('storm');
        const root = renderTest(() => LabTables({
            get collection()
            {
                return collection();
            }
        }) as Rendered).container;

        await mounted();

        const yard = root.querySelector('.lb-yard');
        const walker = root.querySelector('[data-lab-piece="walker"] [data-body]');
        const die = root.querySelector<HTMLElement>('[data-lab-scene="ludo"] .die3d');
        const scene = root.querySelector<HTMLElement>('[data-lab-scene="chess"]');

        setCollection('frost');

        expect(root.querySelector('.lb-yard'), 'the yard was drawn again').toBe(yard);
        expect(yard?.getAttribute('data-yard')).toBe('frost');
        expect(root.querySelector('[data-lab-piece="walker"] [data-body]')).toBe(walker);
        expect(walker?.getAttribute('src')).toBe('/pawns/frost-red.svg');
        expect(die?.style.getPropertyValue('--die-lit')).toBe(dieDress('frost')['--die-lit']);
        expect(scene?.style.getPropertyValue('--piece-wq')).toContain('/pieces/frost-wq.svg');
        expect(scene?.style.getPropertyValue('--layer-piece'), 'a new set took the board’s layers away').toBe('10');
        expect(voices.made[0]?.worn.at(-1)).toEqual(['frost']);
        expect(voices.made[0]?.cheered.at(-1), 'the new collection’s win could not be heard').toEqual(['frost']);
    });

    it('plays every moment of every table in its collection’s recipe and says it in its voice, a check in none', async () =>
    {
        const root = await tables('oni');

        for (const [game, moments] of Object.entries(STAGES) as [string, readonly TableMoment[]][])
        {
            for (const moment of moments)
            {
                engine.signed = [];
                voices.made[0]!.played = [];

                const words = useLocale().t(`shop.lab.moment.${ moment }`);

                press(root, game, words);
                clock.advance(2_000);
                await Promise.resolve();

                const { steps, voice } = momentOf(moment, 'oni', { x: 0, y: 0, width: 40, height: 40 });

                expect(engine.signed.map((one) => one.steps), `${ game } ${ moment } played another recipe`).toContainEqual(steps);
                expect(said(), `${ game } ${ moment } said the wrong voice`).toEqual(voice === null ? [] : Array.from({ length: engine.signed.length }, () => `oni.${ voice }`));
            }
        }
    });

    it('trails a walking pawn in its collection’s streams until it stands, then lands it where the walk ends', async () =>
    {
        const root = await tables('phoenix');

        press(root, 'ludo', 'A walk');

        const walker = root.querySelector<HTMLElement>('[data-lab-piece="walker"]')!;
        const walk = animated.find((one) => one.el === walker);

        expect(engine.streams.map((one) => one.kind)).toEqual([...TRAILS.phoenix]);
        expect(engine.streams.every((one) => one.at() !== null), 'a walking pawn shed nothing').toBe(true);
        expect(walk?.frames, 'the pawn did not walk square by square, lifted between two').toHaveLength(1 + 2 * 5);
        expect(engine.signed, 'the pawn landed before it had walked').toEqual([]);

        clock.advance(749);
        expect(engine.signed).toEqual([]);

        clock.advance(1);
        await Promise.resolve();

        expect(engine.streams.map((one) => one.at()), 'a stream went on after the pawn stood').toEqual([null, null]);
        expect(engine.streams.every((one) => one.stopped)).toBe(true);
        expect(engine.signed.map((one) => one.steps)).toEqual([[{ effect: 'dust' }]]);
        expect(said()).toEqual(['phoenix.pawn']);

        press(root, 'ludo', 'A walk');
        expect(engine.streams, 'a walk still on its way was walked again').toHaveLength(2);
    });

    it('sizes each moment to the thing it happens to, a Ludo cell or a chess square, as the boards size it', async () =>
    {
        const root = await tables('storm');
        const scaleOf = (game: string, words: string) =>
        {
            engine.signed = [];
            press(root, game, words);
            clock.advance(2_000);

            return engine.signed[0]?.scale ?? 0;
        };

        expect(scaleOf('ludo', 'A capture')).toBeCloseTo(LUDO_CELL / 40, 5);
        expect(scaleOf('ludo', 'A walk'), 'a pawn’s landing was not wider than its cell').toBeCloseTo(LUDO_CELL * ARRIVAL_CELLS / 40, 5);
        expect(scaleOf('chess', 'Check')).toBeCloseTo(CHESS_SQUARE / 40, 5);
        expect(scaleOf('chess', 'Checkmate'), 'a mate was not as wide as the board reveals it').toBeCloseTo(CHESS_SQUARE * MATE_SQUARES / 40, 5);
    });

    it('castles, promotes and mates the pieces themselves, and stands them back for the next press', async () =>
    {
        vi.spyOn(useDevice(), 'reducedMotion').mockReturnValue(true);

        const root = await tables('void');
        const piece = (square: string) => root.querySelector<HTMLElement>(`[data-lab-piece="${ square }"]`)!;

        press(root, 'chess', 'Castling');
        clock.advance(0);

        expect(piece('e8').style.translate, 'the king did not castle').toBe(`${ (2 * CHESS_SQUARE).toFixed(1) }px 0.0px`);
        expect(piece('h8').style.translate, 'the rook did not castle').toBe(`${ (-2 * CHESS_SQUARE).toFixed(1) }px 0.0px`);

        press(root, 'chess', 'Promotion');
        clock.advance(0);

        expect(piece('f7').dataset.piece, 'the pawn was not promoted').toBe('wq');

        press(root, 'chess', 'Checkmate');
        clock.advance(0);

        expect(piece('e8').hasAttribute('data-tipped'), 'the mated king stood').toBe(true);

        clock.advance(1_000);

        expect([piece('e8').style.translate, piece('h8').style.translate, piece('f7').dataset.piece, piece('e8').hasAttribute('data-tipped')], 'a piece was not stood back for the next press').toEqual(['', '', 'wp', false]);
    });

    it('lets less motion move nothing, and still plays each moment where it lands, at once', async () =>
    {
        vi.spyOn(useDevice(), 'reducedMotion').mockReturnValue(true);

        const root = await tables('gold');

        expect(engine.made.every((one) => one.quiet?.() === true), 'an engine would draw particles for somebody who asked for less motion').toBe(true);

        press(root, 'ludo', 'A walk');
        clock.advance(0);
        await Promise.resolve();

        const walker = root.querySelector<HTMLElement>('[data-lab-piece="walker"]')!;

        expect(animated, 'something moved for somebody who asked for less motion').toEqual([]);
        expect(walker.style.translate, 'the pawn was not set down where the walk ends').not.toBe('');
        expect(said()).toEqual(['gold.pawn']);
    });

    it('wears the collection’s voices for a table under the device’s sound switch, and says so while it is off', async () =>
    {
        const root = await tables('astral');
        const made = voices.made[0]!;

        expect(voices.made).toHaveLength(1);
        expect(made.place).toBe('table');
        expect(made.on).toBe(true);
        expect(made.worn.at(-1)).toEqual(['astral']);
        expect(made.cheered.at(-1)).toEqual(['astral']);
        expect(root.querySelector('[data-lab-silent]')).toBeNull();

        useSettings().update({ sound: false });

        expect(made.turned.at(-1)).toBe(false);
        expect(root.querySelector('[data-lab-silent]')?.textContent).toBe('Table sounds are off on this device, so the moments play without their voices.');
    });

    it('lays each engine under the pieces it plays round, Ludo’s over its pawns as the board’s, and fetches each ahead of the first press', async () =>
    {
        await tables('void');

        expect(engine.made.map((one) => one.host.getAttribute('data-lab-scene'))).toEqual(['ludo', 'cards', 'backgammon', 'chess']);
        expect(engine.made.map((one) => one.layer)).toEqual([4, 1, 5, 5]);
        expect(engine.warmed).toBe(4);
    });

    it('lets go of its engines, its voices and every moment still on its way when the room is left', async () =>
    {
        const root = await tables('glow');

        press(root, 'ludo', 'A walk');
        press(root, 'chess', 'Castling');
        expect(clock.pending()).toBeGreaterThan(0);

        cleanup();

        expect(engine.disposed).toBe(4);
        expect(voices.made[0]?.disposed).toBe(true);
        expect(clock.pending(), 'a moment was still on its way after the room was left').toBe(0);
    });

    it('says everything in Persian for a Persian reader', async () =>
    {
        useLocale().setLocale('fa');

        const root = await tables('jade');

        expect(root.querySelector('#lab-tables')?.textContent).toBe('سر میز');
        expect([...stage(root, 'backgammon').querySelectorAll('button')].map((one) => one.textContent?.trim())).toEqual(['تاس ریختن', 'جفت آوردن', 'زدن مهره‌ی تک', 'برگشتن از وسط', 'جمع کردن مهره', 'ورود', 'ورود با ست کامل', 'بردن']);
        expect(stage(root, 'cards').querySelector('h3')?.textContent).toBe('حکم و پوکر');
    });
});

describe('the fitting room’s playground', () =>
{
    const tuneButton = (root: ParentNode) => [...root.querySelectorAll<HTMLButtonElement>('button')].find((one) => one.textContent?.trim() === 'Tune')!;

    const opened = async (collection: Collection = 'void') =>
    {
        const root = await tables(collection);

        fire(tuneButton(root), 'click');
        await vi.waitFor(() => expect(root.querySelector('[data-lab-playground]')).not.toBeNull());
        await mounted();

        return root;
    };

    const ground = (root: ParentNode) => root.querySelector<HTMLElement>('[data-lab-playground]')!;

    const pressIn = (root: ParentNode, words: string) =>
    {
        const button = [...ground(root).querySelectorAll<HTMLButtonElement>('button')].find((one) => one.textContent?.trim() === words);

        expect(button, `the playground offered no “${ words }”`).toBeDefined();
        fire(button!, 'click');
    };

    /** Picks `words` from the playground's `nth` select: the moment's is the first, the quality's the second. */
    const choose = (root: ParentNode, nth: number, words: string) =>
    {
        fire(ground(root).querySelectorAll<HTMLButtonElement>('[aria-haspopup="listbox"]')[nth]!, 'click');

        const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((one) => one.textContent?.trim() === words);

        expect(option, `“${ words }” could not be chosen`).toBeDefined();
        fire(option!, 'click');
    };

    const stageEngine = () => engine.made.filter((one) => one.host.getAttribute('data-lab-scene') === 'playground').at(-1)!;

    const played = () => engine.signed.filter((one) => one.host.getAttribute('data-lab-scene') === 'playground');

    it('opens from Tune as a chunk of its own, above the tables, and closes from the same press', async () =>
    {
        const root = await tables('void');
        const tune = tuneButton(root);

        expect(tune.getAttribute('aria-pressed')).toBe('false');
        expect(root.querySelector('[data-lab-playground]')).toBeNull();

        fire(tune, 'click');
        await vi.waitFor(() => expect(root.querySelector('[data-lab-playground]')).not.toBeNull());

        expect(tuneButton(root), 'the press was drawn again').toBe(tune);
        expect(tune.getAttribute('aria-pressed')).toBe('true');
        expect(ground(root).compareDocumentPosition(root.querySelector('[data-lab-stage="ludo"]')!), 'the playground was not above the tables').toBe(Node.DOCUMENT_POSITION_FOLLOWING);

        await mounted();
        fire(tune, 'click');

        expect(root.querySelector('[data-lab-playground]')).toBeNull();
        expect(stageEngine().disposed, 'the playground’s engine outlived it').toBe(true);
    });

    it('plays the moment chosen on its own stage, in the collection’s recipe and voice, at one as its table plays it', async () =>
    {
        const root = await opened('void');

        pressIn(root, 'Play');

        expect(played().at(-1)?.steps).toEqual(retune(momentOf('six', 'void', { x: 0, y: 0, width: 1, height: 1 }), { intensity: 1, speed: 1, density: 1, size: 1 }).steps);
        expect(played().at(-1)?.tune).toMatchObject({ intensity: 1, speed: 1, density: 1 });
        expect(said().at(-1)).toBe('void.die');

        choose(root, 0, 'Checkmate');
        pressIn(root, 'Play');

        expect(played().at(-1)?.steps.map((step) => step.effect)).toEqual([...CRITICALS.void, FINALES.void].map((step) => step.effect));
        expect(said().at(-1)).toBe('void.capture');
    });

    it('lays its knobs over the moment as factors, plays it the same way once asked, and goes back to how a table plays it', async () =>
    {
        const root = await opened('frost');
        const [strength, speed] = [...ground(root).querySelectorAll<HTMLElement>('[role="slider"]')];

        expect(strength?.getAttribute('aria-label')).toBe('Intensity');
        expect(strength?.getAttribute('aria-valuetext')).toBe('100%');
        const key = (slider: HTMLElement | undefined, name: string) => slider?.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));

        key(strength, 'ArrowRight');
        key(strength, 'ArrowRight');
        key(speed, 'ArrowLeft');
        pressIn(root, 'Play');

        expect(played().at(-1)?.tune.intensity as number).toBeCloseTo(1.1, 5);
        expect(played().at(-1)?.tune.speed as number).toBeCloseTo(0.95, 5);
        expect('seed' in played().at(-1)!.tune, 'a seed was laid on a moment nobody asked to repeat').toBe(false);

        pressIn(root, 'Another way');

        expect(played().at(-1)?.tune.seed, 'another way played no seed').toBe(2);
        expect(ground(root).querySelector('[role="switch"]')?.getAttribute('aria-checked'), 'another way did not keep its seed').toBe('true');

        pressIn(root, 'As a table plays it');
        pressIn(root, 'Play');

        expect(played().at(-1)?.tune).toMatchObject({ intensity: 1, speed: 1, density: 1 });
        expect('seed' in played().at(-1)!.tune).toBe(false);
    });

    it('makes its engine again at a quality chosen, and draws as less motion does once asked', async () =>
    {
        const root = await opened('oni');
        const first = stageEngine();

        expect(first.quality, 'the device’s own quality was overruled').toBeUndefined();

        choose(root, 1, 'Low');

        expect(first.disposed).toBe(true);
        expect(stageEngine().quality).toBe('low');
        expect(stageEngine().quiet?.()).toBe(false);

        fire([...ground(root).querySelectorAll<HTMLElement>('[role="switch"]')][1]!, 'click');

        expect(stageEngine().quiet?.(), 'less motion was not drawn').toBe(true);

        choose(root, 1, 'This device');

        expect(stageEngine().quality).toBeUndefined();
        expect(stageEngine().quiet?.(), 'a new engine forgot less motion').toBe(true);
    });

    it('says everything in Persian for a Persian reader', async () =>
    {
        useLocale().setLocale('fa');

        const root = await tables('jade');
        const tune = [...root.querySelectorAll<HTMLButtonElement>('button')].find((one) => one.textContent?.trim() === 'تنظیم')!;

        fire(tune, 'click');
        await vi.waitFor(() => expect(root.querySelector('[data-lab-playground]')).not.toBeNull());

        expect(ground(root).querySelector('h3')?.textContent).toBe('تنظیم جلوه‌ها');
        expect([...ground(root).querySelectorAll('[role="slider"]')].map((one) => one.getAttribute('aria-label'))).toEqual(['شدت', 'سرعت', 'تراکم', 'اندازه']);
        expect(ground(root).querySelector('[role="slider"]')?.getAttribute('aria-valuetext'), 'a knob did not say its share in the reader’s own digits').toContain('۱۰۰');
    });
});
