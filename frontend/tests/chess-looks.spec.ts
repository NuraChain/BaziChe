import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { createSignal } from 'azerothjs';

import ChessBoard from '../src/components/games/chess-board.component.azeroth';
import { SIZE, SQUARE, spotOf } from '../src/game/chess-layout.ts';
import { dressOf } from '../src/game/looks/chess.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { NO_EVENTS } from '../src/stores/match.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import type { MatchView } from '../src/api.ts';
import { parseFen, squareNamed } from '../../backend/src/domains/match/chess/board.ts';

const voices = vi.hoisted(() => ({ worn: [] as (readonly string[])[] }));

vi.mock('../src/game/sound.ts', async (original) =>
{
    const real = await original<typeof import('../src/game/sound.ts')>();

    return {
        ...real,
        createSound: () => ({
            play: () => undefined,
            wear: (collections: readonly string[]) =>
            {
                voices.worn.push([...collections]);
            },
            setEnabled: () => undefined,
            dispose: () => undefined
        })
    };
});

const handed = vi.hoisted(() => ({ sets: [] as (() => unknown)[] }));

vi.mock('../src/game/board/chess-table.ts', async (original) =>
{
    const real = await original<typeof import('../src/game/board/chess-table.ts')>();

    return {
        ...real,
        createChessTable: (options: Parameters<typeof real.createChessTable>[0]) =>
        {
            handed.sets.push(() => options.sets?.());

            return real.createChessTable(options);
        }
    };
});

type Chess = Extract<MatchView['view'], { kind: 'chess' }>;

type Look = NonNullable<MatchView['players'][number]['look']>;

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const PIECES = ['wk', 'wq', 'wr', 'wb', 'wn', 'wp', 'bk', 'bq', 'br', 'bb', 'bn', 'bp'];

const fen = (text: string) =>
{
    const position = parseFen(text)!;

    return { board: position.board, turn: position.turn, castling: position.castling, ...(position.ep === null ? {} : { ep: position.ep }), halfmove: position.halfmove, fullmove: position.fullmove };
};

const match = (looks: (Look | undefined)[], view: Partial<Chess> = {}, mine: number | null = 0, id = 'match-chess'): MatchView => ({
    id,
    tableId: 'table-chess',
    game: 'chess',
    rev: 4,
    seats: 2,
    players: [0, 1].map((seat) => ({ seat, who: seat === 0 ? 'dana.w' : 'omid.k', timeouts: 0, ...(looks[seat] === undefined ? {} : { look: looks[seat] }) })) as MatchView['players'],
    turn: 0,
    ...(mine === null ? {} : { mine }),
    startedAt: new Date(400_000).toISOString(),
    remainingMs: 600_000,
    view: { kind: 'chess', white: 0, ...fen(START), ply: 0, clock: { base: 600_000, increment: 0, left: [600_000, 600_000] }, notation: [], moved: [true, true], offered: [-1, -1], ...view }
});

const flush = async () =>
{
    for (let turn = 0; turn < 12; turn += 1)
    {
        await Promise.resolve();
    }
};

const live = async (first: MatchView) =>
{
    const [current, setCurrent] = createSignal(first);
    const view = renderTest(() => ChessBoard({
        get match()
        {
            return current();
        },
        get events()
        {
            return NO_EVENTS;
        }
    }) as HTMLElement);

    await flush();

    return { ...view, move: async (next: MatchView) =>
    {
        setCurrent(next);
        await flush();
    } };
};

const stageOf = (container: HTMLElement) => container.querySelector<HTMLElement>('.table-stage')!;

/** Each piece's drawing as the board's root names it, by the piece's name; a piece it names nothing for is the board's own. */
const drawn = (container: HTMLElement) =>
{
    const style = stageOf(container).style;

    return Object.fromEntries(PIECES.map((piece) => [piece, /url\(['"]?([^'")]+)['"]?\)/.exec(style.getPropertyValue(`--piece-${ piece }`))?.[1] ?? 'own']));
};

const setOf = (collection: string, colour: 'w' | 'b') => Object.fromEntries(['k', 'q', 'r', 'b', 'n', 'p'].map((kind) => [`${ colour }${ kind }`, `/pieces/${ collection }-${ colour }${ kind }.svg`]));

const own = (colour: 'w' | 'b') => Object.fromEntries(['k', 'q', 'r', 'b', 'n', 'p'].map((kind) => [`${ colour }${ kind }`, 'own']));

const wood = (container: HTMLElement) =>
{
    const el = container.querySelector<HTMLElement>('.chess-wood')!;

    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: SIZE, height: SIZE, right: SIZE, bottom: SIZE, x: 0, y: 0, toJSON: () => ({}) });

    return el;
};

const tap = (container: HTMLElement, name: string) =>
{
    const spot = spotOf(squareNamed(name)!, 'w');

    for (const type of ['pointerdown', 'pointerup'])
    {
        wood(container).dispatchEvent(new PointerEvent(type, { clientX: spot.x + SQUARE / 2, clientY: spot.y + SQUARE / 2, bubbles: true, pointerId: 3, isPrimary: true, button: 0, pointerType: 'mouse' }));
    }
};

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(400_000), seed: 3 });
    useLocale().setLocale('en');
    useSettings().reset();
    voices.worn = [];
    handed.sets = [];
});

afterEach(() =>
{
    cleanup();
    vi.restoreAllMocks();
});

