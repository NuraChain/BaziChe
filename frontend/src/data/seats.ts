import type { GameId } from './games.ts';

/**
 * How many can sit at each game's table, smallest first.
 *
 * Apart from the rest of a table's rules because the landing says these and nothing else: through
 * `TABLE_RULES` it carried the server's clocks and teams into a first chunk with no room for them.
 */
export const SEATS: Readonly<Record<GameId, readonly number[]>> = {
    hokm: [2, 3, 4],
    poker: [2, 6, 9],
    backgammon: [2],
    ludo: [2, 3, 4],
    chess: [2]
};
