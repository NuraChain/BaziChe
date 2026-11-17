import { describe, expect, it } from 'vitest';

import { seededRandom, type Ask, type Hidden, type SeatLog } from '../src/domains/ai/agent.ts';
import { hokmAgent } from '../src/domains/ai/hokm/agent.ts';
import { dealOf } from '../src/domains/ai/hokm/search.ts';
import { seenOf, type HokmBoard } from '../src/domains/ai/hokm/table.ts';
import { LEVELS, think, type Thought } from '../src/domains/ai/hokm/think.ts';
import { RANKS, SUITS, cardOf, rankOf, suitOf, type Rank, type Suit } from '../src/domains/match/cards/cards.ts';
import { hokmEngine } from '../src/domains/match/engines/hokm.ts';
import { deckFor, trickWinner } from '../src/domains/match/hokm/cards.ts';
import { sideCount, type HokmEvent, type HokmState } from '../src/domains/match/hokm/state.ts';
import { SKILLS, type Skill } from '../src/domains/system/rules.ts';
import type { MatchPlay } from '../src/schemas.ts';

/**
 * The hokm system player: whole games in every format, the same answer for the same ask, measured
 * strength against the stage-1 baseline and between skills, the work each skill may do, and the
 * card-play rules it is meant to follow.
 */

type Input = Hidden<HokmBoard>;

/** The stage-1 baseline agent, kept here as an opponent to measure against. */
function baseline(ask: Ask<Input>): MatchPlay | null
{
    const view = ask.input.view;
    const trump = view.trump ?? null;
    const ten = RANKS.indexOf('10');
    const worthOf = (card: number) => rankOf(card) + (suitOf(card) === trump ? RANKS.length : 0);
    const lowest = (cards: readonly number[]) =>
        cards.reduce((low, card) => (worthOf(card) < worthOf(low) || (worthOf(card) === worthOf(low) && card < low) ? card : low), cards[0]);

    if (view.phase === 'trump')
    {
        const strength = (suit: Suit) => view.hand.filter((card) => suitOf(card) === suit).reduce((sum, card) => sum + 10 + rankOf(card), 0);

        return view.hakem === ask.seat && view.hand.length > 0
            ? { kind: 'hokm', verb: 'trump', suit: SUITS.reduce((best, suit) => (strength(suit) > strength(best) ? suit : best), SUITS[0]) }
            : null;
    }

    if (view.turn !== ask.seat)
    {
        return null;
    }

    if (view.phase === 'discard')
    {
        const count = view.discard ?? 0;

        return { kind: 'hokm', verb: 'discard', cards: [...view.hand].sort((a, b) => worthOf(a) - worthOf(b) || a - b).slice(0, count).sort((a, b) => a - b) };
    }

    if (view.phase === 'draw')
    {
        return view.offer === undefined ? null : { kind: 'hokm', verb: suitOf(view.offer) === trump || rankOf(view.offer) >= ten ? 'keep' : 'reject' };
    }

    const plays = view.plays;

    if (plays.length === 0)
    {
        return null;
    }

    if (view.trick.length === 0)
    {
        const aces = plays.filter((card) => rankOf(card) === RANKS.length - 1 && suitOf(card) !== trump);
        const plain = plays.filter((card) => suitOf(card) !== trump);

        return { kind: 'hokm', verb: 'card', card: aces.length > 0 ? aces[0] : lowest(plain.length > 0 ? plain : plays) };
    }

    const led = (trump ?? suitOf(view.trick[0])) as Suit;
    const winning = (view.lead + trickWinner(view.trick, led)) % view.seats.length;

    if (winning === (view.seats.length === 4 ? (ask.seat + 2) % 4 : -1))
    {
        return { kind: 'hokm', verb: 'card', card: lowest(plays) };
    }

    const beats = plays.filter((card) => trickWinner([...view.trick, card], led) === view.trick.length);

    return { kind: 'hokm', verb: 'card', card: lowest(beats.length > 0 ? beats : plays) };
}

function seeded(seed: number)
{
    let state = (seed * 2654435761) >>> 0 || 1;

    const next = () =>
    {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;

        return (state >>> 0) / 4294967296;
    };

    return { die: (sides: number) => 1 + Math.floor(next() * sides) };
}

type Player = Skill | 'baseline';

interface Seen
{
    skill: Skill;
    phase: string;
    thought: Thought;
    ms: number;
}

interface Played
{
    points: number[];
    actions: number;
}