describe('each side\'s pieces in the set its player wears', () =>
{
    it.each([['White', 0], ['Black', 1], ['somebody watching', null]] as const)('draws White\'s pieces in the set of whoever plays White and Black\'s in theirs, for a reader playing %s', async (_, mine) =>
    {
        const { container } = await live(match([{ pieces: 'pieces.inferno' }, { pieces: 'pieces.storm' }], {}, mine));

        expect(drawn(container)).toEqual({ ...setOf('inferno', 'w'), ...setOf('storm', 'b') });
    });

    it('follows the seat the server dealt White, not the first seat', async () =>
    {
        const { container } = await live(match([{ pieces: 'pieces.inferno' }, { pieces: 'pieces.jade' }], { white: 1 }, 1));

        expect(drawn(container)).toEqual({ ...setOf('jade', 'w'), ...setOf('inferno', 'b') });
    });

    it('hands its table each colour\'s set, so what the pieces do is the set they are drawn in', async () =>
    {
        const board = await live(match([{ pieces: 'pieces.inferno' }, { pieces: 'pieces.jade' }], { white: 1 }, 0));

        expect(handed.sets).toHaveLength(1);
        expect(handed.sets[0]!()).toEqual({ w: 'jade', b: 'inferno' });

        await board.move(match([undefined, { pieces: 'pieces.frost' }], {}, 0, 'match-next'));

        expect(handed.sets[0]!()).toEqual({ w: null, b: 'frost' });
    });

    it('draws a side in Classic as the board\'s own, and keeps the other side\'s set off it', async () =>
    {
        const { container } = await live(match([undefined, { pieces: 'pieces.oni' }]));

        expect(drawn(container)).toEqual({ ...own('w'), ...setOf('oni', 'b') });
    });

    it('takes a look of another kind, and a set this build does not draw, for Classic', async () =>
    {
        const { container } = await live(match([{ dice: 'dice.jade', checkers: 'checkers.storm' } as Look, { pieces: 'pieces.nowhere' }]));

        expect(drawn(container)).toEqual({ ...own('w'), ...own('b') });
        expect(stageOf(container).getAttribute('style') ?? '').toBe('');
    });

    it('is the same board through a re-read, and wears the looks of the game it is shown', async () =>
    {
        const board = await live(match([{ pieces: 'pieces.frost' }, undefined]));
        const root = stageOf(board.container);

        await board.move(match([{ pieces: 'pieces.frost' }, undefined]));

        expect(stageOf(board.container)).toBe(root);
        expect(drawn(board.container)).toEqual({ ...setOf('frost', 'w'), ...own('b') });

        await board.move(match([{ pieces: 'pieces.frost' }, { pieces: 'pieces.phoenix' }], { white: 1 }, 0, 'match-next'));

        expect(stageOf(board.container)).toBe(root);
        expect(drawn(board.container)).toEqual({ ...setOf('phoenix', 'w'), ...setOf('frost', 'b') });
    });

    it('holds the trays a side took into and the promotion chooser inside the board that wears the sets', async () =>
    {
        const taken = await live(match([{ pieces: 'pieces.gold' }, { pieces: 'pieces.void' }], { ...fen('rnbqkbnr/ppp1pppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 3'), ply: 4 }));
        const tray = [...taken.container.querySelectorAll<HTMLElement>('.chess-taken > i')];

        expect(tray.map((one) => one.dataset.piece)).toEqual(['bp']);
        expect(tray.every((one) => stageOf(taken.container).contains(one))).toBe(true);
        expect(drawn(taken.container).bp).toBe('/pieces/void-bp.svg');
        taken.unmount();

        const promoting = await live(match([{ pieces: 'pieces.astral' }, undefined], { ...fen('8/4P2k/8/8/8/8/8/4K3 w - - 0 1'), ply: 40 }));

        tap(promoting.container, 'e7');
        tap(promoting.container, 'e8');

        const choices = [...promoting.container.querySelectorAll<HTMLElement>('.chess-promote-piece')];

        expect(choices.map((one) => one.dataset.piece)).toEqual(['wq', 'wr', 'wb', 'wn']);
        expect(choices.every((one) => stageOf(promoting.container).contains(one))).toBe(true);
        expect(choices.map((one) => drawn(promoting.container)[one.dataset.piece!])).toEqual(['wq', 'wr', 'wb', 'wn'].map((piece) => `/pieces/astral-${ piece }.svg`));
    });

    it('names every piece a set draws by the name the board gives it, and nothing for a side in Classic', () =>
    {
        expect(dressOf({ w: null, b: null })).toBe('');
        expect(dressOf({ w: 'glow', b: null }).split('; ')).toEqual(['k', 'q', 'r', 'b', 'n', 'p'].map((kind) => `--piece-w${ kind }: url('/pieces/glow-w${ kind }.svg')`));
        expect(dressOf({ w: 'glow', b: 'oni' }).split('; ')).toHaveLength(12);
    });

    it('wears the voices of the sets its players\' pieces are in, once each, none at a table in Classic, and the next game\'s', async () =>
    {
        const board = await live(match([{ pieces: 'pieces.inferno' }, { pieces: 'pieces.storm', dice: 'dice.jade' } as Look]));

        expect(voices.worn.at(-1)).toEqual(['inferno', 'storm']);

        await board.move(match([{ pieces: 'pieces.oni' }, { pieces: 'pieces.oni' }], {}, 0, 'match-next'));

        expect(voices.worn.at(-1)).toEqual(['oni']);
        board.unmount();

        await live(match([undefined, { checkers: 'checkers.gold' } as Look]));

        expect(voices.worn.at(-1)).toEqual([]);
    });
});
