import { randomInt } from 'node:crypto';
import { trackedDraws, type RandomnessProtocol } from './randomness.ts';

export class RandomnessError extends Error {}

export function secureBelow(limit: number)
{
    try
    {
        return randomInt(0, limit);
    }
    catch (cause)
    {
        throw new RandomnessError('Secure random integer generation failed.', { cause });
    }
}

export function gameRandomness(protocol: RandomnessProtocol, rev: number, below = secureBelow)
{
    return trackedDraws(protocol, rev, below);
}
