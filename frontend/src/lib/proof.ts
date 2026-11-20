import { backgammonEngine } from '../../../backend/src/domains/match/engines/backgammon.ts';
import { chessEngine } from '../../../backend/src/domains/match/engines/chess.ts';
import { hokmEngine } from '../../../backend/src/domains/match/engines/hokm.ts';
import { ludoEngine } from '../../../backend/src/domains/match/engines/ludo.ts';
import { pokerEngine } from '../../../backend/src/domains/match/engines/poker.ts';
import { OPENING, bytesOf, drawsOf, hexOf, seedOf, stakeMatchId } from '../../../backend/src/domains/match/fair.ts';
import { trackedDraws } from '../../../backend/src/domains/match/randomness.ts';
import type { Engine, ForfeitReason, Moment, TableConfig } from '../../../backend/src/domains/match/engine.ts';
import type { MatchPlay, MatchProof } from '../api.ts';
import { keccak, mac } from './fair.ts';
import { addressFrom } from './signer.ts';

export interface SeatCheck
{
    seat: number;
    who: string;
    address: string;
    commit: string;
    signed: boolean;
    kept: boolean;
}

export interface Wrong
{
    rev: number;
    said: string;
    drawn: string;
}

export interface Checked
{
    seed: string;
    seats: SeatCheck[];
    moves: number;
    total: number;
    wrong: Wrong | null;
}

const ENGINES = new Map<string, Engine>([ludoEngine, hokmEngine, backgammonEngine, pokerEngine, chessEngine].map((engine) => [engine.id, engine as Engine]));

const STAKE = 'Stake(address player,string game,uint256 amount,uint16 feeBps,bytes32 commit,bytes32 nonce,uint64 deadline)';

const DOMAIN = 'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)';

const text = new TextEncoder();

const hashOf = (words: string) => keccak(text.encode(words));

const word = (value: bigint) => bytesOf(value.toString(16).padStart(64, '0'));

const join = (...parts: Uint8Array[]) =>
{
    const joined = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
    let at = 0;

    for (const part of parts)
    {
        joined.set(part, at);
        at += part.length;
    }

    return joined;
};

export function stakeDigest(proof: MatchProof, seat: MatchProof['players'][number])
{
    const domain = keccak(join(hashOf(DOMAIN), hashOf('ArcadeVault'), hashOf('1'), word(BigInt(proof.chainId)), word(BigInt(proof.vault))));
    const stake = keccak(join(
        hashOf(STAKE),
        word(BigInt(seat.address)),
        hashOf(proof.game),
        word(BigInt(proof.amount)),
        word(BigInt(proof.feeBps)),
        bytesOf(seat.commit),
        bytesOf(seat.nonce),
        word(BigInt(seat.deadline))
    ));

    return keccak(join(new Uint8Array([0x19, 0x01]), domain, stake));
}

const canonical = (value: unknown): unknown =>
{
    if (Array.isArray(value))
    {
        return value.map(canonical);
    }

    if (value !== null && typeof value === 'object')
    {
        const held = value as Record<string, unknown>;

        return Object.fromEntries(Object.keys(held).sort().map((key) => [key, canonical(held[key])]));
    }

    return value;
};

const spelt = (value: unknown) => JSON.stringify(canonical(JSON.parse(JSON.stringify(value) ?? 'null')));

const revOf = (state: unknown) => (state as { rev: number }).rev;

export function replay(proof: MatchProof, seed: Uint8Array)
{
    const total = proof.actions.length;
    const engine = ENGINES.get(proof.game);
    const [opening, ...rest] = proof.actions;
    const domain = proof.randomness === undefined ? undefined : { id: proof.randomness.matchId, game: proof.game };
    const at = (rev: number) =>
    {
        const source = drawsOf(mac, seed, rev, domain);

        return domain === undefined
            ? { draws: source, audit: () => null }
            : trackedDraws('stake-v2', rev, (limit) => source.die(limit) - 1);
    };
    const drawnAsRecorded = (action: MatchProof['actions'][number], roll: ReturnType<typeof at>) =>
        domain === undefined || (action.randomness !== undefined && spelt(roll.audit()) === spelt(JSON.parse(action.randomness)));

    if (engine === undefined || opening === undefined || opening.kind !== 'open' || opening.rev !== OPENING)
    {
        return { moves: 0, total, wrong: { rev: opening?.rev ?? OPENING, said: opening?.events ?? '', drawn: '' } };
    }

    const openingPayload = JSON.parse(opening.payload) as { config?: TableConfig };
    const config = domain === undefined ? undefined : openingPayload.config;
    const lead = at(OPENING);
    const made = engine.create(proof.seats, lead.draws, config ?? { target: proof.target, cube: proof.cube, blinds: proof.blinds, variant: proof.variant });

    if (revOf(made.state) !== OPENING || spelt(made.events) !== spelt(JSON.parse(opening.events)) || !drawnAsRecorded(opening, lead))
    {
        return { moves: 0, total, wrong: { rev: OPENING, said: opening.events, drawn: JSON.stringify(made.events) } };
    }

    let state = made.state;
    let moves = 1;

    for (const action of rest)
    {
        const payload = JSON.parse(action.payload) as { verb?: string; moment?: Moment };
        const roll = at(action.rev);
        const asked = action.kind === 'forfeit'
            ? engine.forfeit(action.seat, payload.verb as ForfeitReason)
            : (payload.verb === 'auto'
                ? engine.autoplay(state, action.seat, roll.draws)
                : (payload.verb === 'resign' ? engine.concede?.(action.seat) ?? null : engine.parse(payload as MatchPlay, action.seat)));
        const outcome = asked === null ? null : engine.apply(state, asked, roll.draws, payload.moment);

        if (outcome === null || !outcome.ok || revOf(outcome.state) !== action.rev
            || spelt(outcome.events) !== spelt(JSON.parse(action.events)) || !drawnAsRecorded(action, roll))
        {
            return { moves, total, wrong: { rev: action.rev, said: action.events, drawn: outcome?.ok === true ? JSON.stringify(outcome.events) : '' } };
        }

        state = outcome.state;
        moves += 1;
    }

    if (proof.randomness !== undefined)
    {
        const { lastRev, voided } = proof.randomness;
        const expected = lastRev - (voided ? 1 : 0);

        if (revOf(state) !== expected || (engine.finish(state) === null) !== voided)
        {
            return { moves, total, wrong: { rev: expected, said: String(expected), drawn: String(revOf(state)) } };
        }
    }

    return { moves, total, wrong: null };
}

export function check(proof: MatchProof, matchId?: string): Checked
{
    if (proof.randomness !== undefined)
    {
        const expected = stakeMatchId(keccak, proof.game, proof.players.map((seat) => ({ commitment: seat.commit, nonce: seat.nonce })));

        if (proof.randomness.matchId !== expected || (matchId !== undefined && expected !== matchId.toLowerCase()))
        {
            throw new Error('Randomness transcript belongs to a different match.');
        }
    }

    const seed = seedOf(keccak, proof.players.map((seat) => seat.secret), proof.players.map((seat) => seat.signature), proof.randomness === undefined ? 1 : 2);
    const seats = proof.players.map((seat) => ({
        seat: seat.seat,
        who: seat.who,
        address: seat.address,
        commit: seat.commit,
        signed: addressFrom(stakeDigest(proof, seat), seat.signature) === seat.address.toLowerCase(),
        kept: hexOf(keccak(bytesOf(seat.secret))) === seat.commit.toLowerCase()
    }));

    return { seed: hexOf(seed), seats, ...replay(proof, seed) };
}
