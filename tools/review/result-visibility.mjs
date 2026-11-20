import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchChrome } from '../chrome.mjs';

export async function verifyResultVisibility(page, { origin, table })
{
    const tablePath = `/app/play/${ table }`;

    await page.addInitScript(() =>
    {
        let hidden = false;
        let startedAt = null;
        let leftAt = null;

        Object.defineProperties(document, {
            hidden: { configurable: true, get: () => hidden },
            visibilityState: { configurable: true, get: () => hidden ? 'hidden' : 'visible' }
        });

        window.resultReview = {
            get startedAt() { return startedAt; },
            get leftAt() { return leftAt; },
            hide(next)
            {
                hidden = next;
                document.dispatchEvent(new Event('visibilitychange'));
                return Date.now();
            }
        };

        const onScreen = new IntersectionObserver((entries) =>
        {
            if (entries.some((entry) => entry.isIntersecting))
            {
                startedAt = Date.now();
                onScreen.disconnect();
            }
        });
        const inserted = new MutationObserver(() =>
        {
            const panel = document.querySelector('.table-result');

            if (panel !== null)
            {
                inserted.disconnect();
                onScreen.observe(panel);
            }
        });
        inserted.observe(document, { childList: true, subtree: true });

        const replace = history.replaceState;
        history.replaceState = function (...args)
        {
            const result = replace.apply(this, args);

            if (location.pathname === '/app/games' && leftAt === null)
            {
                leftAt = Date.now();
            }

            return result;
        };
    });

    await page.clock.install();
    await page.goto(`${ origin }${ tablePath }`);
    const result = page.locator('.table-result').getByRole('heading', { level: 2 });
    await result.waitFor({ state: 'visible' });
    await page.waitForFunction(() => window.resultReview.startedAt !== null);
    const heading = await result.innerText();
    const pauseAt = await page.evaluate(() => Date.now() + 250);
    await page.clock.pauseAt(pauseAt);
    await page.clock.runFor(2_500);

    const hideAt = await page.evaluate(() => window.resultReview.hide(true));
    const startAt = await page.evaluate(() => window.resultReview.startedAt);
    const initial = hideAt - startAt;

    if (initial < 2_500 || initial > 6_000)
    {
        throw new Error(`The result was active for ${ initial } ms before the visibility change`);
    }

    await page.clock.runFor(12_000);

    if (new URL(page.url()).pathname !== tablePath || !await result.isVisible())
    {
        throw new Error('The result left while the document was hidden');
    }

    const showAt = await page.evaluate(() => window.resultReview.hide(false));
    await page.clock.runFor(9_750 - initial);

    if (new URL(page.url()).pathname !== tablePath)
    {
        throw new Error('The result left before ten foreground seconds');
    }

    await page.clock.runFor(750);
    await page.waitForURL((url) => url.pathname === '/app/games');
    const leftAt = await page.evaluate(() => window.resultReview.leftAt);
    const foregroundMs = initial + (leftAt - showAt);

    if (leftAt === null || foregroundMs < 9_750 || foregroundMs > 10_250)
    {
        throw new Error(`Expected ten foreground seconds, measured ${ foregroundMs } ms`);
    }

    return { heading, visibility: 'injected Page Visibility events', clock: 'Playwright virtual clock', hiddenMs: showAt - hideAt, foregroundMs, path: new URL(page.url()).pathname };
}

async function run()
{
    const base = new URL(process.env.QA_BASE ?? 'http://localhost:5300');
    const table = process.env.QA_RESULT_TABLE ?? '';
    const cookie = process.env.QA_RESULT_SESSION ?? '';
    const equals = cookie.indexOf('=');

    assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Use a loopback QA build');
    assert.match(table, /^[\w-]+$/, 'Set QA_RESULT_TABLE to an ended table for the QA account');
    assert.ok(equals > 0 && equals < cookie.length - 1, 'Set QA_RESULT_SESSION to the QA account’s session cookie pair');

    const browser = await launchChrome();
    try
    {
        const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } });
        await context.addCookies([
            { url: base.origin, name: cookie.slice(0, equals), value: cookie.slice(equals + 1), httpOnly: true },
            { url: base.origin, name: 'locale', value: 'en' }
        ]);
        console.log(JSON.stringify(await verifyResultVisibility(await context.newPage(), { origin: base.origin, table })));
    }
    finally
    {
        await browser.close();
    }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url))
{
    await run();
}
