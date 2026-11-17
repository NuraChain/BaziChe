import { SUITS } from '../../match/cards/cards.ts';
import type { Skill } from '../../system/rules.ts';
import type { MatchPlay } from '../../../schemas.ts';
import type { Ask, Hidden } from '../agent.ts';
import { scoreCards, type Habits, type Scored } from './policy.ts';
import { weigh, type Limits, type Work } from './search.ts';
import { discardOf, keepScore, trumpByPlay, trumpByRule, type Taste } from './shape.ts';
import { seenOf, suitAt, type HokmBoard, type Seen, type Table } from './table.ts';

/**
 * How a hokm system player decides, by skill.
 *
 * - casual plays by rule of thumb and remembers only the trick in front of it;
 * - intermediate counts every card played and every void shown, and when few cards are left
 *   plays the ending out over the deals that remain possible;
 * - advanced plays every card out over deals consistent with everything seen, reading the other
 *   players' choices too: a card that could not win was their lowest, a trick let go to an opponent
 *   means no trump to take it;
 * - semi-pro does so over ten times the deals, proves a better card on less evidence, and leans the
 *   trump suit towards the Hâkem who named it.
 *
 * At two seats only the ending is played out (see `TWO_SEAT_ENDING`).
 *
 * None of them ever plays a card it believes is worse on purpose; a weaker one simply sees less and
 * thinks less, and picks among a wider margin of choices it judges near-equal.
 */

interface Level
{
    /** Remembers the cards played and the voids shown, beyond the trick on the table. */
    counts: boolean;
    finesse: boolean;
    shape: boolean;

    /** Deals per card decision; zero plays by the policy alone. */
    limits: Limits;

    /** Plays the ending out once its own hand is down to this many cards. */
    ending: number;

    /** Deals per trump decision at three and four seats; zero names trump by rule. */
    trumpSamples: number;

    /** Policy score points below the best a card may score and still be played: the near-equal choices it picks among. */
    ruleMargin: number;
}

const NONE: Limits = { samples: 0, nodes: 0, inferred: false, lean: false, proof: 0 };

export const LEVELS: Readonly<Record<Skill, Level>> = {
    casual: { counts: false, finesse: false, shape: false, limits: NONE, ending: 0, trumpSamples: 0, ruleMargin: 3 },
    intermediate: { counts: true, finesse: true, shape: true, limits: { samples: 16, nodes: 6000, inferred: false, lean: false, proof: 1 }, ending: 4, trumpSamples: 0, ruleMargin: 1 },
    advanced: { counts: true, finesse: true, shape: true, limits: { samples: 16, nodes: 16_000, inferred: true, lean: false, proof: 1 }, ending: 13, trumpSamples: 16, ruleMargin: 0.5 },
    'semi-pro': { counts: true, finesse: true, shape: true, limits: { samples: 200, nodes: 240_000, inferred: true, lean: true, proof: 0.7 }, ending: 13, trumpSamples: 40, ruleMargin: 0 }
};

/**
 * At two seats half the deck lies face down unseen, and playing a whole hand out over sampled deals
 * measured weaker than the counted rules (the deals cannot know which cards the opponent chose to
 * keep), so there only the ending is played out.
 */
const TWO_SEAT_ENDING = 4;

/** Draws thrown away before the first one is used. */
const WARM_UP = 8;

/** Playouts stop at this share of the budget; the rest is the answer's way back. */
const BUDGET_SHARE = 0.7;

/** Tastes from a style: each digit moves one taste a little either way. */
export function tastesOf(style: number): { habits: Omit<Habits, 'finesse'>; taste: Taste; keep: number }
{
    const digit = (place: number) => (Math.floor(Math.abs(style) / place) % 10) / 9;

    return {
        habits: { draw: 4 + Math.round(digit(1)), cash: 2 * digit(10), shed: 0.2 + 0.4 * digit(100) },
        taste: { length: 2.6 + 0.8 * digit(10) },
        keep: (digit(1) - 0.5) * 0.3
    };
}

/** The table a casual player plays from: nothing remembered but the trick in front of it. */
function forgetful(table: Table): Table
{
    const gone = [0, 0, 0, 0];

    for (const card of table.trick)
    {
        gone[suitAt(card)] |= 1 << (card % 13);
    }

    return { ...table, gone, voids: table.voids.map(() => 0), led: table.led.map(() => 0) };
}

