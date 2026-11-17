/**
 * What a system player's brain is, and what it is allowed to see.
 *
 * An agent is pure and synchronous: no I/O, no clock, no `Math.random`. It answers with the same
 * `MatchPlay` a client sends, and `match.act` is the only judge of whether that play is legal, so a
 * wrong agent is a refused move and never a corrupted game.
 *
 * Engines come in two classes, declared once in `OPENNESS`. An open game hides nothing from a seat,
 * so its agent is handed the engine state and may search with `engine.legal`/`engine.apply` and a
 * die of its own. A hidden game's agent is handed exactly what that seat's client receives - the
 * board composed for the seat and the log composed for the seat - and nothing else: never the
 * state, the draw seed or a raw event.
 */

import { backgammonEngine } from '../match/engines/backgammon.ts';
import { chessEngine } from '../match/engines/chess.ts';
import { hokmEngine } from '../match/engines/hokm.ts';
import { ludoEngine } from '../match/engines/ludo.ts';
import { pokerEngine } from '../match/engines/poker.ts';
import type { Draws, Engine } from '../match/engine.ts';
import type { Format } from '../match/sides.ts';
import type { MatchBoard, MatchLog, MatchPlay } from '../../schemas.ts';
import type { Skill } from '../system/rules.ts';

export interface Ask<I>
{
    seat: number;
    format: Format;

    /** The engine state (open games) or `{ view, log }` for this seat (hidden games). */
    input: I;
    skill: Skill;

    /** 0..999: shifts tastes a little so two system players do not play alike. */
    style: number;

    /** Seeded by the runtime; the only randomness an agent has. */
    random: () => number;

    /** Milliseconds since the decision began. */
    spent: () => number;

    /** Milliseconds it may use; an agent returns its best so far by then. */
    budget: number;
}

export interface Agent<I>
{
    id: string;
    version: number;
    decide(ask: Ask<I>): MatchPlay | null;
}

/** One entry of a seat's log, as `match.feed` composes it for that seat. */
export interface SeatLog
{
    rev: number;
    seat: number;
    log: MatchLog;
}

/** What a hidden game's agent is given: the seat's own board and the seat's own log. */
export interface Hidden<B extends MatchBoard = MatchBoard>
{
    view: B;
    log: SeatLog[];
}

export type Openness = 'open' | 'hidden';

export const OPENNESS: Readonly<Record<string, Openness>> = {
    chess: 'open',
    backgammon: 'open',
    ludo: 'open',
    hokm: 'hidden',
    poker: 'hidden'
};

/** The engines an agent may be built for, by game id. Not `ENGINES` from the match service, which would pull the database into the worker. */
export const AI_ENGINES: Readonly<Record<string, Engine>> = {
    chess: chessEngine as Engine,
    backgammon: backgammonEngine as Engine,
    ludo: ludoEngine as Engine,
    hokm: hokmEngine as Engine,
    poker: pokerEngine as Engine
};

/**
 * An agent's input for one seat. `logOf` is the seat's own composed log (the feed a seat's client
 * reads, `match.feed(...).events(seat)`); it is asked only for a hidden game.
 */
export function inputOf(game: string, state: unknown, seat: number, logOf: (seat: number) => readonly SeatLog[]): unknown
{
    const engine = AI_ENGINES[game];

    if (engine === undefined || OPENNESS[game] === undefined)
    {
        return null;
    }

    if (OPENNESS[game] === 'open')
    {
        return state;
    }

    const hidden: Hidden = {
        view: engine.view(state, seat),
        log: logOf(seat).map((entry) => ({ rev: entry.rev, seat: entry.seat, log: entry.log }))
    };

    return hidden;
}

/** xorshift32 over a 32-bit seed: the runtime seeds it, an agent draws from it. */
export function seededRandom(seed: number): () => number
{
    let state = (seed >>> 0) || 0x9e3779b9;

    return () =>
    {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;

        return (state >>> 0) / 4294967296;
    };
}

/** A die for an agent's own search, drawn from its seeded random. Never the match's draws. */
export const chanceOf = (random: () => number): Draws => ({ die: (sides) => 1 + Math.floor(random() * sides) });

/** A 32-bit FNV-1a hash, for seeding from text. */
export function hashOf(text: string)
{
    let hash = 0x811c9dc5;

    for (let at = 0; at < text.length; at += 1)
    {
        hash ^= text.charCodeAt(at);
        hash = Math.imul(hash, 0x01000193);
    }

    return hash >>> 0;
}

type Action = { kind: string } & Record<string, unknown>;

/**
 * An engine's own action as the play a client would send for it, or null for what is not a play
 * (a forfeit, a resignation). The inverse of each adapter's `parse`.
 */
export function playOf(game: string, action: unknown): MatchPlay | null
{
    if (typeof action !== 'object' || action === null)
    {
        return null;
    }

    const one = action as Action;

    if (game === 'chess')
    {
        if (one.kind === 'move')
        {
            return {
                kind: 'chess',
                verb: 'move',
                from: one.from as number,
                to: one.to as number,
                ...(one.promotion === undefined ? {} : { promotion: one.promotion as 'q' | 'r' | 'b' | 'n' })
            };
        }

        return one.kind === 'offer' || one.kind === 'accept' || one.kind === 'decline' || one.kind === 'flag' ? { kind: 'chess', verb: one.kind } : null;
    }

    if (game === 'hokm')
    {
        switch (one.kind)
        {
            case 'trump': return { kind: 'hokm', verb: 'trump', suit: one.suit as 'clubs' | 'diamonds' | 'hearts' | 'spades' };
            case 'card': return { kind: 'hokm', verb: 'card', card: one.card as number };
            case 'discard': return { kind: 'hokm', verb: 'discard', cards: [...(one.cards as number[])] };
            case 'keep':
            case 'reject': return { kind: 'hokm', verb: one.kind };
            default: return null;
        }
    }

    if (game === 'poker')
    {
        if (one.kind === 'raise')
        {
            return { kind: 'poker', verb: 'raise', amount: one.amount as number };
        }

        return one.kind === 'fold' || one.kind === 'check' || one.kind === 'call' || one.kind === 'allin' ? { kind: 'poker', verb: one.kind } : null;
    }

    if (game === 'backgammon')
    {
        if (one.kind === 'move')
        {
            return { kind: 'backgammon', verb: 'move', hops: (one.hops as { from: number; to: number }[]).map((hop) => ({ from: hop.from, to: hop.to })) };
        }

        return one.kind === 'roll' || one.kind === 'double' || one.kind === 'take' || one.kind === 'drop' ? { kind: 'backgammon', verb: one.kind } : null;
    }

    if (game === 'ludo')
    {
        if (one.kind === 'move')
        {
            return { kind: 'ludo', verb: 'move', piece: one.piece as number };
        }

        return one.kind === 'roll' ? { kind: 'ludo', verb: 'roll' } : null;
    }

    return null;
}

/** How wide a margin of near-equal choices an agent picks among, by skill: the weaker, the wider. */
export const MARGIN: Readonly<Record<Skill, number>> = {
    casual: 0.3,
    intermediate: 0.15,
    advanced: 0.06,
    'semi-pro': 0
};