const formatOf = (seats: number) => hokmEngine.formats.find((format) => format.seats === seats) as { seats: number; variant: 'standard' | 'teams' };

/** One whole match, each seat played by `players[seat]`, every play through the engine's own `parse` and `apply`. */
function playMatch(seats: number, players: readonly Player[], seed: number, target: number, watch?: (seen: Seen) => void): Played
{
    const draws = seeded(seed);
    const format = formatOf(seats);
    let state = hokmEngine.create(Array.from({ length: seats }, (_, seat) => seat), draws, { target, cube: false, blinds: 'low', variant: format.variant }).state;
    const log: SeatLog[] = [];
    let actions = 0;

    while (hokmEngine.finish(state) === null)
    {
        const seat = hokmEngine.turnOf(state) as number;
        const player = players[seat];
        const ask: Ask<Input> = {
            seat,
            format,
            input: { view: hokmEngine.view(state, seat) as HokmBoard, log },
            skill: player === 'baseline' ? 'casual' : player,
            style: (seed * 37 + seat * 101) % 1000,
            random: seededRandom(seed * 7919 + actions),
            spent: () => 0,
            budget: 3000
        };

        let play: MatchPlay | null;

        if (player === 'baseline')
        {
            play = baseline(ask);
        }
        else
        {
            const began = performance.now();
            const thought = think(ask);

            watch?.({ skill: player, phase: state.phase, thought, ms: performance.now() - began });
            play = thought.play;
        }

        expect(play, `seat ${ seat } answers at action ${ actions }`).not.toBeNull();

        const action = hokmEngine.parse(play as MatchPlay, seat);

        expect(action, `play parses: ${ JSON.stringify(play) }`).not.toBeNull();

        const applied = hokmEngine.apply(state, action as never, draws);

        expect(applied.ok, `play accepted at action ${ actions }: ${ JSON.stringify(play) }`).toBe(true);

        if (!applied.ok)
        {
            break;
        }

        state = applied.state;
        log.push({ rev: state.rev, seat, log: hokmEngine.log(applied.events, seat) });
        actions += 1;

        expect(actions).toBeLessThan(4000);
    }

    return { points: [...state.points], actions };
}

/**
 * Points won by `a` and by `b` over `games` deals, each played twice with the sides swapped. At two
 * and three seats `a` sits in one seat (moving round) and `b`'s points are averaged per seat.
 */
function contest(a: Player, b: Player, seats: number, games: number, target = 7)
{
    let ours = 0;
    let theirs = 0;

    for (let game = 1; game <= games; game += 1)
    {
        for (const swap of [false, true])
        {
            const players = Array.from({ length: seats }, (_, seat) =>
                (seats === 4 ? (seat % 2 === 0) !== swap : seat === (game + (swap ? 1 : 0)) % seats) ? a : b);
            const { points } = playMatch(seats, players, game * 31 + seats, target);
            const others = seats === 4 ? 1 : seats - 1;

            points.forEach((won, side) =>
            {
                if (players[side] === a)
                {
                    ours += won;
                }
                else
                {
                    theirs += won / others;
                }
            });
        }
    }

    return { ours, theirs };
}

describe('the hokm agent plays whole games', () =>
{
    for (const seats of [2, 3, 4])
    {
        it(`${ seats } seats, every skill seated: every game ends and every play is accepted`, () =>
        {
            for (let game = 1; game <= 2; game += 1)
            {
                const players = Array.from({ length: seats }, (_, seat) => SKILLS[(game + seat * (seats === 2 ? 2 : 1)) % SKILLS.length]);
                const played = playMatch(seats, players, 500 + game * 7 + seats, 3);

                expect(played.actions).toBeGreaterThan(0);
                expect(Math.max(...played.points)).toBeGreaterThanOrEqual(3);
            }
        }, 30_000);
    }

    it('is the agent the runtime registers, at version 2', () =>
    {
        expect(hokmAgent.id).toBe('hokm');
        expect(hokmAgent.version).toBe(2);
    });
});

