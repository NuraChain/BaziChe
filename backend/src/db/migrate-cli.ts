import 'reflect-metadata';

import { dataSource } from '../data-source.ts';
import { loadServerConfig } from '../env.ts';
import { migrate, migrationSource, targetOf } from './migrate.ts';

/**
 * `npm run migrate`: what every start does to the database, by hand: built when empty, adopted when
 * it predates versions, every migration not yet applied run in order. A start does it anyway; this
 * is for a database a person wants brought up to date without starting the server.
 */
loadServerConfig();

const migrator = migrationSource(dataSource.options);
const say = (event: string, fields: Record<string, unknown> = {}) => process.stdout.write(`${ event }${ Object.keys(fields).length > 0 ? ` ${ JSON.stringify(fields) }` : '' }\n`);

await migrator.initialize();

try
{
    const done = await migrate(targetOf(migrator), { info: say, warn: say });

    say(done.done === 'migrated' ? `migrated: ${ done.applied.length === 0 ? 'nothing was pending' : done.applied.join(', ') }` : done.done);
}
finally
{
    await migrator.destroy();
}
