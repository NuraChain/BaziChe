// The last step of `npm run build`: a marker of the finished build, which a running server compares
// with the one it started on (`backend/src/http/build-watch.ts`). Under `.vite`, a dot segment the
// static server never serves.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const CLIENT = new URL('../.dist-frontend/', import.meta.url);
const shell = readFileSync(new URL('shell.html', CLIENT));
const id = createHash('sha256').update(shell).digest('hex').slice(0, 16);

mkdirSync(new URL('.vite/', CLIENT), { recursive: true });
writeFileSync(new URL('.vite/built.json', CLIENT), `${ JSON.stringify({ id }) }\n`);

console.log(`  built        ${ id }`);
