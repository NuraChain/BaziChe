import 'reflect-metadata';

import { readFileSync, writeFileSync } from 'node:fs';

import { dataSource } from '../data-source.ts';
import { loadServerConfig } from '../env.ts';
import { destructive, meaningful } from './drift.ts';
import { migrationSource } from './migrate.ts';
import { MIGRATION_NAME, migrationSourceOf, registered } from './migration-file.ts';

/**
 * `npm run migration:new <Name>`: a migration file written from what the entities say and this
 * database does not yet hold, for a change whose rows must move, which a start cannot do by itself
 * (`migrate.ts`). Change the entity, run this against the development database, edit the file to
 * move the rows, start the server (which applies it), commit both.
 *
 * It refuses while a migration is still pending here, because the difference would then hold that
 * one's work a second time; and it refuses a migration that loses data (a table or a column dropped,
 * a type changed) unless `--allow-loss` says somebody meant it.
 */
loadServerConfig();

const name = process.argv[2] ?? '';
const allowLoss = process.argv.includes('--allow-loss');
const say = (line: string) => process.stdout.write(`${ line }\n`);

if (!MIGRATION_NAME.test(name))
{
    say('Name it in PascalCase, a word of 3 to 64 letters and digits: npm run migration:new AddChannelTopic');
    process.exit(1);
}

const SOURCE = new URL('../../backend/src/db/migrations/', import.meta.url);
const migrator = migrationSource(dataSource.options);

await migrator.initialize();

try
{
    if (await migrator.showMigrations())
    {
        say('A migration is still pending on this database: start the server once, or npm run migrate, then ask again.');
        process.exit(1);
    }

    const plan = await migrator.driver.createSchemaBuilder().log();
    const up = meaningful(plan.upQueries);
    const down = meaningful(plan.downQueries).reverse();

    if (up.length === 0)
    {
        say('The database already holds what the entities say: there is nothing to migrate.');
        process.exit(0);
    }

    const loses = destructive(up);

    if (loses.length > 0 && !allowLoss)
    {
        say('This would lose data. Read it, and if it is meant, ask again with --allow-loss:');
        loses.forEach((one) => say(`  ${ one.query }`));
        process.exit(1);
    }

    const at = Date.now();
    const file = new URL(`${ at }-${ name }.ts`, SOURCE);
    const index = new URL('index.ts', SOURCE);

    writeFileSync(file, migrationSourceOf(name, at, up, down));
    writeFileSync(index, registered(readFileSync(index, 'utf8'), name, at));

    say(`Wrote backend/src/db/migrations/${ at }-${ name }.ts, ${ up.length } statement${ up.length === 1 ? '' : 's' }:`);
    up.forEach((one) => say(`  ${ one.query }`));
    say('Read it, start the server to apply it here, and commit it with the entity change.');
}
finally
{
    await migrator.destroy();
}
