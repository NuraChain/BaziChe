/**
 * The one way raw SQL asks whether a user is a system player, so a query that forgets to ask is
 * found by searching for the table name and nothing else. `column` is a column reference written by
 * the caller, never a value.
 */
export const isSystem = (column: string) => `exists (select 1 from system_players sp where sp.user_id = ${column})`;

export const notSystem = (column: string) => `not ${isSystem(column)}`;

/** Whether a match has a system player in any seat. `column` is the match id column. */
export const hasSystemSeat = (column: string) => `exists (
    select 1 from match_players smp
    join system_players sp on sp.user_id = smp.user_id
    where smp.match_id = ${column}
)`;
