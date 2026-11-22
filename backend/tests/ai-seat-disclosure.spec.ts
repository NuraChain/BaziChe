import { expect, it } from 'vitest';

import { matchPlayer, tableSeat } from '../src/schemas.ts';
import { envelopeOf } from '../src/domains/match/envelope.ts';

it('exposes only the public AI marker on AI seats, through both waiting and match wire schemas', () =>
{
    const common = { seat: 0, who: 'sam', result: null, exit: null, timeouts: null, rating_before: null, rating_after: null };
    const rows = [{ ...common, ai: true, skill: 'advanced', style: 77 }, { ...common, seat: 1, who: 'robotFan', ai: false }];
    for (const finished of [true, false])
    {
        const players = envelopeOf(null, {}, rows, finished, { seats: 2, variant: 'standard' });
        expect(players.map((seat) => matchPlayer.parse(seat))).toEqual([
            { seat: 0, who: 'sam', ai: true }, { seat: 1, who: 'robotFan' }
        ]);
    }

    expect(tableSeat.parse({ seat: 0, who: 'sam', ai: true, ready: true, host: false })).toMatchObject({ ai: true });
    expect(tableSeat.parse({ seat: 1, ready: false, host: false })).not.toHaveProperty('ai');
});
