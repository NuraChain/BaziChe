import { describe, expect, it } from 'vitest';

import { inputOf, seededRandom, type Ask, type Hidden, type SeatLog } from '../src/domains/ai/agent.ts';
import { pokerAgent } from '../src/domains/ai/poker/agent.ts';
import { scoreOf } from '../src/domains/ai/poker/hand.ts';
import { placeOf } from '../src/domains/ai/poker/preflop.ts';
import type { PokerBoard } from '../src/domains/ai/poker/read.ts';
import { LEVELS, think } from '../src/domains/ai/poker/think.ts';
import { cardOf, rankOf, suitOf, type Rank, type Suit } from '../src/domains/match/cards/cards.ts';
import { pokerEngine } from '../src/domains/match/engines/poker.ts';
import type { Draws } from '../src/domains/match/engine.ts';
import { CATEGORIES, evaluate } from '../src/domains/match/poker/evaluator.ts';
import type { PokerState } from '../src/domains/match/poker/state.ts';
import { SKILLS, type Skill } from '../src/domains/system/rules.ts';
import type { MatchPlay } from '../src/schemas.ts';

/**
 * The poker agent: whole games in every format, reproducibility, strength against the stage-1
 * baseline and between skills, the work a decision takes, and spots whose right play is plain.
 */

type PokerAsk = Ask<Hidden<PokerBoard>>;

type Player = (ask: PokerAsk) => MatchPlay | null;

function seeded(seed: number): { draws: Draws; next: () => number }
{
    let state = (seed * 2654435761) >>> 0 || 1;

    const next = () =>
    {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;

        return (state >>> 0) / 4294967296;
    };

    return { draws: { die: (sides) => 1 + Math.floor(next() * sides) }, next };
}

/** The stage-1 baseline this agent replaced, kept here as an opponent to measure against. */
function baseline(ask: PokerAsk): MatchPlay | null
{
    const view = ask.input.view;

    if (view.turn !== ask.seat || view.winner !== undefined || view.hole.length < 2)
    {
        return null;
    }

    const strengthOf = () =>
    {
        const [a, b] = view.hole;

        if (view.board.length < 3)
        {
            const high = Math.max(rankOf(a), rankOf(b));
            const low = Math.min(rankOf(a), rankOf(b));

            if (high === low)
            {
                return 0.5 + high / 24;
            }

            const suited = suitOf(a) === suitOf(b) ? 0.05 : 0;
            const connected = high - low <= 2 ? 0.04 : 0;
            const ace = high === 12 ? 0.08 : 0;

            return Math.min(0.85, (high + low) / 40 + suited + connected + ace);
        }

        return [0.25, 0.55, 0.72, 0.8, 0.85, 0.88, 0.93, 0.97, 0.99][CATEGORIES.indexOf(evaluate([...view.hole, ...view.board]).category)] ?? 0.25;
    };

    const mine = view.seats[ask.seat];
    const owe = view.toCall ?? 0;
    const raising = view.minRaiseTo !== undefined && view.maxRaiseTo !== undefined;
    const strength = strengthOf() * (0.9 + (ask.style / 999) * 0.2);
    const odds = owe / Math.max(1, view.pot + owe);

    if (raising && mine.stack <= view.blinds.big * 10 && strength >= 0.62)
    {
        return { kind: 'poker', verb: 'allin' };
    }

    if (raising && strength >= (owe === 0 ? 0.6 : 0.75))
    {
        const low = view.minRaiseTo as number;
        const high = view.maxRaiseTo as number;
        const amount = Math.min(high, Math.max(low, low + Math.floor(view.pot * (0.3 + ask.random() * 0.4))));

        return amount >= high ? { kind: 'poker', verb: 'allin' } : { kind: 'poker', verb: 'raise', amount };
    }

    if (owe === 0)
    {
        return { kind: 'poker', verb: 'check' };
    }

    return strength >= odds + 0.15 ? { kind: 'poker', verb: 'call' } : { kind: 'poker', verb: 'fold' };
}

