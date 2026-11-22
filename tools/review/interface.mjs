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

const tables = ['hokm', 'poker', 'backgammon', 'ludo', 'chess'];

async function checkTour(page)
{
    const chooser = page.locator('.header-table-picker');
    assert.equal(await page.locator('.landing-intro > nav.landing-quick a').count(), tables.length);
    const firstChapter = await page.locator('#games').evaluate(el => el.getBoundingClientRect().top + scrollY);
    for (const fraction of [0.35, 0.7, 0.97])
    {
        await page.evaluate(y => window.scrollTo(0, y), firstChapter * fraction);
        await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
        const linksOnScreen = await page.locator('.landing-quick').evaluate(el =>
            el.getBoundingClientRect().bottom > document.querySelector('.site-header').getBoundingClientRect().bottom);
        assert.ok(!(linksOnScreen && await chooser.isVisible()), 'two game choosers are on screen during the handover');
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('.landing-actions a[href="#games"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForURL((url) => url.hash === '#games');
    const picker = page.locator('.header-table-picker select');
    assert.deepEqual(await picker.locator('option').evaluateAll(options => options.map(option => option.value)), tables);
    for (const id of tables)
    {
        const chapter = page.locator(`#tour-${ id }`);
        await page.waitForFunction((game) => document.querySelector('.world-stage')?.dataset.shot === game, id);
        await picker.waitFor({ state: 'visible' });
        assert.equal(await picker.inputValue(), id);
        assert.equal(await chapter.getByRole('link').first().getAttribute('href'), `/app/games/${ id }`);
        assert.ok((await chapter.locator('.landing-game-blurb').innerText()).trim().length > 20);
        if (id === 'backgammon')
        {
            const fits = await chapter.locator('h3').evaluate((title) =>
                innerWidth < 1000 || document.documentElement.lang !== 'en' ||
                title.getBoundingClientRect().height <= parseFloat(getComputedStyle(title).lineHeight) + 1);
            assert.equal(fits, true, 'the desktop game title wrapped its final letter onto a second line');
        }
        const image = await chapter.locator('.landing-game-art img').evaluate(async (el) =>
        {
            await el.decode();
            const sample = document.createElement('canvas').getContext('2d');
            sample.drawImage(el, 0, 0, 1, 1, 0, 0, 1, 1);
            return [el.naturalWidth, el.naturalHeight, sample.getImageData(0, 0, 1, 1).data[3]];
        });
        assert.deepEqual(image, [720, 480, 0]);
        assert.equal(await chapter.locator('.landing-game-art').isVisible(), true);
        await chapter.locator('.chapter-next').focus();
        await page.keyboard.press('Enter');
    }
    await page.waitForURL((url) => url.hash === '#together');
    await picker.waitFor({ state: 'hidden' });
    await page.goto(`${ base }/#tour-ludo`);
    await picker.waitFor();
    await picker.selectOption('chess');
    await page.waitForURL((url) => url.hash === '#tour-chess');
    await page.waitForFunction(() => document.activeElement?.id === 'tour-chess');
    await page.reload();
    await page.waitForFunction(() => document.querySelector('.world-stage')?.dataset.shot === 'chess');
    assert.equal(await picker.inputValue(), 'chess');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
}

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
            const { landing } = await import(`../../frontend/src/locales/${ locale }/landing.ts`);
            assert.equal(await page.locator('meta[name=description]').getAttribute('content'), landing['landing.arrival.body']);
            assert.equal(await page.locator('meta[property="og:title"]').getAttribute('content'), await page.title());
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
            const stage = page.locator('.world-stage');
            const night = await stage.evaluate((el) => getComputedStyle(el).backgroundColor);
            const menu = page.getByRole('button', { name: words['nav.menu'], exact: true });
            const drawer = page.getByRole('dialog', { name: words['nav.menu'], exact: true });
            assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
            assert.equal((await page.locator('meta[name="theme-color"]').getAttribute('content'))?.toLowerCase(), '#0b1220');
            await menu.click();
            const theme = drawer.getByRole('group', { name: words['theme.label'], exact: true });
            await theme.getByRole('button', { name: words['theme.light'], exact: true }).click();
            assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
            assert.equal(await theme.getByRole('button', { name: words['theme.light'], exact: true }).getAttribute('aria-pressed'), 'true');
            await page.keyboard.press('Escape');
            await drawer.waitFor({ state: 'hidden' });

            await page.reload();
            assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
            assert.equal((await page.locator('meta[name="theme-color"]').getAttribute('content'))?.toLowerCase(), '#edf2f7');
            assert.equal(await page.locator('html').getAttribute('dir'), scenario.locale === 'fa' ? 'rtl' : 'ltr');

            assert.notEqual(await stage.evaluate((el) => getComputedStyle(el).backgroundColor), night);
            await checkTour(page);
            await page.goto(base);
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

            console.log(`${ scenario.locale } ${ scenario.width }×${ scenario.height } five scroll chapters, direct links, theme and wallet keyboard regression passed`);
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
