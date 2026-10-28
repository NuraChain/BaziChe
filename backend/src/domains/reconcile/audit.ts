import { cursorFor, type Keyed } from '../../lib/keyset.ts';
import type { CheckKind } from './kinds.ts';

/** What one side says, in words the admin translates: a state, an amount, an address, seats, a time. */
export type Words = Record<string, string>;

export interface Finding
{
    record: string;
    kind: CheckKind;
    db: Words;
    chain: Words;
    about: Words;

    /** Written in this pass through the family worker's own function. */
    putRight?: true;
}

export interface Audit
{
    compared: string[];
    found: Finding[];
    next: string | null;
    unreached: boolean;
    faults: { record: string; error: string }[];
}

export interface AuditAsk
{
    /** The records whose disagreements are open, read again whatever their age. */
    ids: readonly string[];
    after: string | null;
    deadline: number;
}

export type Auditor = (ask: AuditAsk) => Promise<Audit>;

/** How many records of a family one pass compares, and how many open disagreements' records it reads again. */
export const AUDIT_PAGE = 50;

/** A record that cannot change any more is compared for a week after it was made. */
export const RECENT = `interval '7 days'`;

/** A family this server keeps no contract for compares nothing. */
export const nothing = (): Audit => ({ compared: [], found: [], next: null, unreached: false, faults: [] });

/**
 * Compares the records whose disagreements are open, then one page, one record at a time until the
 * pass's time runs out, and says where the next page starts: after the last record compared, or
 * at the newest again once the page was the last. A record that `compare` answers null for is one a
 * worker has taken back, and is not counted as compared. A chain that cannot be reached ends the
 * family's pass with nothing said about the record it was reading.
 */
export async function audited<T extends Keyed>(rows: { again: readonly T[]; page: readonly T[]; after: string | null }, deadline: number, compare: (row: T) => Promise<Finding[] | null>)
{
    const audit: Audit = { compared: [], found: [], next: rows.after, unreached: false, faults: [] };
    const seen = new Set<string>();

    const one = async (row: T) =>
    {
        try
        {
            const found = await compare(row);

            if (found !== null)
            {
                audit.compared.push(row.id);
                audit.found.push(...found);
            }

            return true;
        }
        catch (error)
        {
            if ((error as { status?: number }).status === 503)
            {
                audit.unreached = true;
                return false;
            }

            audit.faults.push({ record: row.id, error: error instanceof Error ? error.message : String(error) });
            return true;
        }
    };

    for (const row of rows.again)
    {
        if (performance.now() > deadline || !await one(row))
        {
            return audit;
        }

        seen.add(row.id);
    }

    const page = rows.page.slice(0, AUDIT_PAGE);
    const more = rows.page.length > AUDIT_PAGE;

    for (const [at, row] of page.entries())
    {
        if (performance.now() > deadline || (!seen.has(row.id) && !await one(row)))
        {
            return audit;
        }

        audit.next = at === page.length - 1 && !more ? null : cursorFor(row.at_key, row.id);
    }

    if (page.length === 0)
    {
        audit.next = null;
    }

    return audit;
}