/** One choice among those within `margin` of the best, the nearer the likelier. Deterministic for a seed. */
function chosen(scored: Scored, margin: number, random: () => number): number
{
    const top = Math.max(...scored.scores);
    const near = scored.cards
        .map((card, at) => ({ card, score: scored.scores[at] }))
        .filter((one) => one.score >= top - margin - 1e-9)
        .sort((a, b) => b.score - a.score || a.card - b.card);

    if (near.length === 1 || margin <= 0)
    {
        return near[0].card;
    }

    const weights = near.map((one) => 1 + margin - (top - one.score));
    let pick = random() * weights.reduce((sum, weight) => sum + weight, 0);

    for (let at = 0; at < near.length; at += 1)
    {
        pick -= weights[at];

        if (pick < 0)
        {
            return near[at].card;
        }
    }

    return near[near.length - 1].card;
}

export interface Thought
{
    play: MatchPlay | null;
    work: Work;
}

function cardOf(seen: Seen, level: Level, habits: Habits, ask: Ask<Hidden<HokmBoard>>, work: Work, plays: readonly number[]): number
{
    const table = level.counts ? seen.table : forgetful(seen.table);
    const ruled = scoreCards(table, seen.hand, seen.seat, habits);

    // The engine's own legal cards are the only candidates.
    const legal = ruled.cards.filter((card) => plays.includes(card));
    const rules: Scored = legal.length === ruled.cards.length
        ? ruled
        : { cards: [...plays], scores: plays.map((card) => ruled.scores[ruled.cards.indexOf(card)] ?? -100) };

    if (rules.cards.length === 1)
    {
        return rules.cards[0];
    }

    const usual = chosen(rules, level.ruleMargin, ask.random);

    const ending = seen.table.seats === 2 ? Math.min(level.ending, TWO_SEAT_ENDING) : level.ending;

    if (level.limits.samples === 0 || seen.hand.length > ending)
    {
        return usual;
    }

    const stop = () => ask.spent() >= ask.budget * BUDGET_SHARE;
    const values = weigh(seen, rules.cards, rules.cards.indexOf(usual), habits, level.limits, ask.random, stop, work);

    if (values === null)
    {
        return usual;
    }

    // The policy's own preference breaks a tie the playouts cannot see.
    return chosen({ cards: rules.cards, scores: values.map((value, at) => value + 0.0001 * rules.scores[at]) }, 0, ask.random);
}

/** A decision and the work it took. Pure: the same ask gives the same answer. */
export function think(ask: Ask<Hidden<HokmBoard>>): Thought
{
    const view = ask.input.view;
    const level = LEVELS[ask.skill] ?? LEVELS.intermediate;
    const tastes = tastesOf(ask.style);
    const habits: Habits = { ...tastes.habits, finesse: level.finesse };
    const work: Work = { samples: 0, nodes: 0 };
    const answer = (play: MatchPlay | null): Thought => ({ play, work });

    // A shift-register generator seeded with a small number starts with a run of tiny draws; let it mix first.
    for (let draw = 0; draw < WARM_UP; draw += 1)
    {
        ask.random();
    }

    if (view.phase === 'trump')
    {
        if (view.hakem !== ask.seat || view.hand.length === 0)
        {
            return answer(null);
        }

        const seen = seenOf(ask.input, ask.seat);
        const stop = () => ask.spent() >= ask.budget * BUDGET_SHARE;
        const suit = level.trumpSamples > 0 && view.seats.length > 2
            ? trumpByPlay(seen.table, seen.hand, ask.seat, habits, tastes.taste, level.trumpSamples, ask.random, stop, work)
            : trumpByRule(view.hand, level.shape, tastes.taste);

        return answer({ kind: 'hokm', verb: 'trump', suit: SUITS[suit] });
    }

    if (view.turn !== ask.seat || view.trump === undefined)
    {
        return answer(null);
    }

    const trump = SUITS.indexOf(view.trump);

    if (view.phase === 'discard')
    {
        const count = view.discard ?? 0;

        if (count < 1 || view.hand.length < count)
        {
            return answer(null);
        }

        return answer({ kind: 'hokm', verb: 'discard', cards: discardOf(view.hand, count, trump, level.shape) });
    }

    if (view.phase === 'draw')
    {
        if (view.offer === undefined)
        {
            return answer(null);
        }

        const dead = view.glimpse === undefined ? [] : [view.glimpse];
        const lean = level.shape ? tastes.keep * 0.3 : 0;

        return answer({ kind: 'hokm', verb: keepScore(view.hand, view.offer, dead, trump, level.shape) + lean >= 0 ? 'keep' : 'reject' });
    }

    if (view.plays.length === 0)
    {
        return answer(null);
    }

    const seen = seenOf(ask.input, ask.seat);

    return answer({ kind: 'hokm', verb: 'card', card: cardOf(seen, level, habits, ask, work, view.plays) });
}