describe('the same ask, the same play', () =>
{
    it('answers an ask the same way every time, and a different style or seed can answer otherwise', () =>
    {
        let compared = 0;
        let bySeed = 0;
        let byStyle = 0;

        // Play one match and ask every decision again, three ways.
        const draws = seeded(91);
        let state = hokmEngine.create([0, 1, 2, 3], draws, { target: 2, cube: false, blinds: 'low', variant: 'teams' }).state;
        const log: SeatLog[] = [];

        while (hokmEngine.finish(state) === null)
        {
            const seat = hokmEngine.turnOf(state) as number;
            const skill: Skill = seat % 2 === 0 ? 'casual' : 'intermediate';
            const ask = (seed: number, style: number): Ask<Input> => ({
                seat,
                format: formatOf(4),
                input: { view: hokmEngine.view(state, seat) as HokmBoard, log },
                skill,
                style,
                random: seededRandom(seed),
                spent: () => 0,
                budget: 1000
            });

            const seed = 1000 + compared * 7;
            const play = hokmAgent.decide(ask(seed, 300));

            expect(hokmAgent.decide(ask(seed, 300))).toEqual(play);
            compared += 1;
            bySeed += JSON.stringify(hokmAgent.decide(ask(seed + 50_000, 300))) === JSON.stringify(play) ? 0 : 1;
            byStyle += JSON.stringify(hokmAgent.decide(ask(seed, 845))) === JSON.stringify(play) ? 0 : 1;

            const applied = hokmEngine.apply(state, hokmEngine.parse(play as MatchPlay, seat) as never, draws);

            expect(applied.ok).toBe(true);
            state = applied.ok ? applied.state : state;
            log.push({ rev: state.rev, seat, log: hokmEngine.log(applied.ok ? applied.events : [], seat) });
        }

        expect(compared).toBeGreaterThan(40);
        expect(bySeed).toBeGreaterThan(0);
        expect(byStyle).toBeGreaterThan(0);
    }, 20_000);
});

describe('strength', () =>
{
    it('intermediate beats the stage-1 baseline clearly at every table size', () =>
    {
        for (const seats of [4, 3, 2])
        {
            const { ours, theirs } = contest('intermediate', 'baseline', seats, 20);

            console.info(`hokm strength, ${ seats } seats: intermediate ${ ours } - baseline ${ theirs.toFixed(1) }`);
            expect(ours).toBeGreaterThan(theirs * 1.15);
        }
    }, 30_000);

    it('a higher skill beats a lower one', () =>
    {
        const ladder: [Skill, Skill, number][] = [['intermediate', 'casual', 12], ['advanced', 'intermediate', 20]];

        for (const [higher, lower, games] of ladder)
        {
            const { ours, theirs } = contest(higher, lower, 4, games);

            console.info(`hokm strength, 4 seats: ${ higher } ${ ours } - ${ lower } ${ theirs }`);
            expect(ours).toBeGreaterThan(theirs);
        }
    }, 60_000);
});

describe('the work a decision may do', () =>
{
    it('stays within each skill\'s caps, and is measured', () =>
    {
        const spread = 14 * 52;

        for (const skill of SKILLS)
        {
            const times: number[] = [];
            const level = LEVELS[skill];

            for (const seats of [4, 2])
            {
                playMatch(seats, Array.from({ length: seats }, () => skill), 300 + seats, 1, ({ phase, thought, ms }) =>
                {
                    times.push(ms);

                    if (phase === 'trump')
                    {
                        expect(thought.work.samples).toBeLessThanOrEqual(level.trumpSamples);
                        expect(thought.work.nodes).toBeLessThanOrEqual(level.trumpSamples * 4 * 52);
                    }
                    else
                    {
                        expect(thought.work.samples).toBeLessThanOrEqual(level.limits.samples);
                        expect(thought.work.nodes).toBeLessThanOrEqual(level.limits.nodes + spread);
                    }

                    if (skill === 'casual')
                    {
                        expect(thought.work).toEqual({ samples: 0, nodes: 0 });
                    }
                });
            }

            const mean = times.reduce((sum, ms) => sum + ms, 0) / times.length;

            console.info(`hokm ${ skill }: ${ times.length } decisions, mean ${ mean.toFixed(2) } ms, worst ${ Math.max(...times).toFixed(1) } ms`);
            expect(mean).toBeLessThan(500);
        }
    }, 30_000);
});

const card = (rank: Rank, suit: Suit) => cardOf(suit, rank);

/**
 * A table in the middle of a hand: `mine` for `seat`, the trick on the table led by `lead`, and
 * everybody else dealt the rest of the deck (by a fixed shuffle) as far as their counts go.
 */
