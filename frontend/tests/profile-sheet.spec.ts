import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { RouterProvider, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import ProfileSheet from '../src/components/app/profile-sheet.component.azeroth';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { ApiError, client, establishAccount, server } from './fake-api.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

vi.mock('../src/lib/picture.ts', () => ({
    shrinkPicture: async () => ({ data: 'AAAA', preview: 'data:image/webp;base64,AAAA' })
}));

const settle = async () =>
{
    for (let i = 0; i < 8; i++)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
};

let closedWith: boolean | null = null;

const sheet = async (only?: 'picture') =>
{
    closedWith = null;
    const close = (value?: unknown) =>
    {
        closedWith = value === true;
    };
    const component = (() => ProfileSheet({ overlayId: 'profile-test', close, ...(only === undefined ? {} : { only }) })) as unknown as () => HTMLElement;
    const table: Route[] = [{ path: '/app/me', component }];
    const router = createRouter({ routes: table, history: createMemoryHistory('/app/me'), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: component }) as HTMLElement);
    await settle();
    return container;
};

const field = (container: HTMLElement, id: string) => container.querySelector(`#${ id }`) as HTMLInputElement | HTMLTextAreaElement;

const fill = (container: HTMLElement, id: string, value: string) =>
{
    const box = field(container, id);
    const proto = Object.getPrototypeOf(box) as object;
    (Object.getOwnPropertyDescriptor(proto, 'value')?.set as (this: unknown, v: string) => void).call(box, value);
    box.dispatchEvent(new Event('input', { bubbles: true }));
};

const leave = (container: HTMLElement, id: string) =>
{
    field(container, id).dispatchEvent(new FocusEvent('blur'));
};

const press = (container: HTMLElement, label: string) =>
{
    const button = [...container.querySelectorAll('button')].find((one) => one.textContent?.trim().startsWith(label));
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};

const errorOf = (container: HTMLElement, id: string) => container.querySelector(`#${ id }-error`)?.textContent ?? null;

const failureOf = (container: HTMLElement) => container.querySelector('[data-failed]')?.textContent ?? null;

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(5000), seed: 2 });
    useLocale().setLocale('en');
    server.reset();
    useSession().establish(establishAccount('alex', { displayName: 'Alex', bio: '' }));
});

afterEach(() =>
{
    cleanup();
    resetRuntime();
    vi.restoreAllMocks();
});

