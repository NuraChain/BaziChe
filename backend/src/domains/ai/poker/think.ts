import type { Skill } from '../../system/rules.ts';
import type { MatchPlay } from '../../../schemas.ts';
import { MARGIN, type Ask, type Hidden } from '../agent.ts';
import { equityOf, pushWorth, type Answered, type Caller, type Dealt, type FoldOf, type Keeps, type Limits, type Opponent, type Work } from './equity.ts';
import { holdingOf, type Holding } from './hand.ts';
import { ANY, openShare, placeOf, pushShare, speculative, type Range } from './preflop.ts';
import { readOf, type Act, type Habit, type PokerBoard, type Reading } from './read.ts';

/**
 * How a poker system player decides, by skill.
 *
 * - casual plays a tight chart before the flop and its made hand after it, against the price of a
 *   call; it bets and raises only with strong hands and never bluffs;
 * - intermediate opens by position, pushes or folds when short, and plays every street on its
 *   share of the pot measured over sampled deals against rough ranges, choosing among fold, call
 *   and raise by what each is worth;
 * - advanced reads each opponent's range from how it played the hand (an open, a call, a re-raise,
 *   a short all-in; bets since the flop narrow it), continuation-bets, semi-bluffs its draws, counts
 *   implied odds and moves its stack in when it is committed;
 * - semi-pro also reads how each opponent has played this match (how often it enters pots, raises,
 *   bets and folds to a bet), weighs a short all-in against the hands the players behind would call
 *   it with instead of a chart, and sizes its bets from a wider choice, over more deals.
 *
 * Semi-pro also reads how a bet of each size is answered off the same deals (what each opponent was
 * dealt and whether that folds to the price), which is what its sizing chooses by; the others guess
 * it from the price alone.
 *
 * None of them ever picks a play it judges worse on purpose; a weaker one sees less and thinks
 * less, and picks among a wider margin of plays it judges near-equal.
 */

interface Level
{
    /** Deals played out per decision before and after the flop; zero plays by chart. */
    preflop: number;
    postflop: number;

    /** Hands evaluated per decision at most. */
    nodes: number;

    /** Opens by position rather than one fixed share. */
    position: boolean;

    /** How opponents' ranges are read: not at all, from whether they raised, or from the whole hand. */
    ranges: 'none' | 'rough' | 'full';

    /** Narrows ranges by the betting since the flop. */
    narrow: boolean;

    /** How far this match's own record of each opponent moves its range (0 = not at all, 1 = fully). */
    habits: number;

    /** Reads how each bet is answered off the sampled deals, rather than guessing it from the price. */
    reads: boolean;

    cbet: boolean;
    semibluff: boolean;

    /** Moves all in rather than leave a stack too small to play, and weighs implied odds. */
    stacks: boolean;

    /** Bet sizes as shares of the pot, and raise sizes as shares of the pot after a call. */
    bets: readonly number[];
    raises: readonly number[];

    /** At this many big blinds or fewer it pushes or folds before the flop. */
    push: number;

    /** Deals a first all-in is weighed over against the players behind; zero pushes by chart. */
    pushes: number;
}

export const LEVELS: Readonly<Record<Skill, Level>> = {
    casual: { preflop: 0, postflop: 0, nodes: 0, position: false, ranges: 'none', narrow: false, habits: 0, reads: false, cbet: false, semibluff: false, stacks: false, bets: [0.6], raises: [1], push: 8, pushes: 0 },
    intermediate: { preflop: 80, postflop: 160, nodes: 1600, position: true, ranges: 'rough', narrow: false, habits: 0, reads: false, cbet: false, semibluff: false, stacks: false, bets: [0.66], raises: [1], push: 11, pushes: 0 },
    advanced: { preflop: 120, postflop: 260, nodes: 4000, position: true, ranges: 'full', narrow: true, habits: 0, reads: false, cbet: true, semibluff: true, stacks: true, bets: [0.5, 0.75], raises: [0.7], push: 12, pushes: 0 },
    'semi-pro': { preflop: 500, postflop: 1500, nodes: 25000, position: true, ranges: 'full', narrow: true, habits: 1, reads: true, cbet: true, semibluff: true, stacks: true, bets: [0.33, 0.5, 0.75, 1], raises: [0.6, 1], push: 12, pushes: 400 }
};