function tableOf(seats: number, seat: number, mine: number[], trump: Suit, lead: number, trick: number[], others: Record<number, number[]> = {}): HokmState
{
    const size = mine.length + (trick.length > (seat - lead + seats) % seats ? 1 : 0);
    const used = new Set([...mine, ...trick, ...Object.values(others).flat()]);
    const draws = seeded(13);
    const rest = deckFor(seats).filter((one) => !used.has(one));

    for (let at = rest.length - 1; at > 0; at -= 1)
    {
        const other = draws.die(at + 1) - 1;

        [rest[at], rest[other]] = [rest[other], rest[at]];
    }

    const hands = Array.from({ length: seats }, (_, at) =>
    {
        if (at === seat)
        {
            return [...mine].sort((a, b) => a - b);
        }

        const played = trick.length > (at - lead + seats) % seats ? 1 : 0;
        const given = others[at] ?? [];

        return [...given, ...rest.splice(0, size - played - given.length)].sort((a, b) => a - b);
    });

    return {
        v: 1,
        game: 'hokm',
        rev: 20,
        seats,
        target: 7,
        round: 1,
        hakem: lead,
        phase: 'tricks',
        trump,
        hands,
        stock: [],
        offer: null,
        glimpse: hands.map(() => null),
        turn: (lead + trick.length) % seats,
        lead,
        trick,
        took: null,
        tricks: hands.map(() => 0),
        points: Array.from({ length: sideCount(seats) }, () => 0),
        out: hands.map(() => false),
        winner: null
    };
}

function logOf(events: HokmEvent[]): SeatLog[]
{
    return [{ rev: 1, seat: 0, log: hokmEngine.log(events, 0) }];
}

function decideAt(state: HokmState, seat: number, skill: Skill, events: HokmEvent[] = []): MatchPlay | null
{
    const trickEvents: HokmEvent[] = state.trick.map((one, at) => ({ e: 'card', seat: (state.lead + at) % state.seats, card: one }));

    return hokmAgent.decide({
        seat,
        format: formatOf(state.seats),
        input: { view: hokmEngine.view(state, seat) as HokmBoard, log: logOf([...events, ...trickEvents]) },
        skill,
        style: 500,
        random: seededRandom(3),
        spent: () => 0,
        budget: 1000
    });
}

const played = (one: number): MatchPlay => ({ kind: 'hokm', verb: 'card', card: one });

