/**
 * How long a table holds what an action ENDED, in milliseconds, for the people at it to see: a
 * trick taken, the hands shown down, a pot on its winner, a hand's result, a game inside a match, and
 * the end of the match before its result. The boards hold each moment this long, and nothing that
 * follows in the same answer cuts it short. What an action ended is added to the deadline of whoever
 * is to act next (`Engine.pause`), so watching a showdown costs nobody their turn. It imports nothing,
 * so the browser holds the same numbers.
 */
export const PAUSES = {
    showdown: 3000,
    pot: 1500,
    trick: 1100,
    hand: 2600,
    game: 3000,
    end: 2800
} as const;
