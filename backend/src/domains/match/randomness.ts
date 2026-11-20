export type Shuffle = <T>(items: readonly T[]) => T[];

export const MATCH_RANDOMNESS_PROTOCOLS = ['server-v2', 'stake-v2'] as const;

export type MatchRandomnessProtocol = typeof MATCH_RANDOMNESS_PROTOCOLS[number];

export type RandomnessProtocol = MatchRandomnessProtocol | 'server-v1' | 'stake-v1';

type RandomDraw =
    | { kind: 'die'; sides: number; face: number }
    | { kind: 'shuffle'; count: number; swaps: number[] };

export interface RandomnessAudit
{
    protocol: RandomnessProtocol;
    algorithm: 'node:crypto.randomInt' | 'hmac-sha256/rejection32';
    rulesVersion: 1 | 2;
    rev: number;
    draws: RandomDraw[];
}

export function shuffle<T>(items: readonly T[], below: (limit: number) => number)
{
    const order = [...items];

    for (let index = order.length - 1; index > 0; index -= 1)
    {
        const other = below(index + 1);

        if (!Number.isSafeInteger(other) || other < 0 || other > index)
        {
            throw new RangeError('Shuffle index is outside its range.');
        }

        [order[index], order[other]] = [order[other], order[index]];
    }

    return order;
}

export function trackedDraws(protocol: RandomnessProtocol, rev: number, below: (limit: number) => number)
{
    const history: RandomDraw[] = [];
    const modern = protocol === 'server-v2' || protocol === 'stake-v2';

    const sample = (limit: number) =>
    {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2 ** 32)
        {
            throw new RangeError('Random range is outside the supported bounds.');
        }

        const value = below(limit);

        if (!Number.isSafeInteger(value) || value < 0 || value >= limit)
        {
            throw new RangeError('Random value is outside its requested range.');
        }

        return value;
    };

    const die = (sides: number) =>
    {
        const face = sample(sides) + 1;

        history.push({ kind: 'die', sides, face });

        return face;
    };

    const shuffled: Shuffle = (items) =>
    {
        const swaps: number[] = [];
        const order = shuffle(items, (limit) =>
        {
            const index = sample(limit);

            swaps.push(index);

            return index;
        });

        history.push({ kind: 'shuffle', count: items.length, swaps });

        return order;
    };

    const audit = (): RandomnessAudit | null => history.length === 0 ? null : {
        protocol,
        algorithm: protocol.startsWith('stake-') ? 'hmac-sha256/rejection32' : 'node:crypto.randomInt',
        rulesVersion: modern ? 2 : 1,
        rev,
        draws: [...history]
    };

    return { draws: { die, ...(modern ? { shuffle: shuffled } : {}) }, audit };
}