describe('card play', () =>
{
    const thinking: Skill[] = ['casual', 'intermediate', 'advanced'];

    it('leaves a partner\'s winning trick alone, throwing its lowest', () =>
    {
        // Seat 3 plays last; its partner, seat 1, is winning with the ace.
        const state = tableOf(4, 3, [card('Q', 'clubs'), card('4', 'clubs'), card('9', 'hearts'), card('K', 'diamonds')], 'spades', 0, [card('K', 'clubs'), card('A', 'clubs'), card('3', 'clubs')]);

        for (const skill of thinking)
        {
            expect(decideAt(state, 3, skill), skill).toEqual(played(card('4', 'clubs')));
        }
    });

    it('wins as cheaply as it can when last to play', () =>
    {
        const state = tableOf(4, 3, [card('A', 'clubs'), card('Q', 'clubs'), card('2', 'clubs'), card('9', 'hearts')], 'spades', 0, [card('10', 'clubs'), card('3', 'clubs'), card('5', 'clubs')]);

        for (const skill of thinking)
        {
            expect(decideAt(state, 3, skill), skill).toEqual(played(card('Q', 'clubs')));
        }
    });

    it('ruffs an opponent\'s trick with its lowest trump when void in the suit led', () =>
    {
        const state = tableOf(4, 3, [card('3', 'spades'), card('9', 'spades'), card('2', 'hearts'), card('K', 'hearts')], 'spades', 0, [card('K', 'clubs'), card('2', 'clubs'), card('5', 'clubs')]);

        for (const skill of thinking)
        {
            expect(decideAt(state, 3, skill), skill).toEqual(played(card('3', 'spades')));
        }
    });

    it('cashes a sure winner when it leads short of trumps', () =>
    {
        const mine = [card('A', 'hearts'), card('4', 'hearts'), card('7', 'diamonds'), card('8', 'diamonds'), card('2', 'clubs'), card('6', 'clubs'), card('3', 'spades')];
        const state = tableOf(4, 0, mine, 'spades', 0, []);

        for (const skill of ['casual', 'intermediate'] as Skill[])
        {
            expect(decideAt(state, 0, skill), skill).toEqual(played(card('A', 'hearts')));
        }
    });

    it('does not cash a winner into a suit an opponent has shown it can trump', () =>
    {
        // Seat 1 (an opponent) threw a club on a heart lead earlier: it is void in hearts and may trump.
        const mine = [card('A', 'hearts'), card('4', 'hearts'), card('7', 'diamonds'), card('8', 'diamonds'), card('6', 'clubs'), card('3', 'spades')];
        const earlier: HokmEvent[] = [
            { e: 'trump', seat: 0, suit: 'spades' },
            { e: 'card', seat: 0, card: card('2', 'hearts') },
            { e: 'card', seat: 1, card: card('2', 'clubs') },
            { e: 'card', seat: 2, card: card('5', 'hearts') },
            { e: 'card', seat: 3, card: card('K', 'hearts') },
            { e: 'trick', seat: 3 }
        ];
        const state = { ...tableOf(4, 0, mine, 'spades', 0, [], { 1: [card('4', 'spades')] }), tricks: [0, 0, 0, 1] };

        state.hands[1] = state.hands[1].filter((one) => suitOf(one) !== 'hearts').slice(0, mine.length);
        state.hands = state.hands.map((hand) => hand.slice(0, mine.length));

        const play = decideAt(state, 0, 'intermediate', earlier) as { card: number };

        expect(play.card).not.toBe(card('A', 'hearts'));
    });

    it('leads a suit its partner is void in, for the partner to trump', () =>
    {
        // Seat 2 (the partner) threw a heart on a diamond lead: void in diamonds, trumps unknown.
        const mine = [card('4', 'diamonds'), card('9', 'diamonds'), card('7', 'hearts'), card('8', 'clubs'), card('6', 'clubs'), card('3', 'spades')];
        const earlier: HokmEvent[] = [
            { e: 'trump', seat: 0, suit: 'spades' },
            { e: 'card', seat: 1, card: card('A', 'diamonds') },
            { e: 'card', seat: 2, card: card('2', 'hearts') },
            { e: 'card', seat: 3, card: card('5', 'diamonds') },
            { e: 'card', seat: 0, card: card('2', 'diamonds') },
            { e: 'trick', seat: 1 },
            { e: 'card', seat: 1, card: card('2', 'clubs') },
            { e: 'card', seat: 2, card: card('A', 'clubs') },
            { e: 'card', seat: 3, card: card('3', 'clubs') },
            { e: 'card', seat: 0, card: card('4', 'clubs') },
            { e: 'trick', seat: 2 },
            { e: 'card', seat: 2, card: card('3', 'hearts') },
            { e: 'card', seat: 3, card: card('5', 'hearts') },
            { e: 'card', seat: 0, card: card('A', 'hearts') },
            { e: 'card', seat: 1, card: card('4', 'hearts') },
            { e: 'trick', seat: 0 }
        ];
        const gone = new Set(earlier.flatMap((one) => (one.e === 'card' ? [one.card] : [])));
        const state = { ...tableOf(4, 0, mine, 'spades', 0, [], { 2: [card('K', 'hearts')] }), tricks: [1, 1, 1, 0] };

        state.hands = state.hands.map((hand, at) => (at === 0 ? hand : hand.filter((one) => !gone.has(one) && !(at === 2 && suitOf(one) === 'diamonds')).slice(0, mine.length)));

        expect(decideAt(state, 0, 'intermediate', earlier)).toEqual(played(card('4', 'diamonds')));
    });

    it('answers nothing when it is not its turn', () =>
    {
        const state = tableOf(4, 3, [card('3', 'spades'), card('9', 'spades')], 'spades', 0, [card('K', 'clubs')]);

        expect(decideAt(state, 3, 'advanced')).toBeNull();
    });
});