describe('the profile sheet, a field at a time', () =>
{
    it('lets Save be pressed with no name, says so under the name, takes the keyboard there and sends nothing', async () =>
    {
        const container = await sheet();
        const save = [...container.querySelectorAll('button')].find((one) => one.textContent?.trim().startsWith('Save'))!;

        fill(container, 'profile-name', '   ');
        await settle();

        expect(errorOf(container, 'profile-name'), 'said before the reader had a chance').toBeNull();
        expect(field(container, 'profile-name').getAttribute('aria-describedby')).toBe('profile-name-hint');
        expect(save.disabled).toBe(false);

        press(container, 'Save');
        await settle();

        expect(errorOf(container, 'profile-name')).toBe('Write the name people will see.');
        expect(field(container, 'profile-name').getAttribute('aria-invalid')).toBe('true');
        expect(field(container, 'profile-name').getAttribute('aria-describedby')).toBe('profile-name-error');
        expect(document.activeElement).toBe(field(container, 'profile-name'));
        expect(server.calls).not.toContain('auth.profile');
        expect(server.calls).not.toContain('auth.handle');
        expect(closedWith).toBeNull();

        fill(container, 'profile-name', 'Alexandra');
        await settle();

        expect(errorOf(container, 'profile-name'), 'a fixed name kept its error').toBeNull();
        expect(field(container, 'profile-name').getAttribute('aria-invalid')).toBe('false');
    });

    it('says a name left empty once the reader leaves it, and not for a name tabbed through unchanged', async () =>
    {
        const container = await sheet();

        leave(container, 'profile-name');
        await settle();

        expect(errorOf(container, 'profile-name')).toBeNull();

        fill(container, 'profile-name', '');
        await settle();

        expect(errorOf(container, 'profile-name'), 'said while typing').toBeNull();

        leave(container, 'profile-name');
        await settle();

        expect(errorOf(container, 'profile-name')).toBe('Write the name people will see.');
    });

    it('says what is wrong with a handle once the reader leaves it, and follows the typing from then on', async () =>
    {
        const container = await sheet();

        fill(container, 'profile-handle', 'a');
        await settle();

        expect(errorOf(container, 'profile-handle'), 'said while typing').toBeNull();

        leave(container, 'profile-handle');
        await settle();

        expect(errorOf(container, 'profile-handle')).toBe('A handle is 2 to 32 letters or digits, and may have . _ or - inside it.');
        expect(field(container, 'profile-handle').getAttribute('aria-invalid')).toBe('true');

        fill(container, 'profile-handle', 'sara k');
        await settle();

        expect(errorOf(container, 'profile-handle')).toBe('A handle is 2 to 32 letters or digits, and may have . _ or - inside it.');

        fill(container, 'profile-handle', 'Admin');
        await settle();

        expect(errorOf(container, 'profile-handle')).toBe('That handle is kept for Baziche. Try another.');

        fill(container, 'profile-handle', 'sara.k2');
        await settle();

        expect(errorOf(container, 'profile-handle')).toBeNull();
        expect(field(container, 'profile-handle').getAttribute('aria-invalid')).toBe('false');
    });

    it('never questions the handle the account already has', async () =>
    {
        useSession().establish(establishAccount('alex', { handle: 'me', displayName: 'Alex' }));
        const container = await sheet();

        press(container, 'Save');
        await settle();

        expect(errorOf(container, 'profile-handle')).toBeNull();
        expect(server.calls).toContain('auth.profile');
        expect(server.calls).not.toContain('auth.handle');
    });

    it('says a handle somebody holds under the handle, until it is changed, and again when it comes back', async () =>
    {
        server.takenHandles = ['taken'];
        const container = await sheet();

        fill(container, 'profile-handle', 'taken');
        press(container, 'Save');
        await settle();

        expect(errorOf(container, 'profile-handle')).toBe('That handle is taken. Try another.');
        expect(document.activeElement).toBe(field(container, 'profile-handle'));
        expect(failureOf(container)).toBeNull();
        expect(server.calls).not.toContain('auth.profile');

        fill(container, 'profile-handle', 'taken2');
        await settle();

        expect(errorOf(container, 'profile-handle')).toBeNull();

        fill(container, 'profile-handle', 'Taken');
        await settle();

        expect(errorOf(container, 'profile-handle')).toBe('That handle is taken. Try another.');
    });

    it('says a handle the server refused the shape of under the handle, though this browser let it through', async () =>
    {
        vi.spyOn(client.auth, 'claimHandle').mockRejectedValueOnce(new ApiError(400, 'bad-request', 'A name is 2-32 letters or digits.', undefined));
        const container = await sheet();

        fill(container, 'profile-handle', 'sara.k');
        press(container, 'Save');
        await settle();

        expect(errorOf(container, 'profile-handle')).toBe('A handle is 2 to 32 letters or digits, and may have . _ or - inside it.');
        expect(failureOf(container)).toBeNull();
    });

    it('says a save that failed on its way once, above the buttons, as what went wrong, and not under the handle', async () =>
    {
        vi.spyOn(client.auth, 'profile').mockRejectedValueOnce(new ApiError(503, 'unavailable', 'Service unavailable', undefined));
        const container = await sheet();

        fill(container, 'profile-name', 'Alexandra');
        press(container, 'Save');
        await settle();

        expect(failureOf(container)).toBe('The server is not answering right now. Try again in a moment.');
        expect(container.querySelector('[data-failed]')?.getAttribute('role')).toBe('alert');
        expect(errorOf(container, 'profile-handle')).toBeNull();
        expect(field(container, 'profile-name').value, 'what was typed went').toBe('Alexandra');
        expect(closedWith).toBeNull();

        press(container, 'Save');
        await settle();

        expect(failureOf(container)).toBeNull();
        expect(closedWith).toBe(true);
    });

    it('says a handle claim that never got an answer above the buttons, not as a handle somebody holds', async () =>
    {
        vi.spyOn(client.auth, 'claimHandle').mockRejectedValueOnce(new TypeError('Failed to fetch'));
        const container = await sheet();

        fill(container, 'profile-handle', 'sara.k');
        press(container, 'Save');
        await settle();

        expect(errorOf(container, 'profile-handle')).toBeNull();
        expect(failureOf(container)).toBe('The server could not be reached. Check your connection, then try again.');
    });

    it('says a name or a bio the server refused under that box, in the reader\'s words, until it is changed', async () =>
    {
        const refusal = (path: string, code: string) => new ApiError(422, 'validation-failed', 'Validation failed', {
            fields: { [path]: 'Too long' },
            issues: [{ path, code, message: 'Too long' }]
        });
        const saving = vi.spyOn(client.auth, 'profile').mockRejectedValueOnce(refusal('displayName', 'max'));
        const container = await sheet();

        fill(container, 'profile-name', 'Alexandra');
        press(container, 'Save');
        await settle();

        expect(errorOf(container, 'profile-name')).toBe('This is more than this field takes.');
        expect(document.activeElement).toBe(field(container, 'profile-name'));
        expect(failureOf(container)).toBeNull();

        fill(container, 'profile-name', 'Alex K');
        await settle();

        expect(errorOf(container, 'profile-name')).toBeNull();

        saving.mockRejectedValueOnce(refusal('bio', 'max'));
        fill(container, 'profile-bio', 'Plays hokm badly.');
        press(container, 'Save');
        await settle();

        expect(errorOf(container, 'profile-bio')).toBe('This is more than this field takes.');
        expect(field(container, 'profile-bio').getAttribute('aria-invalid')).toBe('true');
        expect(field(container, 'profile-bio').getAttribute('aria-describedby')).toBe('profile-bio-error');
        expect(document.activeElement).toBe(field(container, 'profile-bio'));
    });

    it('says a picture the server would not keep under the picture, and anything else above the buttons', async () =>
    {
        vi.spyOn(client.auth, 'avatar').mockRejectedValueOnce(new ApiError(400, 'bad-request', 'A picture is at most 64 KB.', undefined));
        const container = await sheet('picture');
        const chooser = container.querySelector('#profile-picture') as HTMLInputElement;

        Object.defineProperty(chooser, 'files', { value: [new File(['x'], 'me.png', { type: 'image/png' })], configurable: true });
        chooser.dispatchEvent(new Event('change', { bubbles: true }));
        await settle();
        press(container, 'Save');
        await settle();

        expect(errorOf(container, 'profile-picture')).toBe('That picture could not be read. Try a PNG, JPEG or WebP image.');
        expect(failureOf(container)).toBeNull();

        vi.spyOn(client.auth, 'profile').mockRejectedValueOnce(new ApiError(500, 'internal', 'Internal error', undefined));
        press(container, 'Save');
        await settle();

        expect(failureOf(container)).toBe('Something went wrong on the server. Try again in a moment.');
    });

    it('is never stopped, nor left silent, by a field the picture sheet does not draw', async () =>
    {
        useSession().establish(establishAccount('alex', { displayName: '' }));
        const saving = vi.spyOn(client.auth, 'profile').mockRejectedValueOnce(new ApiError(422, 'validation-failed', 'Validation failed', {
            fields: { displayName: 'Too short' },
            issues: [{ path: 'displayName', code: 'min', message: 'Too short' }]
        }));
        const container = await sheet('picture');

        press(container, 'Save');
        await settle();

        expect(saving, 'stopped by a name nobody can see').toHaveBeenCalledOnce();
        expect(failureOf(container)).toBe('That was not accepted. Check what you entered, then try again.');
    });

    it('says all of it in Persian', async () =>
    {
        useLocale().setLocale('fa');
        server.takenHandles = ['taken'];
        const container = await sheet();

        fill(container, 'profile-name', '');
        fill(container, 'profile-handle', 'taken');
        press(container, useLocale().t('profile.save'));
        await settle();

        expect(errorOf(container, 'profile-name')).toBe('اسمی که بقیه می‌بینن رو بنویس.');
        expect(server.calls, 'sent with a name missing').not.toContain('auth.handle');

        fill(container, 'profile-name', 'الکس');
        press(container, useLocale().t('profile.save'));
        await settle();

        expect(errorOf(container, 'profile-handle')).toBe('این نام کاربری رو قبلاً یکی برداشته. یکی دیگه امتحان کن.');

        fill(container, 'profile-handle', 'nura');
        await settle();

        expect(errorOf(container, 'profile-handle')).toBe('این نام کاربری مال خود بازیچه‌ست. یکی دیگه امتحان کن.');
    });
});
