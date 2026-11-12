/**
 * `npm run check`: the quick gate while working. The same typechecks as `azeroth check` and the
 * server's spec typecheck, with what each can keep between runs kept, and the two halves side by side.
 *
 * - The server's typechecks are incremental, each with a `.tsbuildinfo` of its own under
 *   `node_modules/.cache/check/`. Never the server's tsconfig: `azeroth build` emits through that
 *   file, and a build that shares a `.tsbuildinfo` with a check that emits nothing can believe it
 *   is already up to date (`backend/tsconfig.json` says so beside `useDefineForClassFields`).
 * - The browser's typecheck (`azeroth-tsc`) keeps nothing, so it runs whole, beside the server.
 *
 * Each half runs its steps in turn, so no more than two TypeScript programs are in memory at once.
 * What a step printed is held and shown under its name once it ends, so two halves never interleave.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const at = (path) => fileURLToPath(new URL(`../${ path }`, import.meta.url));
const cache = at('node_modules/.cache/check/');

mkdirSync(cache, { recursive: true });

const TSC = at('node_modules/typescript/bin/tsc');
const AZEROTH_TSC = at('node_modules/@azerothjs/language-server/dist/tsc-cli.js');

const LANES = [
    [
        { label: 'api typecheck', cwd: 'backend', script: TSC, args: ['--noEmit', '-p', 'tsconfig.json', '--incremental', '--tsBuildInfoFile', `${ cache }backend.tsbuildinfo`] },
        { label: 'api specs typecheck', cwd: 'backend', script: TSC, args: ['--noEmit', '-p', 'tsconfig.test.json', '--incremental', '--tsBuildInfoFile', `${ cache }backend-tests.tsbuildinfo`] }
    ],
    [
        { label: 'web typecheck', cwd: 'frontend', script: AZEROTH_TSC, args: [] }
    ]
];

const run = (step) => new Promise((resolve) =>
{
    const started = Date.now();
    const said = [];
    const child = spawn(process.execPath, [step.script, ...step.args], { cwd: `${ root }${ step.cwd }`, env: process.env });

    child.stdout.on('data', (chunk) => said.push(chunk));
    child.stderr.on('data', (chunk) => said.push(chunk));
    child.on('close', (code) =>
    {
        const seconds = ((Date.now() - started) / 1000).toFixed(1);
        const text = Buffer.concat(said).toString().trim();

        process.stdout.write(`${ code === 0 ? '✓' : '✗' } ${ step.label } (${ seconds }s)\n${ code === 0 || text === '' ? '' : `${ text }\n` }`);
        resolve(code === 0);
    });
});

const lane = async (steps) =>
{
    let passed = true;

    for (const step of steps)
    {
        passed = await run(step) && passed;
    }

    return passed;
};

const results = await Promise.all(LANES.map(lane));

if (results.every(Boolean))
{
    process.stdout.write('all checks passed. Before a push: npm run check:full\n');
}
else
{
    process.exitCode = 1;
}