describe('before the first card', () =>
{
    const opening = (seats: number, hand: number[]): HokmState =>
    {
        const state = hokmEngine.create(Array.from({ length: seats }, (_, seat) => seat), seeded(4), { target: 7, cube: false, blinds: 'low', variant: formatOf(seats).variant }).state;
        const hands = state.hands.map((held, at) => (at === state.hakem ? [...hand].sort((a, b) => a - b) : held.length === 0 ? [] : held));

        return { ...state, hands };
    };

    const ask = (state: HokmState, seat: number, skill: Skill): Ask<Input> => ({
        seat,
        format: formatOf(state.seats),
        input: { view: hokmEngine.view(state, seat) as HokmBoard, log: [] },
        skill,
        style: 500,
        random: seededRandom(9),
        spent: () => 0,
        budget: 1000
    });

    it('names its long suit trump, and only the Hakem names it', () =>
    {
        const hand = [card('3', 'spades'), card('7', 'spades'), card('J', 'spades'), card('K', 'hearts'), card('5', 'diamonds')];

        for (const seats of [3, 4])
        {
            const state = opening(seats, hand);

            for (const skill of SKILLS)
            {
                expect(hokmAgent.decide(ask(state, state.hakem, skill)), `${ seats } ${ skill }`).toEqual({ kind: 'hokm', verb: 'trump', suit: 'spades' });
            }

            expect(hokmAgent.decide(ask(state, (state.hakem + 1) % seats, 'intermediate'))).toBeNull();
        }
    }, 20_000);

    it('at two seats puts away low side cards and keeps trumps and aces', () =>
    {
        const state = opening(2, [card('A', 'hearts'), card('2', 'clubs'), card('9', 'spades'), card('4', 'diamonds'), card('6', 'clubs')]);
        const discarding: HokmState = { ...state, phase: 'discard', trump: 'spades', turn: state.hakem };

        for (const skill of SKILLS)
        {
            expect(hokmAgent.decide(ask(discarding, state.hakem, skill)), skill).toEqual({ kind: 'hokm', verb: 'discard', cards: [card('2', 'clubs'), card('6', 'clubs'), card('4', 'diamonds')].sort((a, b) => a - b) });
        }
    });

    it('at two seats keeps a strong card offered and passes a weak one', () =>
    {
        const state = opening(2, [card('A', 'hearts'), card('9', 'spades')]);
        const offered = (offer: number): HokmState => ({ ...state, phase: 'draw', trump: 'spades', turn: state.hakem, offer, stock: state.stock.filter((one) => one !== offer) });

        for (const skill of SKILLS)
        {
            expect(hokmAgent.decide(ask(offered(card('K', 'spades')), state.hakem, skill)), skill).toEqual({ kind: 'hokm', verb: 'keep' });
            expect(hokmAgent.decide(ask(offered(card('3', 'clubs')), state.hakem, skill)), skill).toEqual({ kind: 'hokm', verb: 'reject' });
        }
    });
});

describe('what it reads from the log', () =>
{
    it('counts the cards played and the voids shown, and deals only what could be', () =>
    {
        const events: HokmEvent[] = [
            { e: 'trump', seat: 0, suit: 'spades' },
            { e: 'card', seat: 0, card: card('2', 'hearts') },
            { e: 'card', seat: 1, card: card('2', 'clubs') },
            { e: 'card', seat: 2, card: card('5', 'hearts') },
            { e: 'card', seat: 3, card: card('3', 'spades') },
            { e: 'trick', seat: 3 }
        ];
        const mine = [card('A', 'hearts'), card('4', 'hearts'), card('7', 'diamonds'), card('8', 'diamonds')];
        const state = { ...tableOf(4, 0, mine, 'spades', 0, []), tricks: [0, 0, 0, 1], lead: 3, turn: 3 };
        const seen = seenOf({ view: hokmEngine.view(state, 0) as HokmBoard, log: logOf(events) }, 0);

        expect(seen.table.voids[1]).toBe(1 << SUITS.indexOf('hearts'));
        expect(seen.table.voids[3]).toBe(1 << SUITS.indexOf('hearts'));
        expect(seen.table.voids[2]).toBe(0);
        expect(seen.table.gone[SUITS.indexOf('hearts')] & (1 << RANKS.indexOf('5'))).not.toBe(0);

        const random = seededRandom(1);

        for (let round = 0; round < 50; round += 1)
        {
            const deal = dealOf(seen, random, round % 2 === 0);

            expect(deal).not.toBeNull();

            const hands = (deal as { hands: number[][] }).hands;

            expect([...hands[0]].sort((a, b) => a - b)).toEqual([...mine].sort((a, b) => a - b));
            expect(hands.map((hand) => hand.length)).toEqual(state.hands.map((hand) => hand.length));
            expect(hands[1].some((one) => suitOf(one) === 'hearts')).toBe(false);
            expect(hands[3].some((one) => suitOf(one) === 'hearts')).toBe(false);
            expect(new Set(hands.flat()).size).toBe(hands.flat().length);
            expect(hands.flat().some((one) => one === card('5', 'hearts') || one === card('2', 'clubs'))).toBe(false);
        }
    });
});
