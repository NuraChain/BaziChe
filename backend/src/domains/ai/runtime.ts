import type { MatchPlay } from '../../schemas.ts';
import type { Format } from '../match/sides.ts';
import type { AiFigures, Skill } from '../system/rules.ts';
import { AI_ENGINES, OPENNESS, hashOf, playOf, seededRandom, type Hidden } from './agent.ts';
import { AGENTS, type Decided } from './agents.ts';
import { Dropped, type Brain } from './brain.ts';
import { onePlyChess } from './fallback.ts';

/**
 * Drives the seats system players hold.
 *
 * Every committed action tells it (`moved`); when a system player is to move it schedules one
 * decision for that match, sends the move after a think time, and drops the decision the moment
 * the match moves on. At most one decision per match is in flight in this process; a second
 * process acting on the same turn is answered `already` or `stale` by `match.act` and is dropped
 * the same way. A backstop sweep (`drive`) finds turns nothing here scheduled: after a restart, or
 * a game another process dealt.
 */

/** The fewest milliseconds a move takes, and the most. */
export const THINK_LEAST = 700;
export const THINK_MOST = 7_000;

/** A forced move is quick. */
export const FORCED_MOST = 1_200;

/** Every move is sent at least this long before the turn's deadline. */
export const SAFETY_MS = 2_000;

/** With a chess clock, the share of the bank one move may take. */
export const BANK_SHARE = 1 / 30;

/** What a typical move takes to think about, by game, before the jitter. */
const PACE: Readonly<Record<string, number>> = { chess: 2_600, backgammon: 1_800, hokm: 1_500, poker: 2_000, ludo: 900 };

const PACE_OTHER = 1_500;

/** The most a decision may use, and the least worth handing over. */
const BUDGET_MOST = 3_000;
const BUDGET_LEAST = 100;

/** How long the pool lets a job run past its budget before it gives up on it. */
const DECIDE_GRACE_MS = 2_000;

/** How quickly a system seat gives up once no person is left. */
const LEAVE_LEAST = 400;
const LEAVE_SPREAD = 1_100;

const ERRORS_KEPT = 50;

const DUE_MOST = 200;

export interface Pace
{
    game: string;

    /** How many legal actions the seat has; one or none is a forced move. */
    choices: number;

    /** Milliseconds until the turn's deadline, as read. */
    leftMs: number;

    /** The turn's own length: the bank on a chess clock, otherwise the table's turn. */
    limitMs: number;
    clock: boolean;
    random: () => number;

    /** The interval returned last time, which this one must differ from. */
    last: number | null;
}

/**
 * How long to wait before sending a move, in milliseconds from now.
 *
 * Whatever the boards are still holding (the deadline beyond the turn's own length, a trick or a
 * pot being shown) is waited out first. Then a time that grows with the game and the number of real
 * choices, with a seeded jitter, kept between `THINK_LEAST` and the smallest of `THINK_MOST`, a
 * third of the turn and, on a chess clock, `BANK_SHARE` of the bank. Never later than `SAFETY_MS`
 * before the deadline, which wins over every other bound, and never the same interval twice
 * running unless the deadline leaves no room at all.
 */
export function thinkTime(pace: Pace): number
{
    const left = Math.max(0, pace.leftMs);
    const own = Math.min(left, Math.max(0, pace.limitMs));
    const hold = left - own;
    const forced = pace.choices <= 1;
    const base = forced ? FORCED_MOST * 0.75 : (PACE[pace.game] ?? PACE_OTHER) * (0.7 + 0.6 * Math.min(1, Math.log2(pace.choices) / 5));
    const raw = base * (0.6 + 0.8 * pace.random());
    const most = Math.min(THINK_MOST, own / 3, pace.clock ? own * BANK_SHARE : THINK_MOST, forced ? FORCED_MOST : THINK_MOST);
    const latest = Math.max(0, left - SAFETY_MS);
    const ms = Math.round(Math.max(0, Math.min(latest, hold + Math.min(most, Math.max(THINK_LEAST, raw)))));

    if (ms !== pace.last)
    {
        return ms;
    }

    const shift = 1 + Math.floor(pace.random() * 40);

    if (ms + shift <= Math.min(latest, hold + Math.max(most, THINK_LEAST)))
    {
        return ms + shift;
    }

    return ms - shift >= 0 ? ms - shift : (ms > 0 ? 0 : ms);
}

