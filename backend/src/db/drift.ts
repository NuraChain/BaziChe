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
