import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';

import NotifyAskStrip from '../src/components/app/notify-ask-strip.component.azeroth';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import { server } from './fake-api.ts';
import { fakeNotices, type FakeNotices } from './fake-notices.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const KEY = 'BPnJ0YVvZs7GkY7iYy5yTGmVvJ0O2m0cP0kWn0dD3mJ4qv7o3bWvX2Jm1mQe4yZ6m0qfS6rL1tV9Yx2pKc8Dd4s';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

let browser: FakeNotices | null = null;

const settle = async () =>
{
    for (let turn = 0; turn < 12; turn += 1)
    {
        await Promise.resolve();
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
};

const shown = async () =>
{
    const { container } = renderTest(() => NotifyAskStrip() as HTMLElement);

    await settle();

    return container;
};

const button = (container: HTMLElement, name: string) => [...container.querySelectorAll('button')].find((one) => one.textContent?.trim() === name);

beforeEach(() =>
{
    cleanup();
    server.reset();
    server.pushKey = KEY;
    useLocale().setLocale('en');
    useSettings().reset();
});

afterEach(() =>
{
    cleanup();
    browser?.restore();
    browser = null;
    vi.restoreAllMocks();
    useSettings().reset();
});

describe('asking once to be told things with Baziche closed', () =>
{
    it('asks, and turned on subscribes this device to the server\'s push and never asks again', async () =>
    {
        browser = fakeNotices('default', { answer: 'granted', registered: false, push: true });
        const container = await shown();

        expect(container.textContent).toContain('even with Baziche closed');

        button(container, 'Turn on')!.click();
        await settle();

        expect(useSettings().settings()).toMatchObject({ notify: true, notifyAsked: true });
        expect(browser.subscribed()).toBe(true);
        expect(server.calls).toContain('notifications.subscribe');
        expect(container.querySelector('[data-notify-ask]')).toBeNull();
    });

    it('takes "not now" as an answer, and asks nothing of the browser', async () =>
    {
        browser = fakeNotices('default', { answer: 'granted', registered: false, push: true });
        const container = await shown();

        button(container, 'Not now')!.click();
        await settle();

        expect(useSettings().settings()).toMatchObject({ notify: false, notifyAsked: true });
        expect(browser.subscribed()).toBe(false);
        expect(container.querySelector('[data-notify-ask]')).toBeNull();
    });

    it('turns itself on, unasked, in a browser that already lets this site notify', async () =>
    {
        browser = fakeNotices('granted', { registered: false, push: true });
        const container = await shown();

        expect(useSettings().settings()).toMatchObject({ notify: true, notifyAsked: true });
        expect(browser.subscribed()).toBe(true);
        expect(container.querySelector('[data-notify-ask]')).toBeNull();
    });

    it('says nothing where the browser blocks notifications, or where they are already on', async () =>
    {
        browser = fakeNotices('denied');

        expect((await shown()).querySelector('[data-notify-ask]')).toBeNull();

        cleanup();
        browser.restore();
        browser = fakeNotices('default');
        useSettings().update({ notify: true });

        expect((await shown()).querySelector('[data-notify-ask]')).toBeNull();
    });

    it('tells an iPhone in a Safari tab to add Baziche to the Home Screen, where it can be told things', async () =>
    {
        vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE);
        const container = await shown();

        expect(container.querySelector('[data-notify-home]')?.textContent).toContain('Add to Home Screen');
        expect(container.querySelector('[data-notify-ask]')).toBeNull();

        button(container, 'Got it')!.click();
        await settle();

        expect(container.querySelector('[data-notify-home]')).toBeNull();
        expect(useSettings().settings().notifyAsked).toBe(true);
    });

    it('says nothing of the Home Screen to a phone that is not an iPhone', async () =>
    {
        expect((await shown()).querySelector('[data-notify-home]')).toBeNull();
    });
});