/** Sampling stops at this share of the budget; the rest is the answer's way back. */
const BUDGET_SHARE = 0.6;

/** A shift-register generator seeded with a small number starts with a run of tiny draws; let it mix first. */
const WARM_UP = 8;

/** How often a guessed answer folds, against the rate that makes a call break even. */
const GUESSED_FOLDS = 0.5;

export interface Taste
{
    /** Multiplies the shares it opens and pushes with. */
    loose: number;

    /** Multiplies how often it expects a bet to take the pot. */
    fold: number;

    /** How often it bluffs a river it cannot win. */
    bluff: number;

    /** Multiplies its bet sizes. */
    size: number;
}

/** Small differences in taste from the style number, so two system players do not play alike. */
export function tasteOf(style: number): Taste
{
    const aggression = (Math.max(0, Math.min(999, style)) / 999) * 2 - 1;
    const risk = (((style * 37) % 1000) / 999) * 2 - 1;

    return { loose: 1 + 0.12 * aggression, fold: 1 + 0.08 * aggression, bluff: 0.06 + 0.04 * aggression, size: 1 + 0.1 * risk };
}

export interface Thought
{
    play: MatchPlay | null;
    work: Work;
}

/** Everything a decision reads off the table, worked out once. */
interface Spot
{
    view: PokerBoard;
    seat: number;
    hole: readonly number[];
    board: readonly number[];
    preflop: boolean;
    pot: number;
    owe: number;
    stack: number;
    bet: number;

    /** The bet to match this street. */
    current: number;
    big: number;
    low: number | null;
    high: number | null;

    /** Seats still in the hand besides this one, and those of them with chips left to act. */
    rivals: number[];
    responders: number[];

    alive: number;
    headsUp: boolean;

    /** Effective stack in big blinds. */
    depth: number;

    /** Seats still to act behind before the flop, the big blind included. */
    behind: number;
    inPosition: boolean;
    reading: Reading;

    /** This hand's acts; when the log does not reach back to the deal, the raises the bets show. */
    acts: Act[];
}

interface Option
{
    play: MatchPlay;
    worth: number;
}

const poker = (verb: 'fold' | 'check' | 'call' | 'allin'): MatchPlay => ({ kind: 'poker', verb });

const total = (view: PokerBoard, seat: number) => view.seats[seat].stack + view.seats[seat].bet;

/** Seats from just after `from` up to and including `to`, that are still in the match. */
function between(view: PokerBoard, from: number, to: number)
{
    const count = view.seats.length;
    let seats = 0;

    for (let step = 1; step <= count; step += 1)
    {
        const seat = (from + step) % count;

        if (seat === from)
        {
            break;
        }

        seats += view.seats[seat].out ? 0 : 1;

        if (seat === to)
        {
            break;
        }
    }

    return from === to ? 0 : seats;
}

/** Before the flop with the log not reaching back to the deal, the raises the bets in front of each seat show, smallest first. */
function guessedActs(view: PokerBoard, big: number): Act[]
{
    if (view.board.length >= 3)
    {
        return [];
    }

    return view.seats
        .filter((one) => !one.out && !one.folded && one.bet > big)
        .sort((a, b) => a.bet - b.bet)
        .map((one) => ({ seat: one.seat, verb: one.stack === 0 ? 'allin' : 'raise', street: 'preflop', amount: one.bet, aggressive: true, facing: false }));
}

