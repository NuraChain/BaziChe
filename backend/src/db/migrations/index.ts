import type { MigrationInterface } from 'typeorm';

/**
 * Every migration, oldest first, listed by hand: a glob would resolve against the working directory
 * and pick up a stale compiled file, as `data-source.ts` explains of the entities.
 *
 * Each is named `<milliseconds>-<Name>.ts` by `npm run migration:new <Name>`, which also adds it
 * here. Timestamps rather than 0001, 0002: two people adding a migration the same day would both
 * write 0002. `migrations-list.spec.ts` holds the folder and this list to one another.
 *
 * Empty at first, and that is the baseline: the schema of 1.1.0 is the entities as they were, and a
 * database that met them was adopted as it stood (`migrate.ts`). Every change from here is a file.
 */
export const MIGRATIONS: (new () => MigrationInterface)[] = [];
