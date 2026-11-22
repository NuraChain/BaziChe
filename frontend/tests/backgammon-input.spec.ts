import { describe, expect, it } from 'vitest';
import { BAR_LEFT, BAR_WIDTH, HEIGHT, MIDDLE, POINT_WIDTH, TRAY_LEFT, WIDTH, columnOf, inputSpotAt } from '../src/game/backgammon-layout.ts';

describe('backgammon touch columns', () =>
{
    it('gives the whole stack and its empty point the same destination, right up to the rim', () =>
    {
        for (let point = 1; point <= 24; point += 1)
        {
            const column = columnOf(point);
            for (const fraction of [0.01, 0.5, 0.99])
            {
                const x = column.x + fraction * POINT_WIDTH;
                for (const y of column.row === 'top' ? [0, 80, MIDDLE - 1] : [MIDDLE, 720, HEIGHT - 1])
                {
                    expect(inputSpotAt(x, y)).toBe(point);
                }
            }
        }
    });

    it('maps the bar and tray independently and rejects releases outside any board edge', () =>
    {
        expect(inputSpotAt(BAR_LEFT + BAR_WIDTH / 2, MIDDLE)).toBe(25);
        expect(inputSpotAt(TRAY_LEFT, MIDDLE)).toBe(0);
        expect(inputSpotAt(WIDTH - 1, MIDDLE)).toBe(0);
        for (const [x, y] of [[BAR_LEFT + 1, -1], [TRAY_LEFT + 1, HEIGHT], [-1, MIDDLE], [WIDTH, MIDDLE]])
        {
            expect(inputSpotAt(x, y)).toBeNull();
        }
    });
});