function spotOf(ask: Ask<Hidden<PokerBoard>>): Spot
{
    const view = ask.input.view;
    const seat = ask.seat;
    const reading = readOf(ask.input);
    const rivals = view.seats.filter((one) => one.seat !== seat && !one.folded && !one.out).map((one) => one.seat);
    const responders = rivals.filter((one) => view.seats[one].stack > 0);
    const alive = view.seats.filter((one) => !one.out).length;
    const big = Math.max(1, view.blinds.big);
    const widest = Math.max(0, ...rivals.map((one) => total(view, one)));
    const count = view.seats.length;
    const order = (one: number) => (one - view.button - 1 + count) % count;

    return {
        view,
        seat,
        hole: view.hole,
        board: view.board,
        preflop: view.board.length < 3,
        pot: view.pot,
        owe: view.toCall ?? 0,
        stack: view.seats[seat].stack,
        bet: view.seats[seat].bet,
        current: Math.max(...view.seats.map((one) => one.bet)),
        big,
        low: view.minRaiseTo ?? null,
        high: view.maxRaiseTo ?? null,
        rivals,
        responders,
        alive,
        headsUp: alive === 2,
        depth: Math.min(total(view, seat), widest) / big,
        behind: between(view, seat, reading.bb),
        inPosition: responders.every((one) => order(seat) > order(one)),
        reading,
        acts: reading.acts ?? guessedActs(view, big)
    };
}

/** A raise to `to`, made legal: inside the board's own bounds, and all in when it reaches the top. */
function raiseTo(spot: Spot, to: number, jam: boolean): MatchPlay | null
{
    if (spot.low === null || spot.high === null)
    {
        return null;
    }

    const amount = Math.min(spot.high, Math.max(spot.low, Math.round(to)));
    const after = spot.pot + (amount - spot.bet) + (amount - spot.current);

    // A raise that would leave too little behind to play a later street is better made all in.
    if (amount >= spot.high || (jam && spot.high - amount < after * 0.35))
    {
        return poker('allin');
    }

    return { kind: 'poker', verb: 'raise', amount };
}

/** A raise worth weighing: the play, the chips it really risks and draws (no more than the deepest opponent can match), and how hard it presses whoever must answer it. */
interface Raise
{
    play: MatchPlay;
    invest: number;
    price: number;

    /** What calling it costs an opponent as a share of the pot after the call. */
    pressure: number;
}

function raisesOf(spot: Spot, plays: readonly (MatchPlay | null)[]): Raise[]
{
    const deepest = Math.max(spot.current, ...spot.rivals.map((one) => total(spot.view, one)));
    const raises: Raise[] = [];

    for (const play of plays)
    {
        if (play === null || play.kind !== 'poker' || raises.some((one) => JSON.stringify(one.play) === JSON.stringify(play)))
        {
            continue;
        }

        const to = Math.min(play.verb === 'raise' ? (play.amount as number) : spot.bet + spot.stack, deepest);
        const invest = Math.max(0, to - spot.bet);
        const price = Math.max(0, to - spot.current);

        raises.push({ play, invest, price, pressure: price / Math.max(1, spot.pot + invest + price) });
    }

    return raises;
}

interface Judged
{
    equity: number;
    realize: number;

    /** Chips added to a call for what a made draw wins later. */
    implied: number;

    /** Taken off every play that risks much of the stack while someone else is nearly out. */
    caution: number;

    /** How each raise is answered, in the order of the raises. */
    answers: readonly Answered[];
}

/**
 * How a raise is answered when the deals are not read for it: a fold as often as its price makes a
 * call break even, scaled by `folds`, and a share when called that shrinks as the price grows (a
 * draw's share hardly shrinks: what calls a bet does not stop it arriving).
 */
function guessedAnswers(spot: Spot, equity: number, raises: readonly Raise[], folds: (seat: number) => number, drawing: boolean): Answered[]
{
    const shoved = spot.rivals.some((one) => spot.view.seats[one].stack === 0);

    return raises.map((raise) =>
    {
        let all = shoved ? 0 : 1;

        for (const one of spot.responders)
        {
            all *= Math.min(0.35, GUESSED_FOLDS * folds(one) * raise.pressure * 2);
        }

        return { folds: all, called: drawing ? equity * 0.97 : Math.pow(equity, 1 + 1.6 * raise.pressure) };
    });
}

