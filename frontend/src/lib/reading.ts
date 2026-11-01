import type { Getter } from 'azerothjs';

/**
 * Where a read stands. A list is empty only once its read has answered: until then it is being read,
 * and a read that failed is said as a failure, never as an empty list.
 */
export type Reading = 'reading' | 'failed' | 'read';

/** A resource that has answered once keeps its answer through a later read that fails, so it stays read. */
export const readingOf = (read: { data: Getter<unknown>; error: Getter<unknown> }) =>
    read.data() !== undefined ? 'read' : (read.error() === null ? 'reading' : 'failed');
