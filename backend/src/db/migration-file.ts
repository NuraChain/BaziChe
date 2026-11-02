import type { Statement } from './drift.ts';

/** A migration's name as it is typed: a word in PascalCase, the file and the class named after it. */
export const MIGRATION_NAME = /^[A-Z][A-Za-z0-9]{2,63}$/;

const sql = (statement: Statement) => statement.parameters !== undefined && statement.parameters.length > 0
    ? `        await runner.query(${ JSON.stringify(statement.query) }, ${ JSON.stringify(statement.parameters) });`
    : `        await runner.query(${ JSON.stringify(statement.query) });`;

/**
 * A migration's source: the statements that bring the database from the last version to this one,
 * and those that take it back. The SQL is written as string literals, so whatever it holds is text,
 * never code.
 */
export function migrationSourceOf(name: string, at: number, up: readonly Statement[], down: readonly Statement[])
{
    const kind = `${ name }${ at }`;

    return [
        `import type { MigrationInterface, QueryRunner } from 'typeorm';`,
        ``,
        `/** Written by npm run migration:new ${ name }. Read it before it ships: it runs on every database at its next start. */`,
        `export class ${ kind } implements MigrationInterface`,
        `{`,
        `    name = '${ kind }';`,
        ``,
        `    async up(runner: QueryRunner)`,
        `    {`,
        ...up.map(sql),
        `    }`,
        ``,
        `    async down(runner: QueryRunner)`,
        `    {`,
        ...down.map(sql),
        `    }`,
        `}`,
        ``
    ].join('\n');
}

/** The migrations list with one more at its end: its import beside the others, its class last in the array. */
export function registered(index: string, name: string, at: number)
{
    const kind = `${ name }${ at }`;
    const lines = index.split('\n');
    const lastImport = lines.reduce((found, line, at_) => (line.startsWith('import ') ? at_ : found), -1);

    lines.splice(lastImport + 1, 0, `import { ${ kind } } from './${ at }-${ name }.ts';`);

    const joined = lines.join('\n');
    // The array after ` = [`, not the `[]` of its type nor the `=` of its `=>`.
    const start = joined.indexOf('= [', joined.indexOf('export const MIGRATIONS')) + 2;
    const end = joined.indexOf('];', start);
    const entries = joined.slice(start + 1, end).split(',').map((one) => one.trim()).filter((one) => one !== '');

    return `${ joined.slice(0, start) }[\n${ [...entries, kind].map((one) => `    ${ one }`).join(',\n') }\n]${ joined.slice(end + 1) }`;
}
