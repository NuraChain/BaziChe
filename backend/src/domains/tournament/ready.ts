/**
 * How long both players have, once a tournament table opens, to say they are ready. The game is
 * dealt the moment both have; at the end of it, whoever was ready wins by walkover, and a game
 * nobody turned up to has no winner, which the format's own rule for one settles.
 *
 * Counted from the table's own `created_at`, so it needs no column of its own and outlives a
 * restart: the sweep reads it off the row.
 */
export const READY_MS = 5 * 60_000;

/** The same, for SQL: when a table opened at `created` stops waiting. */
export const readyBySql = (created: string) => `${ created } + make_interval(secs => ${ READY_MS / 1000 })`;
