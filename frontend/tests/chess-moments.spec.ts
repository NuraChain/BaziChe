import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { SIZE, SQUARE, spotOf } from '../src/game/chess-layout.ts';
import { feltOf, type Told } from '../src/game/chess-felt.ts';
import { GLIDE_MOST, PROMOTE_MS, ROOK_MS, TIP_MS, createChessTable, type ChessTable, type Lay } from '../src/game/board/chess-table.ts';
import { CASTLES, CHECKS, FINALES, LANDING, type Sets } from '../src/game/looks/chess.ts';
import { CAPTURES, CRITICALS, burstOf, lightOf } from '../src/game/looks/table.ts';
import { createDirector, type Director } from '../src/game/stage/director.ts';
import type { Act } from '../src/game/stage/feed.ts';
import { LAYER } from '../src/game/stage/layers.ts';
import type { Sight } from '../src/game/stage/presenter.ts';
import { createStage, type Stage } from '../src/game/stage/stage.ts';
import type { Cue, SoundHandle } from '../src/game/sound.ts';
import { parseFen, squareNamed } from '../../backend/src/domains/match/chess/board.ts';

interface Burst
{
    preset: string;
    at: { x: number; y: number };
    tune: { colors?: readonly string[]; scale?: number };
    when: number;
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

/** How many pixels of the effects' engine one effect's scale stands for. */
const FITS = 40;

const sq = (name: string) => squareNamed(name)!;

/** The middle of a square in pixels, the board drawn one pixel a unit, as the colour at its foot stands it. */
const middle = (name: string, foot: 'w' | 'b' = 'w') =>
{
    const spot = spotOf(sq(name), foot);

    return { x: spot.x + SQUARE / 2, y: spot.y + SQUARE / 2 };
};

const lay = (fen: string, over: Partial<Lay> = {}): Lay =>
{
    const position = parseFen(fen)!;

    return { ...feltOf({ board: position.board, turn: position.turn, last: undefined }), foot: 'w', mated: null, ...over };
};

const sight = (view: Lay, rev = 5, seat: number | null = 0): Sight<Lay> => ({ id: 'm', rev, seat, view });

const act = (rev: number, seat: number, moves: Told[]): Act<Told> => ({ rev, seat, moves });

const move = (from: string, to: string, piece: string, extra: Partial<Told> = {}): Told => ({ e: 'move', seat: 0, from: sq(from), to: sq(to), piece: piece as never, san: '', ...extra });

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
let table: ChessTable;
let heard: { cue: Cue; at: number }[];
let still: boolean;
let sets: Sets;
let broke: unknown[];

const elapse = async (ms: number) =>
{
    for (let left = ms; left > 0; left -= 5)
    {
        clock.advance(Math.min(5, left));
        await flush();
    }

    await flush();
};

const play = (acts: Act<Told>[], seen: Sight<Lay>) => director.enqueue((ctx) => table.play(acts, seen, ctx), { estimate: table.estimate(acts) });

/** The board laid at a position, one move played from it, and the clock run past every moment the move plays. */
const played = async (fen: string, told: Told, after: string) =>
{
    table.reset(sight(lay(fen)));
    await flush();
    play([act(6, 0, [told])], sight(lay(after), 6));
    await elapse(GLIDE_MOST + PROMOTE_MS + ROOK_MS + 400);
};

const bursts = () => engine.bursts as Burst[];

const cues = () => heard.map((one) => one.cue);

beforeEach(() =>
{
    const sound: SoundHandle = {
        play: (cue) =>
        {
            heard.push({ cue, at: clock.now() });
        },
        wear: () => undefined,
        ready: () => Promise.resolve(),
        setEnabled: () => undefined,
        dispose: () => undefined
    };

    clock = manualClock(1000);
    engine.made = 0;
    engine.layers = [];
    engine.quiet = [];
    engine.bursts = [];
    engine.disposed = 0;
    engine.now = () => clock.now();
    heard = [];
    broke = [];
    still = false;
    sets = { w: null, b: null };
    host = document.createElement('div');
    host.className = 'chess-layer';
    Object.defineProperty(host, 'clientWidth', { value: SIZE });
    document.body.append(host);

    stage = createStage({ clock, quiet: () => still, report: (error) => broke.push(error) });
    director = createDirector(stage, clock, (error) => broke.push(error));
    table = createChessTable({ host, stage, sound: () => sound, animals: () => false, feel: () => undefined, sets: () => sets });
});

afterEach(() =>
{
    table.dispose();
    host.remove();
    vi.restoreAllMocks();
    expect(broke).toEqual([]);
});

describe('a chess table\'s moments in its players\' sets', () =>
{
    it('fetches no engine at a table where nobody wears a set, and plays nothing there', async () =>
    {
        await played('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', move('e2', 'e3', 'P'), '4k3/8/8/8/8/4P3/8/4K3 b - - 0 1');

        expect(engine.made).toBe(0);
        expect(cues()).toEqual(['piece-move']);
    });

    it('fetches the engine ahead of the first moment once a side wears a set, under every piece, and tells it when less motion is asked for', async () =>
    {
        sets = { w: null, b: 'storm' };
        table.reset(sight(lay('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1')));
        await vi.waitFor(() => expect(engine.made).toBe(1));

        expect(engine.layers).toEqual([LAYER.glow]);
        expect(engine.quiet[0]!()).toBe(false);

        still = true;

        expect(engine.quiet[0]!()).toBe(true);
    });

    it('sets a piece of a set down with its collection\'s burst, lightly and at a square\'s size, in its voice as it lands', async () =>
    {
        sets = { w: 'inferno', b: null };
        await played('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', move('e2', 'e3', 'P'), '4k3/8/8/8/8/4P3/8/4K3 b - - 0 1');

        expect(bursts()).toHaveLength(1);
        expect(bursts()[0]).toMatchObject({ preset: burstOf('inferno').effect, at: middle('e3'), tune: { colors: lightOf('inferno'), scale: SQUARE / FITS } });
        expect(bursts()[0]!.steps).toEqual([{ effect: burstOf('inferno').effect, tune: LANDING }]);
        expect(cues()).toEqual(['piece-move', 'inferno.pawn']);
        expect(heard[1]!.at).toBe(heard[0]!.at);
    });

    it('plays nothing for a side in Classic, though the other side wears a set', async () =>
    {
        sets = { w: null, b: 'storm' };
        await played('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', move('e2', 'e3', 'P'), '4k3/8/8/8/8/4P3/8/4K3 b - - 0 1');

        expect(bursts()).toEqual([]);
        expect(cues()).toEqual(['piece-move']);
    });

    it('plays where the reader\'s colour at the foot stands the square', async () =>
    {
        sets = { w: 'gold', b: null };
        table.reset(sight(lay('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', { foot: 'b' }), 5, 1));
        await flush();
        play([act(6, 0, [move('e2', 'e3', 'P')])], sight(lay('4k3/8/8/8/8/4P3/8/4K3 b - - 0 1', { foot: 'b' }), 6, 1));
        await elapse(GLIDE_MOST + 40);

        expect(bursts().map((one) => one.at)).toEqual([middle('e3', 'b')]);
    });

    it('plays the taker\'s capture where the piece it takes stood, as the two meet, and no landing of its own', async () =>
    {
        sets = { w: 'void', b: null };
        await played('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1', move('e4', 'd5', 'P', { captured: 'p' }), '4k3/8/8/3P4/8/8/8/4K3 b - - 0 1');

        expect(bursts()).toHaveLength(1);
        expect(bursts()[0]).toMatchObject({ steps: CAPTURES.void, at: middle('d5'), tune: { colors: lightOf('void'), scale: SQUARE / FITS } });
        expect(cues()).toEqual(['piece-capture', 'void.capture', 'piece-move']);
        expect(heard[1]!.at).toBe(heard[0]!.at);
    });

    it('plays a pawn taken in passing where that pawn stood', async () =>
    {
        sets = { w: 'astral', b: null };
        await played('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', move('e5', 'd6', 'P', { captured: 'p', enPassant: true }), '4k3/8/3P4/8/8/8/8/4K3 b - - 0 1');

        expect(bursts().map((one) => [one.steps, one.at])).toEqual([[CAPTURES.astral, middle('d5')]]);
    });

    it('castles in its collection\'s flourish where the rook is set down beside its king, and sets the king down plainly', async () =>
    {
        sets = { w: 'storm', b: null };
        await played('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', move('e1', 'g1', 'K', { castle: 'k' }), 'r3k2r/8/8/8/8/8/8/R4RK1 b kq - 1 1');

        expect(bursts().map((one) => [one.steps, one.at])).toEqual([[CASTLES.storm, middle('f1')]]);
        expect(cues()).toEqual(['piece-move', 'piece-move', 'storm.pawn']);
        expect(heard[2]!.at).toBe(heard[1]!.at);
    });

    it('promotes in its collection\'s critical reveal on the square as the pawn turns, and no landing', async () =>
    {
        sets = { w: 'phoenix', b: null };
        await played('8/4P2k/8/8/8/8/8/4K3 w - - 0 1', move('e7', 'e8', 'P', { promotion: 'q' }), '4Q3/7k/8/8/8/8/8/4K3 b - - 0 1');

        expect(bursts().map((one) => [one.steps, one.at])).toEqual([[CRITICALS.phoenix, middle('e8')]]);
        expect(cues()).toEqual(['piece-move', 'promote', 'phoenix.spawn']);
        expect(heard[2]!.at).toBe(heard[1]!.at);
    });

    it('warns of check in the collection of the side that gave it, under the king, and leaves the voice to the board\'s chime', async () =>
    {
        sets = { w: 'jade', b: 'frost' };
        await played('4k3/8/8/8/8/8/8/R3K3 w - - 0 1', move('a1', 'a8', 'R'), 'R3k3/8/8/8/8/8/8/4K3 b - - 1 1');

        expect(bursts().map((one) => [one.steps, one.at])).toEqual([[[{ effect: burstOf('jade').effect, tune: LANDING }], middle('a8')], [CHECKS.jade, middle('e8')]]);
        expect(cues()).toEqual(['piece-move', 'jade.pawn', 'check']);
    });

    it('ends a mate in the winner\'s critical reveal and one layer more, wider, over the king laid down, once it falls', async () =>
    {
        sets = { w: 'gold', b: 'oni' };
        table.reset(sight(lay('rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2')));
        await flush();
        play([act(6, 1, [move('d8', 'h4', 'q', { seat: 1, check: true, mate: true }), { e: 'finish', reason: 'checkmate', winner: 1 }])], sight(lay('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3', { mated: 'w', last: { from: sq('d8'), to: sq('h4') } }), 6));
        await elapse(GLIDE_MOST + TIP_MS + 200);

        const mate = bursts().at(-1)!;

        expect(mate.steps).toEqual([...CRITICALS.oni, FINALES.oni]);
        expect(mate.at).toEqual(middle('e1'));
        expect(mate.tune).toMatchObject({ colors: lightOf('oni'), scale: SQUARE * 1.6 / FITS });
        expect(cues().slice(-3)).toEqual(['king-fall', 'oni.capture', 'lose']);
        expect(heard.at(-2)!.at).toBe(heard.at(-3)!.at);
    });

    it('lets the engine go with the board', async () =>
    {
        sets = { w: 'glow', b: null };
        await played('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', move('e2', 'e3', 'P'), '4k3/8/8/8/8/4P3/8/4K3 b - - 0 1');
        table.dispose();

        expect(engine.disposed).toBe(1);
    });
});