/** The chance a hand folds to a bet, by its class on the board, or before the flop by where it sits in its range. */
export function foldChance(dealt: Dealt, pressure: number, scale: number)
{
    const clamp = (value: number) => Math.max(0, Math.min(0.97, value * scale));

    if (dealt.holding === null)
    {
        // Before the flop a player goes on with the best hands, fewer the more it costs, whatever range it came in with.
        const continues = Math.max(0.08, Math.min(0.8, (0.95 - 1.7 * pressure) / scale));

        return dealt.place > continues ? 1 : 0;
    }

    switch (dealt.holding.made)
    {
        case 'strong': return 0;
        case 'pair': return dealt.holding.top ? clamp(-0.2 + 0.8 * pressure) : clamp(1.2 * pressure);
        case 'draw': return clamp(-0.15 + 1.4 * pressure);
        default: return clamp(0.35 + 1.6 * pressure);
    }
}

/** What every play is worth in chips from now: what it wins from the pot, less what it puts in. */
function weigh(spot: Spot, judged: Judged, raises: readonly Raise[]): Option[]
{
    const { equity, realize } = judged;
    const closing = spot.owe >= spot.stack || spot.responders.length === 0;
    const kept = closing ? 1 : realize;
    const risked = (chips: number) => (chips > (spot.stack + spot.bet) * 0.35 ? judged.caution * chips : 0);
    const options: Option[] = [];

    if (spot.owe === 0)
    {
        options.push({ play: poker('check'), worth: equity * spot.pot * kept });
    }
    else
    {
        options.push({ play: poker('fold'), worth: 0 });
        options.push({ play: poker('call'), worth: equity * kept * (spot.pot + spot.owe) - spot.owe + (closing ? 0 : judged.implied) - risked(spot.owe) });
    }

    raises.forEach((raise, at) =>
    {
        const { folds, called } = judged.answers[at];

        options.push({
            play: raise.play,
            worth: folds * spot.pot + (1 - folds) * (called * (spot.pot + raise.invest + raise.price) - raise.invest) - risked(raise.invest)
        });
    });

    return options;
}

/** The best play, or one of those within the skill's margin of it (a share of the pot). */
function choose(options: readonly Option[], spot: Spot, skill: Skill, random: () => number): MatchPlay
{
    const best = Math.max(...options.map((one) => one.worth));
    const margin = MARGIN[skill] * 0.25 * Math.max(spot.pot, spot.big);
    const near = options.filter((one) => one.worth >= best - margin - 1e-9);

    return near.length === 1 ? near[0].play : near[Math.min(near.length - 1, Math.floor(random() * near.length))].play;
}

/** How often a regular enters pots and raises before the flop, by how many are still in the match. */
const REGULAR: readonly { entered: number; raised: number }[] = [
    { entered: 0.7, raised: 0.5 },
    { entered: 0.7, raised: 0.5 },
    { entered: 0.7, raised: 0.5 },
    { entered: 0.4, raised: 0.25 },
    { entered: 0.35, raised: 0.2 },
    { entered: 0.25, raised: 0.15 }
];

