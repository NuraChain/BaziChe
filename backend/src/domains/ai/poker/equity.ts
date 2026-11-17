import { holdingOf, scoreOf, type Holding, type Made } from './hand.ts';
import { COMBOS, ORDER, type Range } from './preflop.ts';

/**
 * A seat's share of the pot against the players still in, by playing the hand out many times over
 * cards drawn from the seat's own random: each opponent is dealt two cards from its range, the
 * board is completed, and the rules' order of hands decides each deal.
 *
 * An opponent's range is first its preflop slice; when `keeps` says what its betting since the flop
 * keeps, a deal counts as much as the chance its hands are kept for their class on the board (a bet
 * keeps most strong hands and few air hands), so the deals lean the way the betting says.
 *
 * Asked about bets, the same deals also say how often each bet takes the pot at once (every
 * opponent able to answer folds what it was dealt) and what share is left when it is called: a bet
 * is worth what it is against the hands that would call it, not against the whole range.
 */

/** Of a hand of each class on the board, the chance an opponent's betting since the flop keeps it. */
export type Keeps = Readonly<Record<Made, number>>;

export interface Opponent
{
    range: Range;
    keeps: Keeps | null;

    /** It still has chips to answer a bet with; one all in can never fold. */
    answers: boolean;
}

/** What an opponent was dealt in one deal, as a fold decision reads it. */
export interface Dealt
{
    /** Where the hand sits among all starting hands, 0 the best and 1 the worst. */
    place: number;

    /** Its class on the board, after the flop. */
    holding: Holding | null;
}

/** The chance opponent `index`, dealt `dealt`, folds to a bet that makes it pay `pressure` of the pot after its call. */
export type FoldOf = (index: number, dealt: Dealt, pressure: number) => number;

export interface Answered
{
    /** The share of deals in which every opponent folds. */
    folds: number;

    /** The share of the pot this seat wins in the deals it is called. */
    called: number;
}

export interface Sampled
{
    equity: number;

    /** One per pressure asked about. */
    bets: Answered[];
}

export interface Work
{
    /** Deals played out. */
    samples: number;

    /** Hands evaluated, in the deals and in reading the opponents. */
    nodes: number;
}

export interface Limits
{
    samples: number;
    nodes: number;
}

/** Tries to deal an opponent two cards not already in sight before any two live cards stand in. */
const BLOCKED_TRIES = 40;

/** The least weight a deal keeps, so a deal the betting all but rules out still counts a little. */
const LEAST_KEPT = 0.02;

export function equityOf(
    hole: readonly number[],
    board: readonly number[],
    opponents: readonly Opponent[],
    limits: Limits,
    random: () => number,
    stop: () => boolean,
    work: Work,
    pressures: readonly number[] = [],
    foldOf: FoldOf | null = null
): Sampled
{
    const used = new Uint8Array(52);

    for (const card of [...hole, ...board])
    {
        used[card] = 1;
    }

    const reading = board.length >= 3 && (foldOf !== null || opponents.some((one) => one.keeps !== null));
    const perDeal = 1 + opponents.length * (reading ? 2 : 1);
    const folds = pressures.map(() => 0);
    const calledWins = pressures.map(() => 0);
    const calledWeight = pressures.map(() => 0);
    let total = 0;
    let weights = 0;

    for (let sample = 0; sample < limits.samples; sample += 1)
    {
        if (work.nodes + perDeal > limits.nodes || (sample % 16 === 15 && stop()))
        {
            break;
        }

        const taken: number[] = [];
        const holes: (readonly [number, number])[] = [];
        const dealt: Dealt[] = [];

        // Each deal counts as much as the betting says its hands are kept: the product of the keeps.
        let weight = 1;

        for (const opponent of opponents)
        {
            const from = Math.floor(opponent.range.low * COMBOS);
            const span = Math.max(1, Math.ceil(opponent.range.high * COMBOS) - from);
            let chosen: readonly [number, number] | null = null;
            let place = 1;

            for (let tried = 0; tried < BLOCKED_TRIES && chosen === null; tried += 1)
            {
                const offset = Math.floor(random() * span);
                const pair = ORDER[Math.min(COMBOS - 1, from + offset)];

                if (used[pair[0]] === 0 && used[pair[1]] === 0)
                {
                    chosen = pair;
                    place = (from + offset + 0.5) / COMBOS;
                }
            }

            // A range wholly blocked by the cards in sight: any two live cards stand in for it.
            if (chosen === null)
            {
                const live: number[] = [];

                for (let card = 0; card < 52 && live.length < 2; card += 1)
                {
                    if (used[card] === 0)
                    {
                        live.push(card);
                    }
                }

                chosen = [live[0], live[1]];
            }

            const holding = reading ? holdingOf(chosen, board) : null;

            work.nodes += reading ? 1 : 0;

            if (opponent.keeps !== null && holding !== null)
            {
                weight *= Math.max(LEAST_KEPT, opponent.keeps[holding.made]);
            }

            used[chosen[0]] = 1;
            used[chosen[1]] = 1;
            taken.push(chosen[0], chosen[1]);
            holes.push(chosen);
            dealt.push({ place, holding });
        }

        const full = [...board];

        while (full.length < 5)
        {
            const card = Math.floor(random() * 52);

            if (used[card] === 0)
            {
                used[card] = 1;
                taken.push(card);
                full.push(card);
            }
        }

        const mine = scoreOf([...hole, ...full]);
        let best = true;
        let ties = 0;

        for (const pair of holes)
        {
            const theirs = scoreOf([pair[0], pair[1], ...full]);

            if (theirs > mine)
            {
                best = false;
            }

            ties += theirs === mine ? 1 : 0;
        }

        const share = best ? 1 / (ties + 1) : 0;

        work.nodes += 1 + holes.length;
        work.samples += 1;
        total += weight * share;
        weights += weight;

        if (foldOf !== null)
        {
            for (let at = 0; at < pressures.length; at += 1)
            {
                let all = 1;

                for (let index = 0; index < opponents.length && all > 0; index += 1)
                {
                    all *= opponents[index].answers ? foldOf(index, dealt[index], pressures[at]) : 0;
                }

                folds[at] += weight * all;
                calledWins[at] += weight * share * (1 - all);
                calledWeight[at] += weight * (1 - all);
            }
        }

        for (const card of taken)
        {
            used[card] = 0;
        }
    }

    const equity = weights <= 0 ? 0.5 : total / weights;

    return {
        equity,
        bets: pressures.map((_, at) => ({
            folds: weights <= 0 ? 0 : folds[at] / weights,
            called: calledWeight[at] > 1e-9 ? calledWins[at] / calledWeight[at] : equity
        }))
    };
}