interface Seat
{
    skill: Skill;
    play: Player;
}

const agent = (skill: Skill): Seat => ({ skill, play: (ask) => pokerAgent.decide(ask) });

const BASELINE: Seat = { skill: 'intermediate', play: baseline };

/** One whole freezeout through the engine's own `parse` and `apply`, each seat played with its whole log. Returns each seat's place. */
function playGame(players: readonly Seat[], seed: number, blinds: 'low' | 'mid' | 'high' = 'low', watch?: (ask: PokerAsk) => void): number[]
{
    const { draws } = seeded(seed);
    let state = pokerEngine.create(players.map((_, seat) => seat), draws, { target: 0, cube: false, blinds, variant: 'standard' }).state as PokerState;
    const history: { rev: number; seat: number; events: unknown[] }[] = [];
    const logOf = (reader: number): SeatLog[] => history.map((entry) => ({ rev: entry.rev, seat: entry.seat, log: pokerEngine.log(entry.events, reader) }));
    let decisions = 0;

    while (pokerEngine.finish(state) === null)
    {
        const seat = pokerEngine.turnOf(state) as number;
        const ask: PokerAsk = {
            seat,
            format: { seats: players.length, variant: 'standard' },
            input: inputOf('poker', state, seat, logOf) as Hidden<PokerBoard>,
            skill: players[seat].skill,
            style: (seed * 131 + seat * 397) % 1000,
            random: seededRandom(seed * 7919 + decisions),
            spent: () => 0,
            budget: 1000
        };

        watch?.(ask);

        const play = players[seat].play(ask);
        const action = play === null ? null : pokerEngine.parse(play, seat);
        const applied = action === null ? null : pokerEngine.apply(state, action, draws);

        if (applied === null || !applied.ok || (play?.kind === 'poker' && play.verb === 'fold' && (ask.input.view.toCall ?? 0) === 0))
        {
            throw new Error(`seed ${ seed }, decision ${ decisions }: ${ JSON.stringify(play) } is not a play the engine takes (${ applied?.ok === false ? applied.reason : 'no action' })`);
        }

        state = applied.state as PokerState;
        history.push({ rev: state.rev, seat, events: applied.events });
        decisions += 1;

        if (decisions >= 20_000)
        {
            throw new Error(`seed ${ seed } did not end`);
        }
    }

    return pokerEngine.standings(state).sort((a, b) => a.seat - b.seat).map((one) => one.place);
}

/** Heads-up games over seeds 1..pairs, each dealt twice with the seats swapped; the share `first` wins. */
function headsUp(first: Seat, second: Seat, pairs: number)
{
    let won = 0;

    for (let pair = 1; pair <= pairs; pair += 1)
    {
        const seed = pair * 1000 + 7;

        won += playGame([first, second], seed)[0] === 1 ? 1 : 0;
        won += playGame([second, first], seed)[1] === 1 ? 1 : 0;
    }

    return won / (2 * pairs);
}