/** What a decision may use, given when its move will be sent. */
export const budgetOf = (delay: number) => Math.max(BUDGET_LEAST, Math.min(BUDGET_MOST, Math.round(delay * 0.8)));

export interface SeatRow
{
    seat: number;
    userId: string;

    /** `match_players.result`: set once a seat has left or the match has ended. */
    result: string | null;

    /** Null for a person. */
    system: { skill: Skill; style: number } | null;
}

/**
 * Whether a seat is still in the game by the engine's own reckoning: a poker seat that went broke,
 * a hokm or ludo seat that is out. The engine interface has no general question for this, so each
 * game's state is read here.
 */
export function stillIn(game: string, state: unknown, seat: number): boolean
{
    if (game === 'poker' || game === 'hokm')
    {
        return (state as { out?: boolean[] }).out?.[seat] !== true;
    }

    if (game === 'ludo')
    {
        return (state as { players?: { seat: number; out: boolean }[] }).players?.find((player) => player.seat === seat)?.out !== true;
    }

    return true;
}

export interface Mover
{
    seat: number;
    userId: string;
    skill: Skill;
    style: number;
}

export interface Turn
{
    matchId: string;
    game: string;
    rev: number;
    format: Format;
    state: unknown;
    finished: boolean;
    leftMs: number;
    limitMs: number;
    clock: boolean;
    seats: SeatRow[];
}

/** Who the runtime acts for in a turn: the system player to move, or one to leave when no person is left; null for neither. */
export function whoActs(turn: Turn): { mover: Mover; leave: boolean } | null
{
    const engine = AI_ENGINES[turn.game];

    if (turn.finished || engine === undefined || AGENTS[turn.game] === undefined)
    {
        return null;
    }

    const playing = turn.seats.filter((row) => row.result === null && stillIn(turn.game, turn.state, row.seat));
    const asMover = (row: SeatRow): Mover => ({ seat: row.seat, userId: row.userId, skill: row.system?.skill ?? 'intermediate', style: row.system?.style ?? 0 });

    if (!playing.some((row) => row.system === null))
    {
        const leaving = playing.find((row) => row.system !== null);

        return leaving === undefined ? null : { mover: asMover(leaving), leave: true };
    }

    const seat = engine.turnOf(turn.state);
    const row = playing.find((one) => one.seat === seat);

    return row === undefined || row.system === null ? null : { mover: asMover(row), leave: false };
}

/** A cheap legal move for when no decision arrived in time: the engine's own autoplay, except chess, whose autoplay flags. */
export function fallbackOf(game: string, state: unknown, seat: number): MatchPlay | null
{
    if (game === 'chess')
    {
        return onePlyChess(state, seat);
    }

    const engine = AI_ENGINES[game];

    return engine === undefined ? null : playOf(game, engine.autoplay(state, seat, { die: () => 1 }));
}

export interface Source
{
    turnAt(matchId: string): Promise<Turn | null>;

    /** The seat's `{ view, log }` at exactly `rev`, or null once the match has moved past it. */
    hidden(matchId: string, rev: number, seat: number): Promise<Hidden | null>;

    /** Live matches with a system seat, the most pressing first. */
    due(limit: number): Promise<{ matchId: string; rev: number }[]>;
}

export type Act = (userId: string, matchId: string, want: { play: MatchPlay | null; rev: number; key: string }) => Promise<'now' | 'already' | 'stale'>;

export interface Clock
{
    now(): number;
    after(ms: number, run: () => void): () => void;
}

export interface RuntimeDeps
{
    source: Source;
    act: Act;
    brain: Brain;
    clock: Clock;

    /** Mixed into every seed, so decisions cannot be foreseen from a match id. */
    salt: number;
}

export type AiError = AiFigures['errors'][number];

interface Entry
{
    rev: number;
    seat: number;
    cancel: () => void;
}