/** One player still to act behind an all-in: what calling it would cost and what it would then win. */
export interface Caller
{
    /** Chips it would put in to call, the chips of the all-in it would match, and its share of the pot it would need to win to break even. */
    price: number;
    matched: number;
    needs: number;
}

/**
 * What moving all in first is worth in chips, against the players behind: each is dealt a hand and
 * calls when the hand is good enough for its price (a hand's share against an all-in range falls
 * from about 84% for aces to 29% for the worst), the first caller is played out, and when nobody
 * calls the pot is won as it stands.
 */
export function pushWorth(
    hole: readonly number[],
    pot: number,
    callers: readonly Caller[],
    limits: Limits,
    random: () => number,
    work: Work
): number
{
    const used = new Uint8Array(52);

    for (const card of hole)
    {
        used[card] = 1;
    }

    const reach = callers.map((caller) => Math.max(0.03, Math.min(1, ((0.84 - caller.needs) / 0.55) ** 2)));
    let total = 0;
    let deals = 0;

    for (let sample = 0; sample < limits.samples && work.nodes + 2 <= limits.nodes; sample += 1)
    {
        const taken: number[] = [];
        let called = -1;
        let pair: readonly [number, number] = [0, 0];

        for (let index = 0; index < callers.length && called < 0; index += 1)
        {
            let offset = 0;

            do
            {
                offset = Math.floor(random() * COMBOS);
                pair = ORDER[offset];
            }
            while (used[pair[0]] === 1 || used[pair[1]] === 1);

            used[pair[0]] = 1;
            used[pair[1]] = 1;
            taken.push(pair[0], pair[1]);

            if ((offset + 0.5) / COMBOS <= reach[index])
            {
                called = index;
            }
        }

        if (called < 0)
        {
            total += pot;
        }
        else
        {
            const board: number[] = [];

            while (board.length < 5)
            {
                const card = Math.floor(random() * 52);

                if (used[card] === 0)
                {
                    used[card] = 1;
                    taken.push(card);
                    board.push(card);
                }
            }

            const mine = scoreOf([...hole, ...board]);
            const theirs = scoreOf([pair[0], pair[1], ...board]);
            const share = mine > theirs ? 1 : mine === theirs ? 0.5 : 0;
            const { price, matched } = callers[called];

            work.nodes += 2;
            total += share * (pot + matched + price) - matched;
        }

        work.samples += 1;
        deals += 1;

        for (const card of taken)
        {
            used[card] = 0;
        }
    }

    return deals === 0 ? 0 : total / deals;
}