const card = (text: string) =>
{
    const rank = text.slice(0, -1) as Rank;
    const suit = ({ c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' } as Record<string, Suit>)[text.slice(-1)];

    return cardOf(suit, rank);
};

interface Setup
{
    seats: number;
    button: number;
    hero: number;
    hole: [string, string];
    board?: string[];
    stacks: number[];
    bets: number[];
    folded?: number[];

    /** Chips in the pot from earlier streets, besides the bets in front. */
    before?: number;
    big?: number;

    /** This hand's moves after the blinds, in order. */
    moves?: { e: string; seat?: number; amount?: number; street?: string; cards?: number[] }[];
}

/** A hand-built board and log for the seat to act, as the engine would compose them. */
function spot(setup: Setup): Hidden<PokerBoard>
{
    const big = setup.big ?? 20;
    const current = Math.max(...setup.bets);
    const mine = setup.bets[setup.hero];
    const top = mine + setup.stacks[setup.hero];
    const others = setup.stacks.some((stack, seat) => seat !== setup.hero && stack > 0 && !(setup.folded ?? []).includes(seat));
    const pot = (setup.before ?? 0) + setup.bets.reduce((sum, bet) => sum + bet, 0);
    const sb = setup.seats === 2 ? setup.button : (setup.button + 1) % setup.seats;
    const bb = (sb + 1) % setup.seats;

    const view: PokerBoard = {
        kind: 'poker',
        street: (setup.board ?? []).length === 0 ? 'preflop' : (setup.board ?? []).length === 3 ? 'flop' : (setup.board ?? []).length === 4 ? 'turn' : 'river',
        hand: 1,
        button: setup.button,
        turn: setup.hero,
        board: (setup.board ?? []).map(card),
        pot,
        pots: [],
        seats: setup.stacks.map((stack, seat) => ({ seat, stack, bet: setup.bets[seat], folded: (setup.folded ?? []).includes(seat), allIn: stack === 0, out: false })),
        blinds: { small: big / 2, big, level: 1, next: 10 },
        hole: setup.hole.map(card),
        toCall: Math.min(current - mine, setup.stacks[setup.hero]),
        ...(others && top > current ? { minRaiseTo: Math.min(top, current + Math.max(big, current)), maxRaiseTo: top } : {})
    };

    const moves = [
        { e: 'deal', hand: 1, button: setup.button, small: big / 2, big },
        { e: 'blind', seat: sb, amount: big / 2 },
        { e: 'blind', seat: bb, amount: big },
        ...(setup.moves ?? [])
    ];

    return { view, log: [{ rev: 2, seat: -1, log: { kind: 'poker', moves } as never }] };
}

const decide = (input: Hidden<PokerBoard>, skill: Skill, seed = 1, style = 500) =>
    think({ seat: input.view.turn as number, format: { seats: input.view.seats.length, variant: 'standard' }, input, skill, style, random: seededRandom(seed), spent: () => 0, budget: 1000 }).play as MatchPlay & { verb: string; amount?: number };

describe('the hand evaluator the search uses', () =>
{
    it('scores every hand exactly as the rules do', () =>
    {
        const { next } = seeded(5);

        for (let hand = 0; hand < 20_000; hand += 1)
        {
            const cards = new Set<number>();

            while (cards.size < 5 + (hand % 3))
            {
                cards.add(Math.floor(next() * 52));
            }

            expect(scoreOf([...cards])).toBe(evaluate([...cards]).score);
        }
    });

    it('ranks starting hands sensibly', () =>
    {
        expect(placeOf(card('As'), card('Ad'))).toBeLessThan(0.01);
        expect(placeOf(card('As'), card('Ks'))).toBeLessThan(placeOf(card('As'), card('Kd')));
        expect(placeOf(card('7s'), card('2d'))).toBeGreaterThan(0.9);
        expect(placeOf(card('10s'), card('10d'))).toBeLessThan(placeOf(card('As'), card('5d')));
    });
});

describe('whole games', () =>
{
    it('end in every format with every play accepted and no fold when nothing is owed, the agent in every seat at mixed skills', () =>
    {
        for (const format of pokerEngine.formats)
        {
            const players = Array.from({ length: format.seats }, (_, seat) => agent(SKILLS[(format.seats + seat) % SKILLS.length]));
            const places = playGame(players, format.seats * 17, format.seats > 5 ? 'mid' : 'low');

            expect(places.filter((place) => place === 1)).toHaveLength(1);
        }
    }, 30_000);

    it('give the same play for the same ask, and somewhere a different one for another style or seed', () =>
    {
        let compared = 0;
        let styled = 0;
        let reseeded = 0;

        playGame([agent('advanced'), agent('intermediate'), agent('semi-pro')], 41, 'low', (ask) =>
        {
            const again = (style: number, seed: number) => pokerAgent.decide({ ...ask, style, random: seededRandom(seed) });

            expect(again(ask.style, 9)).toEqual(again(ask.style, 9));
            styled += JSON.stringify(again(ask.style, 9)) === JSON.stringify(again((ask.style + 500) % 1000, 9)) ? 0 : 1;
            reseeded += JSON.stringify(again(ask.style, 9)) === JSON.stringify(again(ask.style, 10)) ? 0 : 1;
            compared += 1;
        });

        expect(compared).toBeGreaterThan(20);
        expect(styled).toBeGreaterThan(0);
        expect(reseeded).toBeGreaterThan(0);
    }, 30_000);
});

describe('strength', () =>
{
    it('intermediate beats the stage-1 baseline clearly', () =>
    {
        const share = headsUp(agent('intermediate'), BASELINE, 100);

        console.log(`intermediate against the baseline: ${ (share * 100).toFixed(1) }% of 200 heads-up games`);
        expect(share).toBeGreaterThan(0.58);
    }, 30_000);

    it('a higher skill beats the one below it more often than not', () =>
    {
        for (const [higher, lower] of [['intermediate', 'casual'], ['advanced', 'intermediate'], ['semi-pro', 'advanced']] as const)
        {
            const share = headsUp(agent(higher), agent(lower), 100);

            console.log(`${ higher } against ${ lower }: ${ (share * 100).toFixed(1) }% of 200 heads-up games`);
            expect(share).toBeGreaterThan(0.5);
        }
    }, 60_000);
});

describe('cost', () =>
{
    it('keeps every decision inside its skill\'s caps', () =>
    {
        const seen = new Map<Skill, { nodes: number[]; samples: number[]; ms: number[] }>();
        const record = (ask: PokerAsk) =>
        {
            const began = performance.now();
            const { work } = think(ask);
            const ms = performance.now() - began;
            const row = seen.get(ask.skill) ?? { nodes: [], samples: [], ms: [] };

            row.nodes.push(work.nodes);
            row.samples.push(work.samples);
            row.ms.push(ms);
            seen.set(ask.skill, row);
        };

        playGame([agent('casual'), agent('intermediate'), agent('advanced'), agent('semi-pro'), agent('advanced'), agent('semi-pro')], 7, 'low', record);
        playGame([agent('semi-pro'), agent('casual'), agent('intermediate')], 8, 'low', record);

        for (const skill of SKILLS)
        {
            const row = seen.get(skill);
            const level = LEVELS[skill];

            expect(row, skill).toBeDefined();

            const { nodes, samples, ms } = row as NonNullable<typeof row>;
            const sorted = [...ms].sort((a, b) => a - b);

            console.log(`${ skill }: ${ ms.length } decisions, nodes mean ${ Math.round(nodes.reduce((sum, one) => sum + one, 0) / nodes.length) } most ${ Math.max(...nodes) } (cap ${ level.nodes }), ms mean ${ (ms.reduce((sum, one) => sum + one, 0) / ms.length).toFixed(2) } p95 ${ sorted[Math.floor(sorted.length * 0.95)].toFixed(2) } most ${ sorted[sorted.length - 1].toFixed(1) }`);
            expect(Math.max(...nodes)).toBeLessThanOrEqual(level.nodes);
            expect(Math.max(...samples)).toBeLessThanOrEqual(Math.max(level.preflop, level.postflop, level.pushes));
        }

        expect(Math.max(...(seen.get('casual')?.nodes ?? [1]))).toBe(0);
    }, 30_000);

    it('stops sampling once the budget is spent', () =>
    {
        const input = spot({ seats: 2, button: 0, hero: 1, hole: ['Kh', '9h'], board: ['Ah', '7h', '2c'], stacks: [1300, 1350], bets: [50, 0], before: 100 });
        let clock = 0;
        const { work } = think({ seat: 1, format: { seats: 2, variant: 'standard' }, input, skill: 'semi-pro', style: 500, random: seededRandom(3), spent: () => (clock += 50), budget: 500 });

        expect(work.samples).toBeLessThan(LEVELS['semi-pro'].postflop);
    });
});

describe('plain spots', () =>
{
    const nine = { seats: 9, button: 0, hero: 3, stacks: [1500, 1490, 1480, 1500, 1500, 1500, 1500, 1500, 1500], bets: [0, 10, 20, 0, 0, 0, 0, 0, 0] };

    it('opens aces under the gun for 2.2 to 3 big blinds, and folds seven-deuce', () =>
    {
        for (const skill of SKILLS)
        {
            const aces = decide(spot({ ...nine, hole: ['As', 'Ad'] }), skill);

            expect(aces.verb, skill).toBe('raise');
            expect(aces.amount, skill).toBeGreaterThanOrEqual(44);
            expect(aces.amount, skill).toBeLessThanOrEqual(60);
            expect(decide(spot({ ...nine, hole: ['7c', '2d'] }), skill).verb, skill).toBe('fold');
        }
    });

    it('pushes a short stack on the button with ace-nine, and folds seven-deuce there', () =>
    {
        const short = { seats: 9, button: 0, hero: 0, stacks: [160, 1490, 1480, 1500, 1500, 1500, 1500, 1500, 1500], bets: [0, 10, 20, 0, 0, 0, 0, 0, 0], folded: [3, 4, 5, 6, 7, 8] };

        for (const skill of SKILLS)
        {
            expect(decide(spot({ ...short, hole: ['As', '9d'] }), skill).verb, skill).toBe('allin');
            expect(decide(spot({ ...short, hole: ['7c', '2d'] }), skill).verb, skill).toBe('fold');
        }
    });

    it('calls a river all-in with the nuts and folds air to a pot-sized river bet', () =>
    {
        const river = ['Ah', 'Kh', 'Qh', '3c', '7d'];
        const moves = [{ e: 'raise', seat: 0, amount: 60 }, { e: 'call', seat: 1, amount: 40 }];

        for (const skill of SKILLS)
        {
            const nuts = spot({ seats: 2, button: 0, hero: 1, hole: ['Jh', '10h'], board: river, stacks: [0, 1000], bets: [800, 0], before: 400, moves });
            const air = spot({ seats: 2, button: 0, hero: 1, hole: ['6c', '4d'], board: ['Ah', 'Kd', '9c', '8s', '2h'], stacks: [900, 1200], bets: [300, 0], before: 300, moves });

            expect(decide(nuts, skill).verb, skill).toBe('call');
            expect(decide(air, skill).verb, skill).toBe('fold');
        }
    });

    it('does not fold a committed stack to a small bet, nor a flush draw at a good price', () =>
    {
        for (const skill of SKILLS)
        {
            const committed = spot({ seats: 2, button: 0, hero: 1, hole: ['9c', '9d'], board: ['Ks', '8h', '3c'], stacks: [1100, 200], bets: [100, 0], before: 2600 });
            const draw = spot({ seats: 2, button: 0, hero: 1, hole: ['Kh', '9h'], board: ['Ah', '7h', '2c'], stacks: [1300, 1350], bets: [50, 0], before: 100 });

            expect(decide(committed, skill).verb, skill).not.toBe('fold');
            expect(decide(draw, skill).verb, skill).not.toBe('fold');
        }
    });

    it('raises only by amounts the engine accepts, between the least raise and all in', () =>
    {
        for (let seed = 1; seed <= 40; seed += 1)
        {
            for (const skill of SKILLS)
            {
                const input = spot({ seats: 2, button: 0, hero: 1, hole: ['As', 'Ah'], board: ['Ad', '7c', '2s'], stacks: [1300, 1350], bets: [50 + seed, 0], before: 100 });
                const play = decide(input, skill, seed, seed * 25);

                if (play.verb === 'raise')
                {
                    expect(play.amount).toBeGreaterThanOrEqual(input.view.minRaiseTo as number);
                    expect(play.amount).toBeLessThan(input.view.maxRaiseTo as number);
                    expect(Number.isInteger(play.amount)).toBe(true);
                }

                expect(['raise', 'allin', 'call']).toContain(play.verb);
            }
        }
    });
});
