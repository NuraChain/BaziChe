import { HAND_BUILT_INDEX_NAMES } from './schema.ts';

/**
 * What TypeORM's schema builder would change to make the database match the entities, less what it
 * always says and never means.
 *
 * `log()` is never empty, even on a database `syncSchema` built a moment ago (`converge.db.spec.ts`
 * holds both wrinkles): it drops the hand-built DESC indexes, which it cannot express and takes for
 * strays, and it re-issues one column default Postgres renders in another spelling. Left in, every
 * generated migration would drop those indexes and every boot would report drift. Taken out here, in
 * one place, for the drift check and the generator alike.
 */
const NOISE: readonly RegExp[] = [
    ...HAND_BUILT_INDEX_NAMES.map((name) => new RegExp(`^DROP INDEX "public"\\."${ name }"$`)),
    /^ALTER TABLE "conversation_members" ALTER COLUMN "last_read_at" SET DEFAULT to_timestamp\(\(0\)::double precision\)$/
];

export interface Statement
{
    query: string;
    parameters?: unknown[];
}

/** The statements that would really change something. */
export const meaningful = <T extends Statement>(statements: readonly T[]) =>
    statements.filter((statement) => !NOISE.some((noise) => noise.test(statement.query.trim())));

/**
 * Statements that lose what is in the database: a table or a column dropped, a column's type
 * changed (which Postgres may refuse, or keep by casting). A migration holding one is applied only
 * because somebody wrote it and somebody reviewed it; adopting a database that would need one is
 * refused, and the generator says so loudly.
 */
const LOSES: readonly RegExp[] = [
    /^DROP TABLE\b/i,
    /^ALTER TABLE .+ DROP COLUMN\b/i,
    /^ALTER TABLE .+ ALTER COLUMN .+ TYPE\b/i,
    /^TRUNCATE\b/i,
    /^DELETE FROM\b/i
];

export const destructive = (statements: readonly Statement[]) =>
    statements.filter((statement) => LOSES.some((loses) => loses.test(statement.query.trim())));

/** Where a start keeps what a change would have lost: a table of its own per column or table, named for the version. */
export const KEPT_PREFIX = 'kept_';

const LOSES_COLUMN = /^ALTER TABLE (?:"[^"]+"\.)?"([^"]+)" (?:DROP COLUMN "([^"]+)"|ALTER COLUMN "([^"]+)" TYPE\b)/i;

const LOSES_TABLE = /^DROP TABLE (?:"[^"]+"\.)?"([^"]+)"/i;

const quoted = (name: string) => `"${ name.replaceAll('"', '""') }"`;

// Postgres cuts a name at 63 bytes, and two cut alike would meet: the version keeps them apart.
const keptName = (version: number, ...parts: string[]) => `${ KEPT_PREFIX }${ version }_${ parts.join('__') }`.slice(0, 63);

/**
 * The statements a start applies by itself, with a copy taken before each one that would lose rows:
 * a column dropped or retyped is copied with its table's primary key beside it, a table dropped is
 * copied whole. The copies hold no constraint, so nothing the product does is ever held up by one,
 * and the entities never name them, so no later diff sees them.
 */
export function keptFirst(statements: readonly Statement[], version: number, keysOf: (table: string) => readonly string[])
{
    const kept: string[] = [];
    const planned: Statement[] = [];

    for (const statement of statements)
    {
        const query = statement.query.trim();
        const table = LOSES_TABLE.exec(query);
        const column = LOSES_COLUMN.exec(query);

        if (table !== null)
        {
            const name = keptName(version, table[1]);

            if (!kept.includes(name))
            {
                kept.push(name);
                planned.push({ query: `CREATE TABLE ${ quoted(name) } AS TABLE ${ quoted(table[1]) }` });
            }
        }
        else if (column !== null)
        {
            const lost = column[2] ?? column[3];
            const name = keptName(version, column[1], lost);
            const keys = keysOf(column[1]).filter((key) => key !== lost);

            if (!kept.includes(name))
            {
                kept.push(name);
                planned.push({
                    query: keys.length === 0
                        ? `CREATE TABLE ${ quoted(name) } AS TABLE ${ quoted(column[1]) }`
                        : `CREATE TABLE ${ quoted(name) } AS SELECT ${ [...keys, lost].map(quoted).join(', ') } FROM ${ quoted(column[1]) }`
                });
            }
        }

        planned.push(statement);
    }

    return { statements: planned, kept };
}
