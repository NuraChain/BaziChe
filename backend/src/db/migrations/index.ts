import type { MigrationInterface } from 'typeorm';
import { RewardSchema1760000000000 } from './1760000000000-RewardSchema.ts';
import { FillMessengerColumns1793682422851 } from './1793682422851-FillMessengerColumns.ts';
import { RewardGrantSourceKey1794600000000 } from './1794600000000-RewardGrantSourceKey.ts';
import { RewardPayoutRecovery1794600001000 } from './1794600001000-RewardPayoutRecovery.ts';

/**
 * Every migration, oldest first, listed by hand: a glob would resolve against the working directory
 * and pick up a stale compiled file, as `data-source.ts` explains of the entities.
 *
 * Each is named `<milliseconds>-<Name>.ts` by `npm run migration:new <Name>`, which also adds it
 * here. Timestamps rather than 0001, 0002: two people adding a migration the same day would both
 * write 0002. `migrate.spec.ts` holds the folder and this list to one another.
 *
 * A file is only for what the entities cannot say (rows moved, a column renamed with its values):
 * every other change a start makes by itself from the entities, as a version (`migrate.ts`).
 */
export const MIGRATIONS: (new () => MigrationInterface)[] = [
    RewardSchema1760000000000,
    FillMessengerColumns1793682422851,
    RewardGrantSourceKey1794600000000,
    RewardPayoutRecovery1794600001000
];
