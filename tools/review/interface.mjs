import assert from 'node:assert/strict';

import { landing as en } from '../../frontend/src/locales/en/landing.ts';
import { landing as fa } from '../../frontend/src/locales/fa/landing.ts';
import { launchChrome } from '../chrome.mjs';

const base = process.env.QA_BASE ?? 'http://localhost:5300';

const cases = [
    { locale: 'en', words: en, width: 1280, height: 850, mobile: false },
    { locale: 'en', words: en, width: 320, height: 640, mobile: true },
    { locale: 'fa', words: fa, width: 390, height: 844, mobile: true },
    { locale: 'fa', words: fa, width: 844, height: 390, mobile: true }
];

const browser = await launchChrome();
try
{
    const localeContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    try
    {
        const page = await localeContext.newPage();
        for (const locale of ['en', 'fa', 'ar', 'es', 'pt', 'hi', 'zh', 'ru', 'fr', 'tr'])
        {
            await localeContext.addCookies([{ name: 'locale', value: locale, url: base }]);
            await page.goto(base);
            assert.equal(await page.locator('html').getAttribute('lang'), locale);
            assert.equal(await page.locator('html').getAttribute('dir'), locale === 'fa' || locale === 'ar' ? 'rtl' : 'ltr');
        }
        console.log('All ten locale choices survive a full-page load');
    }
    finally
    {
        await localeContext.close();
    }

    for (const scenario of cases)
    {
        const context = await browser.newContext({
            viewport: { width: scenario.width, height: scenario.height },
            isMobile: scenario.mobile,
            hasTouch: scenario.mobile,
            reducedMotion: 'reduce'
        });
        try
        {
            const page = await context.newPage();
            await context.addCookies([{ name: 'locale', value: scenario.locale, url: base }]);
            await page.goto(base);
            const words = scenario.words;
            const menu = page.getByRole('button', { name: words['nav.menu'], exact: true });
            const drawer = page.getByRole('dialog', { name: words['nav.menu'], exact: true });
            await menu.click();
            const theme = drawer.getByRole('group', { name: words['theme.label'], exact: true });
            await theme.getByRole('button', { name: words['theme.light'], exact: true }).click();
            assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
            assert.equal(await theme.getByRole('button', { name: words['theme.light'], exact: true }).getAttribute('aria-pressed'), 'true');
            await page.keyboard.press('Escape');
            await drawer.waitFor({ state: 'hidden' });

            await page.reload();
            assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
            assert.equal(await page.locator('meta[name="theme-color"]').getAttribute('content'), '#EDF2F7');
            assert.equal(await page.locator('html').getAttribute('dir'), scenario.locale === 'fa' ? 'rtl' : 'ltr');

            const opener = page.locator('.site-header').getByRole('button', { name: words['nav.connect'], exact: true });
            await opener.click();
            const wallet = page.getByRole('dialog');
            await wallet.waitFor();
            await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'dialog');
            assert.equal(await page.locator('#root').evaluate((root) => root.inert), true);
            for (const key of ['Shift+Tab', ...Array(14).fill('Tab'), ...Array(14).fill('Shift+Tab')])
            {
                await page.keyboard.press(key);
                assert.equal(await wallet.evaluate((dialog) => dialog.contains(document.activeElement)), true, `${ key } escaped the wallet dialog`);
            }

            await page.keyboard.press('Escape');
            await wallet.waitFor({ state: 'detached' });
            assert.equal(await page.locator('#root').evaluate((root) => root.inert), false);
            assert.equal(await opener.evaluate((button) => document.activeElement === button), true);

            console.log(`${ scenario.locale } ${ scenario.width }×${ scenario.height } appearance and wallet keyboard regression passed`);
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