/** What an opponent's play this match says of it, blended towards a regular's by the weight of evidence. */
function habitOf(habit: Habit | undefined, weight: number, alive: number)
{
    if (habit === undefined || weight <= 0)
    {
        return { loose: 1, raises: 1, bluffs: 1, folds: 1 };
    }

    // A regular's numbers, counted as if seen over this many hands, bets and calls: the less weight, the more evidence it takes to move.
    const usual = REGULAR[Math.min(alive, REGULAR.length - 1)];
    const prior = 12 / weight;
    const acts = 6 / weight;
    const entered = (habit.entered + usual.entered * prior) / (habit.hands + prior);
    const raised = (habit.raised + usual.raised * prior) / (habit.hands + prior);
    const aggression = (habit.pushed + 0.8 * acts) / (habit.called + acts);
    const folded = (habit.folded + 0.4 * acts) / (habit.faced + acts);

    return {
        loose: Math.max(0.6, Math.min(2.2, entered / usual.entered)),
        raises: Math.max(0.5, Math.min(2.5, raised / usual.raised)),
        bluffs: Math.max(0.4, Math.min(1.5, aggression / 0.8)),
        folds: Math.max(0.2, Math.min(1.6, folded / 0.4))
    };
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/** The preflop slice an opponent's own betting this hand says it holds. */
function rangeOf(spot: Spot, rival: number, level: Level): Range
{
    if (level.ranges === 'none')
    {
        return ANY;
    }

    const preflop = spot.acts.filter((act) => act.street === 'preflop');
    const own = preflop.filter((act) => act.seat === rival);
    const habit = habitOf(spot.reading.habits[rival], level.habits, spot.alive);
    const raised = own.filter((act) => act.aggressive);
    const last = own[own.length - 1];

    if (spot.reading.acts === null && !spot.preflop)
    {
        return { low: 0, high: 0.6 };
    }

    if (raised.length > 0)
    {
        const mine = raised[raised.length - 1];
        const index = preflop.filter((act) => act.aggressive).indexOf(mine);
        const limped = preflop.slice(0, preflop.indexOf(mine)).some((act) => act.verb === 'call');
        const allin = mine.verb === 'allin' && spot.view.seats[rival].stack === 0;

        if (level.ranges === 'rough')
        {
            return { low: 0, high: index === 0 ? (allin ? 0.3 : 0.2) : 0.07 };
        }

        if (index === 0)
        {
            const depth = total(spot.view, rival) / spot.big;
            const share = allin && depth <= 20
                ? pushShare(between(spot.view, rival, spot.reading.bb), depth)
                : openShare(between(spot.view, rival, spot.reading.bb), spot.headsUp) * (limped ? 0.75 : 1);

            return { low: 0, high: clamp01(share * habit.raises) };
        }

        return { low: 0, high: clamp01((index === 1 ? (allin ? 0.1 : 0.07) : 0.035) * habit.raises) };
    }

    if (last !== undefined && last.verb === 'call')
    {
        const before = preflop.slice(0, preflop.indexOf(last)).filter((act) => act.aggressive).length;

        if (level.ranges === 'rough')
        {
            return { low: 0, high: before >= 2 ? 0.1 : 0.5 };
        }

        if (before === 0)
        {
            return { low: 0.04, high: clamp01((rival === spot.reading.sb ? 0.75 : 0.5) * habit.loose) };
        }

        if (before >= 2)
        {
            return { low: 0.01, high: clamp01(0.09 * habit.loose) };
        }

        return { low: 0.02, high: clamp01((rival === spot.reading.bb ? 0.55 : 0.25) * habit.loose) };
    }

    return ANY;
}

/** What an opponent's betting since the flop keeps of the hands its range deals it. */
function keepsOf(spot: Spot, rival: number, level: Level): Keeps | null
{
    if (!level.narrow || spot.preflop)
    {
        return null;
    }

    const street = spot.view.street;
    const own = spot.acts.filter((act) => act.seat === rival && act.street !== 'preflop');
    const pushed = own.filter((act) => act.street === street && act.aggressive).length;
    const bluffs = 0.2 * habitOf(spot.reading.habits[rival], level.habits, spot.alive).bluffs;

    if (pushed >= 2)
    {
        return { strong: 1, pair: 0.3, draw: 0.25, air: bluffs * 0.35 };
    }

    if (pushed === 1)
    {
        return { strong: 1, pair: 0.8, draw: 0.55, air: bluffs };
    }

    if (own.some((act) => act.verb === 'call'))
    {
        return { strong: 0.75, pair: 1, draw: 0.85, air: 0.3 };
    }

    return own.some((act) => act.street === street && act.verb === 'check') ? { strong: 0.6, pair: 0.95, draw: 1, air: 1 } : null;
}

/** Someone other than this seat is close to going out while this seat is not: losing chips costs more than winning them gains. */
function cautionOf(spot: Spot, skill: Skill)
{
    if (skill === 'casual' || spot.alive < 3)
    {
        return 0;
    }

    const mine = total(spot.view, spot.seat);
    const short = spot.view.seats.some((one) => one.seat !== spot.seat && !one.out && one.stack + one.bet <= spot.big * 3 && mine > 2 * (one.stack + one.bet));

    return short ? 0.05 : 0;
}

/** Casual's share of the pot without sampling: what its made hand is usually worth. */
function guessOf(spot: Spot, holding: Holding)
{
    const alone = holding.made === 'strong' ? 0.85
        : holding.made === 'pair' ? (holding.top ? 0.65 : 0.45)
            : holding.made === 'draw' ? (spot.view.street === 'flop' ? 0.35 : 0.2)
                : 0.12;

    return Math.pow(alone, 1 + 0.5 * (spot.rivals.length - 1));
}

/**
 * The seat's share and how each raise is answered. Semi-pro reads the answers off the same deals
 * (who folds what it was dealt); the others guess them from the price alone.
 */
function judge(
    spot: Spot,
    level: Level,
    opponents: readonly Opponent[],
    samples: number,
    raises: readonly Raise[],
    folds: (seat: number) => number,
    drawing: boolean,
    ask: Ask<Hidden<PokerBoard>>,
    work: Work,
    seats: readonly number[]
): { equity: number; answers: Answered[] }
{
    const limits: Limits = { samples, nodes: level.nodes };
    const stop = () => ask.spent() >= ask.budget * BUDGET_SHARE;
    const foldOf: FoldOf | null = level.reads ? (index, dealt, pressure) => foldChance(dealt, pressure, folds(seats[index])) : null;
    const sampled = equityOf(spot.hole, spot.board, opponents, limits, ask.random, stop, work, raises.map((raise) => raise.pressure), foldOf);

    return {
        equity: sampled.equity,
        answers: level.reads ? sampled.bets : guessedAnswers(spot, sampled.equity, raises, folds, drawing)
    };
}

/** The open raise in big blinds: smaller late and heads-up for the stronger players. */
function openSize(spot: Spot, skill: Skill)
{
    if (skill === 'casual')
    {
        return 3;
    }

    if (skill === 'intermediate')
    {
        return 2.5;
    }

    if (spot.headsUp || spot.behind <= 2)
    {
        return spot.seat === spot.reading.sb && !spot.headsUp ? 3 : 2.2;
    }

    return skill === 'semi-pro' && spot.behind <= 3 ? 2.3 : 2.5;
}

/** What moving all in first is worth, against the hands the players behind would call it with. */
function pushed(spot: Spot, level: Level, caution: number, ask: Ask<Hidden<PokerBoard>>, work: Work)
{
    const mine = total(spot.view, spot.seat);
    const callers: Caller[] = spot.responders.map((one) =>
    {
        const theirs = total(spot.view, one);
        const price = Math.min(theirs, mine) - spot.view.seats[one].bet;
        const matched = Math.min(theirs, mine) - spot.bet;

        return { price, matched, needs: price / Math.max(1, spot.pot + matched + price) };
    });

    return pushWorth(spot.hole, spot.pot, callers, { samples: level.pushes, nodes: level.nodes }, ask.random, work) - caution * spot.stack;
}

function preflop(spot: Spot, level: Level, skill: Skill, taste: Taste, ask: Ask<Hidden<PokerBoard>>, work: Work): MatchPlay
{
    const place = placeOf(spot.hole[0], spot.hole[1]);
    const raised = spot.current > spot.big;
    const limpers = spot.acts.filter((act) => act.street === 'preflop' && act.verb === 'call' && act.seat !== spot.reading.sb).length;
    const pass = spot.owe === 0 ? poker('check') : poker('fold');
    const shove = spot.low !== null ? poker('allin') : spot.owe > 0 ? poker('call') : poker('check');
    const caution = cautionOf(spot, skill);

    if (!raised)
    {
        if (spot.depth <= level.push)
        {
            if (level.pushes > 0 && spot.owe > 0 && spot.low !== null)
            {
                return pushed(spot, level, caution, ask, work) > 0 ? shove : pass;
            }

            const share = pushShare(level.position ? spot.behind : 4, spot.depth) * taste.loose * (skill === 'casual' ? 0.8 : 1) * (caution > 0 ? 0.8 : 1);

            return place <= share ? shove : pass;
        }

        const share = (level.position ? openShare(spot.behind, spot.headsUp) : spot.headsUp ? 0.25 : 0.1) * taste.loose * (caution > 0 ? 0.85 : 1);
        const open = share * (limpers > 0 ? 0.7 : 1);

        if (place <= open)
        {
            return raiseTo(spot, spot.big * (openSize(spot, skill) + limpers), level.stacks) ?? shove;
        }

        if (spot.owe === 0)
        {
            return poker('check');
        }

        const completes = spot.seat === spot.reading.sb && place <= (spot.headsUp ? 0.95 : skill === 'casual' ? 0.3 : 0.55);
        const limps = (limpers > 0 || skill === 'casual') && spot.depth > 20 && place <= (skill === 'casual' ? 0.22 : share * 1.5);

        return completes || limps ? poker('call') : poker('fold');
    }

    const priced = spot.owe / Math.max(1, spot.pot + spot.owe);

    if (level.preflop === 0)
    {
        if (place <= 0.025)
        {
            return raiseTo(spot, spot.current * 3, true) ?? (spot.owe > 0 ? poker('call') : poker('check'));
        }

        const allIn = spot.owe >= spot.stack || spot.rivals.some((one) => spot.view.seats[one].stack === 0);
        const reach = allIn ? 0.04 + 0.25 * Math.max(0, 0.45 - priced) : 0.1 + (priced < 0.3 ? 0.08 : 0);

        return place <= reach * taste.loose ? poker('call') : pass;
    }

    // Too poor a hand at too high a price is not worth dealing out.
    if (spot.owe > 0 && place > 0.75 && priced > 0.2)
    {
        return poker('fold');
    }

    const preflopActs = spot.acts.filter((act) => act.street === 'preflop');
    const aggressors = spot.rivals.filter((one) => preflopActs.some((act) => act.seat === one && act.aggressive));
    const callers = spot.rivals.filter((one) => !aggressors.includes(one) && preflopActs.some((act) => act.seat === one && act.verb === 'call'));
    const named = aggressors.length > 0 ? [...aggressors, ...callers] : spot.rivals.filter((one) => spot.view.seats[one].bet >= spot.current);
    const facing = (named.length > 0 ? named : spot.rivals).slice(0, 2);
    const reraises = preflopActs.filter((act) => act.aggressive).length;
    const deep = level.stacks && spot.depth > 30 && speculative(spot.hole[0], spot.hole[1]);
    const size = (spot.inPosition ? 3 : 3.5) + callers.length;

    const raises = spot.low === null ? [] : raisesOf(spot, [
        spot.depth <= level.push * 1.6 ? poker('allin') : raiseTo(spot, spot.current * (reraises >= 2 ? 2.3 : size), level.stacks),
        spot.depth <= 30 || (level.stacks && reraises >= 2) ? poker('allin') : null
    ]);

    const folds = (one: number) => taste.fold / habitOf(spot.reading.habits[one], level.habits, spot.alive).loose;
    const opponents = facing.map((one) => ({ range: rangeOf(spot, one, level), keeps: null, answers: spot.view.seats[one].stack > 0 }));
    const { equity, answers } = judge(spot, level, opponents, level.preflop, raises, folds, false, ask, work, facing);

    const judged: Judged = {
        equity,
        realize: (spot.inPosition ? 0.95 : 0.85) * (facing.length >= 2 ? 0.95 : 1) + (deep ? 0.08 : 0),
        implied: 0,
        caution,
        answers
    };

    return choose(weigh(spot, judged, raises), spot, skill, ask.random);
}

function postflop(spot: Spot, level: Level, skill: Skill, taste: Taste, ask: Ask<Hidden<PokerBoard>>, work: Work): MatchPlay
{
    const holding = holdingOf(spot.hole, spot.board);
    const casual = level.postflop === 0;
    const street = spot.view.street;
    const leading = spot.acts.filter((act) => act.street === 'preflop' && act.aggressive).at(-1)?.seat === spot.seat;
    const cbet = level.cbet && leading && street === 'flop' && spot.owe === 0 && spot.rivals.length <= 2;
    const raisedHere = (one: number) => spot.acts.some((act) => act.seat === one && act.street === street && act.aggressive);
    const folds = (one: number) => taste.fold * (cbet ? 1.1 : 1) * (raisedHere(one) ? 0.6 : 1) * habitOf(spot.reading.habits[one], level.habits, spot.alive).folds;
    const drawing = level.semibluff && holding.draw && holding.made !== 'strong';
    const plays: (MatchPlay | null)[] = [];

    if (spot.low !== null && (!casual || holding.made === 'strong'))
    {
        for (const share of spot.owe === 0 ? level.bets : level.raises)
        {
            plays.push(raiseTo(spot, spot.current + share * taste.size * (spot.pot + spot.owe), level.stacks));
        }

        // All in only once the stack is small against the pot: a big overbet risks the stack to win a small pot.
        if (level.stacks && spot.stack <= 2.5 * (spot.pot + spot.owe))
        {
            plays.push(poker('allin'));
        }
    }

    const raises = raisesOf(spot, plays);
    let equity: number;
    let answers: Answered[];

    if (casual)
    {
        equity = guessOf(spot, holding);
        answers = guessedAnswers(spot, equity, raises, folds, false);
    }
    else
    {
        const opponents = spot.rivals.map((one) => ({ range: rangeOf(spot, one, level), keeps: keepsOf(spot, one, level), answers: spot.view.seats[one].stack > 0 }));

        ({ equity, answers } = judge(spot, level, opponents, level.postflop, raises, folds, drawing, ask, work, spot.rivals));
    }

    // A small, style-shifted share of rivers it cannot win are bet as if it could.
    if (!casual && street === 'river' && spot.owe === 0 && spot.rivals.length === 1 && equity < 0.2 && spot.low !== null)
    {
        const story = level.cbet && spot.acts.some((act) => act.seat === spot.seat && act.aggressive) ? 0.04 : 0;

        if (ask.random() < taste.bluff + story)
        {
            return raiseTo(spot, spot.current + spot.pot * 0.66 * taste.size, level.stacks) ?? poker('check');
        }
    }

    const behind = Math.min(spot.stack - spot.owe, Math.max(0, ...spot.rivals.map((one) => spot.view.seats[one].stack)));

    const judged: Judged = {
        equity,
        realize: (spot.inPosition ? 1 : 0.9) * (spot.rivals.length >= 2 ? 0.95 : 1),
        implied: level.stacks && holding.draw && street !== 'river' ? 0.12 * Math.min(behind, spot.pot + spot.owe) : 0,
        caution: cautionOf(spot, skill),
        answers
    };

    return choose(weigh(spot, judged, raises), spot, skill, ask.random);
}

/** A decision and the work it took. Pure: the same ask gives the same answer. */
export function think(ask: Ask<Hidden<PokerBoard>>): Thought
{
    const work: Work = { samples: 0, nodes: 0 };
    const view = ask.input.view;

    if (view.turn !== ask.seat || view.winner !== undefined || view.hole.length < 2 || view.toCall === undefined)
    {
        return { play: null, work };
    }

    for (let draw = 0; draw < WARM_UP; draw += 1)
    {
        ask.random();
    }

    const level = LEVELS[ask.skill] ?? LEVELS.intermediate;
    const skill = LEVELS[ask.skill] === undefined ? 'intermediate' : ask.skill;
    const taste = tasteOf(ask.style);
    const spot = spotOf(ask);

    if (spot.rivals.length === 0)
    {
        return { play: spot.owe > 0 ? poker('call') : poker('check'), work };
    }

    const play = spot.preflop ? preflop(spot, level, skill, taste, ask, work) : postflop(spot, level, skill, taste, ask, work);

    return { play: legalOf(spot, play), work };
}

/** The play as the engine will take it: never a check that owes, a call that owes nothing, or a raise it cannot make. */
function legalOf(spot: Spot, play: MatchPlay): MatchPlay
{
    if (play.kind !== 'poker')
    {
        return play;
    }

    const free = spot.owe === 0 ? poker('check') : poker('call');

    switch (play.verb)
    {
        case 'fold': return spot.owe === 0 ? poker('check') : play;
        case 'check':
        case 'call': return free;
        case 'raise':
        case 'allin': return spot.low === null ? free : play;
        default: return free;
    }
}
