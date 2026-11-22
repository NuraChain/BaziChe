import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { prerender } from '@azerothjs/kit/prerender';

const LOCALES = ['en', 'fa', 'ar', 'es', 'pt', 'hi', 'zh', 'ru', 'fr', 'tr'];

const RTL = new Set(['fa', 'ar']);

const client = resolve(import.meta.dirname, '..', '.dist-frontend');
const entry = await import(pathToFileURL(resolve(import.meta.dirname, '..', '.dist-server', 'entry.server.js')).href);

const written = await prerender({
    routes: entry.routes,
    clientDir: client,
    renderer: entry.renderPage,
    locales: LOCALES
});

console.log(`  prerender   ${ written.join(', ') }`);

const BESIDE = '(min-width: 64rem), (orientation: landscape) and (max-height: 540px) and (min-aspect-ratio: 4/3)';

const UPRIGHT = '(max-width: 63.99rem) and (not ((orientation: landscape) and (max-height: 540px) and (min-aspect-ratio: 4/3)))';

function escapeMeta(text)
{
    return text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

for (const locale of LOCALES)
{
    const { landing } = await import(`../frontend/src/locales/${ locale }/landing.ts`);
    const title = escapeMeta(`${ landing['brand.name'] } · ${ landing['landing.arrival.lead'] } ${ landing['landing.arrival.accent'] }`);
    const description = escapeMeta(landing['landing.arrival.body']);
    const wide = RTL.has(locale) ? 'poster-wide-rtl' : 'poster-wide-ltr';
    const preload = [
        `<link rel="preload" as="image" href="/world/poster-portrait.webp" type="image/webp" media="${ UPRIGHT }" fetchpriority="high"/>`,
        `<link rel="preload" as="image" href="/world/${ wide }.webp" type="image/webp" media="${ BESIDE }" fetchpriority="high"/>`
    ].join('');

    const names = locale === 'en' ? ['index.en.html', 'index.html'] : [`index.${ locale }.html`];
    for (const name of names)
    {
        const file = resolve(client, name);
        const page = readFileSync(file, 'utf8')
            .replace(/<title>[^<]*<\/title>/, () => `<title>${ title }</title>`)
            .replace(/(<meta (?:name="description"|property="og:description") content=")[^"]*/g, (_tag, start) => start + description)
            .replace(/(<meta property="og:title" content=")[^"]*/, (_tag, start) => start + title);
        const hasPreload = page.includes('/world/poster-portrait.webp" type="image/webp" media');
        writeFileSync(file, hasPreload ? page : page.replace('</head>', () => `${ preload }</head>`));
    }
}