export function createAiRuntime(deps: RuntimeDeps)
{
    const { source, act, brain, clock } = deps;
    const entries = new Map<string, Entry>();
    const acting = new Set<string>();
    const loading = new Set<string>();
    const again = new Set<string>();
    const seen = new Map<string, number>();
    const missed = new Set<string>();
    const errors: AiError[] = [];
    let fresh: AiError[] = [];
    let active = false;
    let last: number | null = null;
    let decisions = 0;
    let totalMs = 0;
    let worstMs = 0;
    let fallbacks = 0;

    const failed = (game: string, matchId: string, error: unknown) =>
    {
        const one: AiError = {
            at: new Date(clock.now()).toISOString(),
            game,
            matchId,
            message: error instanceof Error ? error.message : String(error)
        };

        errors.push(one);
        errors.splice(0, Math.max(0, errors.length - ERRORS_KEPT));
        fresh.push(one);
        fresh.splice(0, Math.max(0, fresh.length - ERRORS_KEPT));
    };

    const counted = (decided: Decided) =>
    {
        decisions += 1;
        totalMs += decided.ms;
        worstMs = Math.max(worstMs, decided.ms);
    };

    /** Resolves to the decision, or to null once `ms` has passed without one or it failed. */
    const within = (decision: Promise<Decided>, ms: number) => new Promise<Decided | Error | null>((resolve) =>
    {
        const stop = clock.after(ms, () => resolve(null));

        decision.then(
            (decided) =>
            {
                stop();
                resolve(decided);
            },
            (error: unknown) =>
            {
                stop();
                resolve(error instanceof Error ? error : new Error(String(error)));
            }
        );
    });

    const sent = async (turn: Turn, mover: Mover, play: MatchPlay | null) =>
        await act(mover.userId, turn.matchId, { play, rev: turn.rev, key: `ai:${ turn.rev }` });

    const finish = (matchId: string) =>
    {
        acting.delete(matchId);

        if (again.delete(matchId))
        {
            moved(matchId);
        }
    };

    /**
     * Holds the match's one slot until `delay` has passed, then runs `send` unless the match moved
     * on meanwhile. `current` stays true only while this entry is the match's slot.
     */
    const schedule = (turn: Turn, mover: Mover, delay: number, send: (current: () => boolean) => Promise<void>) =>
    {
        let cancelled = false;
        let stop = () => undefined as void;
        const entry: Entry = { rev: turn.rev, seat: mover.seat, cancel: () => { cancelled = true; stop(); } };
        const current = () => !cancelled && entries.get(turn.matchId) === entry;

        entries.set(turn.matchId, entry);

        stop = clock.after(delay, () => void (async () =>
        {
            try
            {
                await send(current);
            }
            catch (error)
            {
                failed(turn.game, turn.matchId, error);
            }
            finally
            {
                finish(turn.matchId);
            }
        })());

        return current;
    };

    /** Takes the slot over for sending, once nothing can still cancel it. False when the match moved on. */
    const claim = (matchId: string, current: () => boolean) =>
    {
        if (!current())
        {
            return false;
        }

        entries.delete(matchId);
        acting.add(matchId);

        return true;
    };

    const leave = (turn: Turn, mover: Mover) =>
    {
        const random = seededRandom(hashOf(`${ deps.salt }:${ turn.matchId }:${ turn.rev }:leave`));

        schedule(turn, mover, LEAVE_LEAST + Math.floor(random() * LEAVE_SPREAD), async (current) =>
        {
            if (claim(turn.matchId, current))
            {
                await sent(turn, mover, null);
            }
        });
    };

    const decide = (turn: Turn, mover: Mover) =>
    {
        const engine = AI_ENGINES[turn.game];
        const random = seededRandom(hashOf(`${ deps.salt }:${ turn.matchId }:${ turn.rev }:${ mover.seat }`));
        const choices = engine.legal(turn.state, mover.seat).length;
        const delay = thinkTime({ game: turn.game, choices, leftMs: turn.leftMs, limitMs: turn.limitMs, clock: turn.clock, random, last });
        const budget = budgetOf(delay);
        let decision: Promise<Decided> = new Promise(() => undefined);

        last = delay;

        const current = schedule(turn, mover, delay, async (live) =>
        {
            const waited = await within(decision, Math.max(0, Math.min(budget + DECIDE_GRACE_MS, turn.leftMs - SAFETY_MS - delay)));

            if (waited instanceof Dropped)
            {
                // The match moved past this revision while the input was read: the slot is freed for the next look.
                if (live())
                {
                    entries.delete(turn.matchId);
                }

                return;
            }

            if (!claim(turn.matchId, live))
            {
                return;
            }

            if (waited instanceof Error)
            {
                failed(turn.game, turn.matchId, waited);
            }
            else if (waited !== null)
            {
                counted(waited);

                if (waited.play !== null)
                {
                    try
                    {
                        await sent(turn, mover, waited.play);

                        return;
                    }
                    catch (error)
                    {
                        failed(turn.game, turn.matchId, error);
                    }
                }
            }

            const cheap = fallbackOf(turn.game, turn.state, mover.seat);

            if (cheap !== null)
            {
                fallbacks += 1;
                await sent(turn, mover, cheap);
            }
        });

        decision = (async (): Promise<Decided> =>
        {
            const input = OPENNESS[turn.game] === 'open' ? turn.state : await source.hidden(turn.matchId, turn.rev, mover.seat);

            if (input === null || !current())
            {
                throw new Dropped('moved on');
            }

            return await brain.decide({
                game: turn.game,
                seat: mover.seat,
                format: turn.format,
                input,
                skill: mover.skill,
                style: mover.style,
                seed: hashOf(`${ deps.salt }:${ turn.matchId }:${ turn.rev }:${ mover.style }`),
                budget
            }, current);
        })();

        decision.catch(() => undefined);
    };

    const settle = (matchId: string, turn: Turn | null) =>
    {
        const held = entries.get(matchId);
        const who = turn === null ? null : whoActs(turn);

        if (turn === null || who === null)
        {
            held?.cancel();
            entries.delete(matchId);

            if (turn === null || turn.finished)
            {
                seen.delete(matchId);
            }
            else
            {
                seen.set(matchId, turn.rev);
            }

            return;
        }

        if (held !== undefined && held.rev === turn.rev && held.seat === who.mover.seat)
        {
            return;
        }

        held?.cancel();
        entries.delete(matchId);
        seen.delete(matchId);

        if (!who.leave && turn.leftMs <= 0 && !missed.has(`${ matchId }:${ turn.rev }`))
        {
            missed.add(`${ matchId }:${ turn.rev }`);
            failed(turn.game, matchId, new Error('A system seat reached its turn deadline.'));
        }

        if (who.leave)
        {
            leave(turn, who.mover);
        }
        else
        {
            decide(turn, who.mover);
        }
    };

    const consider = async (matchId: string): Promise<void> =>
    {
        if (!active)
        {
            return;
        }

        if (acting.has(matchId) || loading.has(matchId))
        {
            again.add(matchId);

            return;
        }

        loading.add(matchId);

        let turn: Turn | null = null;

        try
        {
            turn = await source.turnAt(matchId);
        }
        finally
        {
            loading.delete(matchId);
        }

        if (again.delete(matchId))
        {
            return await consider(matchId);
        }

        if (active)
        {
            settle(matchId, turn);
        }
    };

    /** Told after every committed action. Never throws and never waits: the move it follows is already the fact. */
    function moved(matchId: string)
    {
        void consider(matchId).catch((error: unknown) => failed('', matchId, error));
    }

    return {
        moved,

        /**
         * The backstop: live matches with a system seat where nothing here is scheduled and the
         * last look was at an older revision. The first call is also what switches the runtime on,
         * so a process that never sweeps (a CLI, a spec) never drives a seat.
         */
        drive: async (forMs: number) =>
        {
            active = true;

            const until = clock.now() + forMs;
            const due = await source.due(DUE_MOST);
            const listed = new Set(due.map((row) => row.matchId));
            let looked = 0;

            for (const id of [...seen.keys()])
            {
                if (!listed.has(id))
                {
                    seen.delete(id);
                }
            }

            for (const row of due)
            {
                if (clock.now() >= until)
                {
                    break;
                }

                if (entries.has(row.matchId) || acting.has(row.matchId) || loading.has(row.matchId) || seen.get(row.matchId) === row.rev)
                {
                    continue;
                }

                looked += 1;
                await consider(row.matchId).catch((error: unknown) => failed('', row.matchId, error));
            }

            if (missed.size > DUE_MOST * 4)
            {
                missed.clear();
            }

            const told = fresh;

            fresh = [];

            return { looked, scheduled: entries.size, errors: told };
        },

        figures: (): AiFigures => ({
            decisions,
            averageMs: decisions === 0 ? 0 : Math.round(totalMs / decisions),
            worstMs: Math.round(worstMs),
            fallbacks,
            errors: errors.map((one) => ({ ...one }))
        }),

        /** Whether a decision for this match is scheduled or being sent: for specs and the sweep. */
        busy: (matchId: string) => entries.has(matchId) || acting.has(matchId),

        stop: async () =>
        {
            active = false;

            for (const entry of entries.values())
            {
                entry.cancel();
            }

            entries.clear();
            await brain.stop();
        }
    };
}

export type AiRuntime = ReturnType<typeof createAiRuntime>;
