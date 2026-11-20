import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import { launchChrome } from '../chrome.mjs';

const origin = new URL(process.env.QA_BASE ?? 'http://localhost:5300').origin;
const axe = process.env.QA_AXE_PATH;
const session = process.env.QA_SESSION;
const routes = process.argv.slice(2);

assert.ok(axe, 'Set QA_AXE_PATH to a local axe-core/axe.min.js file.');
assert.ok(routes.length, 'Pass at least one route, for example /sign-in or /app/games.');
assert.ok(routes.every((route) => route.startsWith('/') && new URL(route, origin).origin === origin), 'Use paths on the QA origin.');

const browser = await launchChrome();
try
{
    for (const [locale, width, height] of [['en', 1440, 900], ['fa', 390, 844]])
    {
        const context = await browser.newContext({
            viewport: { width, height }, locale, isMobile: width < 500, hasTouch: width < 500, reducedMotion: 'reduce',
            bypassCSP: true
        });
        try
        {
            const cookies = [{ name: 'locale', value: locale }, { name: 'baziche-theme', value: 'light' }];
            if (session)
            {
                const split = session.indexOf('=');
                assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname), 'Use a local QA instance for signed checks.');
                assert.ok(split > 0 && split < session.length - 1, 'QA_SESSION must contain a test name=value cookie.');
                cookies.push({ name: session.slice(0, split), value: session.slice(split + 1) });
            }
            await context.addCookies(cookies.map((cookie) => ({ ...cookie, url: origin })));
            const page = await context.newPage();
            for (const route of routes)
            {
                const response = await page.goto(new URL(route, origin).href);
                assert.ok(response?.ok(), `Expected a successful response for ${ route }, got ${ response?.status() }`);
                await page.waitForLoadState('networkidle');
                await page.evaluate(() => document.fonts.ready.then(() => undefined));
                assert.equal(new URL(page.url()).pathname, new URL(route, origin).pathname, 'The route redirected. Use a session with the required role.');
                assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
                assert.equal(await page.locator('html').getAttribute('lang'), locale);
                await page.addScriptTag({ path: resolve(axe) });
                const results = await page.evaluate(() => window.axe.run(document, { runOnly: ['color-contrast'] }));
                const failed = results.violations.flatMap((rule) => rule.nodes);
                const passed = results.passes.reduce((count, rule) => count + rule.nodes.length, 0);
                const manual = results.incomplete.reduce((count, rule) => count + rule.nodes.length, 0);
                console.log(`${ locale } ${ width }×${ height } ${ route } — ${ passed } passed, ${ failed.length } failed, ${ manual } require manual inspection`);
                for (const node of failed)
                {
                    console.error(node.target.join(' '), node.failureSummary);
                }
                if (failed.length > 0)
                {
                    process.exitCode = 1;
                }
            }
        }
        finally
        {
            await context.close();
        }
    }
}
finally
{
    await browser.close();
}
