import { BAR, HOME, OFF, facing, type Side } from '../../match/backgammon/board.ts';

/**
 * A move generator of the agent's own for looking ahead. The engine's `turns` is the judge of what
 * the agent sends; this one only has to reach the same set of positions quickly, so it walks
 * doubles in falling order of the point moved from and keeps positions, never paths.
 */

/** The 21 distinct rolls, each with how many of the 36 it stands for. */
export const ROLLS: readonly (readonly [number, number, number])[] = Object.freeze(rollsOf());

function rollsOf()
{
    const rolls: (readonly [number, number, number])[] = [];

    for (let high = 1; high <= 6; high += 1)
    {
        for (let low = 1; low <= high; low += 1)
        {
            rolls.push(Object.freeze([high, low, high === low ? 1 : 2] as const));
        }
    }

    return rolls;
}

/** The same side seen from the other seat. */
export const turned = (side: Side): Side => ({ me: side.them, them: side.me });

function allHome(me: readonly number[])
{
    for (let point = HOME + 1; point <= BAR; point += 1)
    {
        if (me[point] > 0)
        {
            return false;
        }
    }

    return true;
}

/** The engine's `canStep`, over the same arrays. */
export function canStep(me: readonly number[], them: readonly number[], from: number, die: number)
{
    if (me[from] === 0 || (me[BAR] > 0 && from !== BAR))
    {
        return false;
    }

    const to = from - die;

    if (to > OFF)
    {
        return them[facing(to)] < 2;
    }

    if (!allHome(me))
    {
        return false;
    }

    if (to === OFF)
    {
        return true;
    }

    for (let point = from + 1; point <= HOME; point += 1)
    {
        if (me[point] > 0)
        {
            return false;
        }
    }

    return true;
}

/** One checker moved: a new side, the old one untouched. */
export function stepped(side: Side, from: number, die: number): Side
{
    const me = side.me.slice();
    const to = Math.max(OFF, from - die);

    me[from] -= 1;
    me[to] += 1;

    if (to !== OFF && side.them[facing(to)] === 1)
    {
        const them = side.them.slice();

        them[facing(to)] = 0;
        them[BAR] += 1;

        return { me, them };
    }

    return { me, them: side.them };
}

function keyOf(side: Side)
{
    let key = '';

    for (let point = 0; point <= BAR; point += 1)
    {
        key += String.fromCharCode(48 + side.me[point], 48 + side.them[point]);
    }

    return key;
}

/**
 * Every distinct position one roll can leave, under the engine's rules: as many dice as can be
 * played, and the higher die when only one can. A roll that cannot be played leaves the side as it is.
 */
export function positionsAfter(side: Side, high: number, low: number): Side[]
{
    const found = new Map<string, Side>();
    let most = 0;
    let highOnly = false;

    const keep = (at: Side, used: number, usedHigh: boolean) =>
    {
        if (used < most)
        {
            return;
        }

        if (used > most)
        {
            most = used;
            found.clear();
            highOnly = false;
        }

        // With one die playable, the higher one wins whenever it can be played at all.
        if (used === 1 && high !== low)
        {
            if (usedHigh && !highOnly)
            {
                highOnly = true;
                found.clear();
            }
            else if (!usedHigh && highOnly)
            {
                return;
            }
        }

        const key = keyOf(at);

        if (!found.has(key))
        {
            found.set(key, at);
        }
    };

    if (high === low)
    {
        const walk = (at: Side, left: number, below: number) =>
        {
            let moved = false;

            if (left > 0)
            {
                for (let from = below; from >= 1; from -= 1)
                {
                    if (canStep(at.me, at.them, from, high))
                    {
                        moved = true;
                        walk(stepped(at, from, high), left - 1, from);
                    }
                }
            }

            if (!moved)
            {
                keep(at, 4 - left, false);
            }
        };

        walk(side, 4, BAR);

        return [...found.values()];
    }

    let any = false;

    for (const [first, second] of [[high, low], [low, high]])
    {
        for (let from = BAR; from >= 1; from -= 1)
        {
            if (!canStep(side.me, side.them, from, first))
            {
                continue;
            }

            any = true;

            const once = stepped(side, from, first);
            let twice = false;

            for (let next = BAR; next >= 1; next -= 1)
            {
                if (canStep(once.me, once.them, next, second))
                {
                    twice = true;
                    keep(stepped(once, next, second), 2, false);
                }
            }

            if (!twice)
            {
                keep(once, 1, first === high);
            }
        }
    }

    if (!any)
    {
        keep(side, 0, false);
    }

    return [...found.values()];
}
