import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';

import CampaignSheet from '../src/components/admin/campaign-sheet.component.azeroth';
import '../src/locales/app-catalogue.ts';
import '../src/locales/admin-catalogue.ts';
import { localOf } from '../src/lib/campaign-form.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import type { AdminCampaignInput, AdminInviteCampaign } from '../../backend/src/schemas.ts';
import { MILESTONES_MOST } from '../../backend/src/domains/admin/roles.ts';

const settle = async () =>
{
    for (let step = 0; step < 16; step += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
};

const campaign = (change: Partial<AdminInviteCampaign> = {}): AdminInviteCampaign => ({
    id: 'c1',
    name: 'Spring friends',
    state: 'draft',
    inviterItem: 'dice.storm',
    milestones: [{ count: 5, item: 'decoration.void' }],
    most: 3,
    review: true,
    startsAt: '2026-11-01T08:00:00.000Z',
    at: '2026-10-29T08:00:00.000Z',
    by: 'alex',
    running: false,
    gave: false,
    joined: 0,
    played: 0,
    given: 0,
    waiting: 0,
    refused: 0,
    taken: 0,
    ...change
});

const shown = (close = vi.fn(), held: AdminInviteCampaign | null = null, initial?: AdminCampaignInput) =>
    renderTest(() => CampaignSheet({ overlayId: 'campaign', close, campaign: held, ...(initial === undefined ? {} : { initial }) }) as HTMLElement).container;

const button = (root: ParentNode, label: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find((one) => one.textContent?.trim() === label);

const said = (root: ParentNode, selector: string) => root.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

const typeInto = (root: ParentNode, selector: string, value: string) =>
{
    const field = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;

    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
};

const pickers = (root: ParentNode) => [...root.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="listbox"]')];

const pick = async (picker: HTMLButtonElement, label: string) =>
{
    picker.click();
    await settle();
    [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((one) => one.textContent?.trim() === label)!.click();
    await settle();
};

const looked = (root: ParentNode, where: string) => pickers(root.querySelector(where)!).map((one) => one.textContent?.trim());

beforeEach(() =>
{
    cleanup();
    useLocale().setLocale('en');
});

afterEach(() =>
{
    cleanup();
    useLocale().setLocale('en');
});

describe('the sheet that writes a campaign', () =>
{
    it('writes a new one as a draft: its name, what it gives, its milestones, its most, every reward waiting, and why', async () =>
    {
        const close = vi.fn();
        const container = shown(close);

        expect(said(container, 'h2')).toBe('A new campaign');
        expect(container.textContent).toContain('It is written as a draft and gives nothing until it is started.');
        expect(looked(container, '[data-for="inviter"]')).toEqual(['Nothing']);
        expect(looked(container, '[data-for="invitee"]')).toEqual(['Nothing']);
        expect(container.querySelectorAll('[data-step]')).toHaveLength(0);

        typeInto(container, '#admin-campaign-name', 'Spring friends');
        await pick(pickers(container.querySelector('[data-for="inviter"]')!)[0], 'Stormforged Monarch');
        await pick(pickers(container.querySelector('[data-for="inviter"]')!)[1], 'Dice');

        expect(looked(container, '[data-for="inviter"]')).toEqual(['Stormforged Monarch', 'Dice']);

        fire(button(container, 'Add a milestone')!, 'click');
        await settle();
        typeInto(container, '[data-step] input', '10');
        typeInto(container, '#admin-campaign-most', '2');
        fire(container.querySelector<HTMLButtonElement>('[role="switch"]')!, 'click');
        typeInto(container, '#admin-campaign-why', '  For the spring tournament.  ');
        await settle();
        fire(button(container, 'Save')!, 'click');

        expect(close.mock.calls).toEqual([[{
            input: {
                name: 'Spring friends',
                inviterItem: 'dice.storm',
                milestones: [{ count: 10, item: 'nameplate.glow' }],
                most: 2,
                review: true,
                reason: 'For the spring tournament.'
            }
        }]]);
    });

    it('says what is wrong where it is written and keeps the sheet open, the reason under its own field', async () =>
    {
        const close = vi.fn();
        const container = shown(close);

        fire(button(container, 'Save')!, 'click');
        await settle();

        expect(said(container, '[data-wrong]')).toBe('A name is three to eighty letters.');
        expect(container.querySelector('[data-wrong]')?.getAttribute('role')).toBe('alert');
        expect(said(container, '#admin-campaign-why-error')).toBe('Say why, in three characters or more.');

        typeInto(container, '#admin-campaign-name', 'Spring friends');
        await settle();

        expect(container.querySelector('[data-wrong]')).toBeNull();

        fire(button(container, 'Save')!, 'click');
        await settle();

        expect(said(container, '[data-wrong]')).toBe('Choose at least one look to give.');

        fire(button(container, 'Add a milestone')!, 'click');
        fire(button(container, 'Add a milestone')!, 'click');
        await settle();

        const counts = [...container.querySelectorAll<HTMLInputElement>('[data-step] input')];

        counts.forEach((field) =>
        {
            field.value = '5';
            field.dispatchEvent(new Event('input', { bubbles: true }));
        });
        typeInto(container, '#admin-campaign-why', 'For spring.');
        await settle();
        fire(button(container, 'Save')!, 'click');
        await settle();

        expect(said(container, '[data-wrong]')).toBe('Two milestones ask for the same number of friends.');

        typeInto(container, '#admin-campaign-starts', localOf('2026-11-08T08:00:00.000Z'));
        typeInto(container, '#admin-campaign-ends', localOf('2026-11-01T08:00:00.000Z'));
        fire(container.querySelectorAll<HTMLButtonElement>('[data-step] button[aria-label="Remove this milestone"]')[1]!, 'click');
        await settle();
        fire(button(container, 'Save')!, 'click');
        await settle();

        expect(said(container, '[data-wrong]')).toBe('It has to end after it starts.');
        expect(close).not.toHaveBeenCalled();

        fire(button(container, 'Cancel')!, 'click');

        expect(close.mock.calls).toEqual([[null]]);
    });

    it('keeps a campaign with nothing wrong but its reason, and says so under the reason until one is typed', async () =>
    {
        const close = vi.fn();
        const container = shown(close);

        typeInto(container, '#admin-campaign-name', 'Spring friends');
        fire(button(container, 'Add a milestone')!, 'click');
        await settle();
        typeInto(container, '[data-step] input', '5');
        typeInto(container, '#admin-campaign-why', ' ab ');
        await settle();
        fire(button(container, 'Save')!, 'click');
        await settle();

        expect(close).not.toHaveBeenCalled();
        expect(container.querySelector('[data-wrong]')).toBeNull();
        expect(said(container, '#admin-campaign-why-error')).toBe('Say why, in three characters or more.');

        typeInto(container, '#admin-campaign-why', 'For spring.');
        await settle();

        expect(container.querySelector('#admin-campaign-why-error'), 'typing again clears it').toBeNull();

        fire(button(container, 'Save')!, 'click');

        expect(close.mock.calls).toEqual([[{ input: { name: 'Spring friends', milestones: [{ count: 5, item: 'nameplate.glow' }], review: false, reason: 'For spring.' } }]]);
    });

    it('offers no more than five milestones', async () =>
    {
        const container = shown();

        for (let made = 0; made < MILESTONES_MOST; made += 1)
        {
            fire(button(container, 'Add a milestone')!, 'click');
            await settle();
        }

        expect(container.querySelectorAll('[data-step]')).toHaveLength(MILESTONES_MOST);
        expect(button(container, 'Add a milestone')).toBeUndefined();

        fire(container.querySelector<HTMLButtonElement>('[data-step] button[aria-label="Remove this milestone"]')!, 'click');
        await settle();

        expect(button(container, 'Add a milestone')).not.toBeUndefined();
    });

    it('opens a campaign as it stands, to be changed', async () =>
    {
        const close = vi.fn();
        const container = shown(close, campaign());

        expect(said(container, 'h2')).toBe('Change “Spring friends”');
        expect(container.textContent).not.toContain('It is written as a draft');
        expect(container.querySelector<HTMLInputElement>('#admin-campaign-name')?.value).toBe('Spring friends');
        expect(looked(container, '[data-for="inviter"]')).toEqual(['Stormforged Monarch', 'Dice']);
        expect(looked(container, '[data-for="invitee"]')).toEqual(['Nothing']);
        expect(container.querySelector<HTMLInputElement>('[data-step] input')?.value).toBe('5');
        expect(container.querySelector<HTMLInputElement>('#admin-campaign-most')?.value).toBe('3');
        expect(container.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
        expect(container.querySelector<HTMLInputElement>('#admin-campaign-starts')?.value).toBe(localOf('2026-11-01T08:00:00.000Z'));
        expect(container.querySelector<HTMLInputElement>('#admin-campaign-ends')?.value).toBe('');

        await pick(pickers(container.querySelector('[data-for="inviter"]')!)[0], 'Nothing');
        typeInto(container, '#admin-campaign-why', 'No dice this time.');
        await settle();
        fire(button(container, 'Save')!, 'click');

        expect(close.mock.calls).toEqual([[{
            input: { name: 'Spring friends', milestones: [{ count: 5, item: 'decoration.void' }], most: 3, review: true, startsAt: '2026-11-01T08:00:00.000Z', reason: 'No dice this time.' }
        }]]);
    });

    it('keeps what a campaign gives as it is once it has given something, and lets the rest change', async () =>
    {
        const close = vi.fn();
        const container = shown(close, campaign({ gave: true, state: 'active', running: true }));

        expect(said(container, '[data-fixed]')).toBe('It has given rewards, so what it gives stays as it is.');
        expect(pickers(container).every((one) => one.disabled || one.getAttribute('aria-disabled') === 'true')).toBe(true);
        expect(container.querySelector<HTMLInputElement>('[data-step] input')?.disabled).toBe(true);
        expect(container.querySelector('[data-step] button[aria-label="Remove this milestone"]')).toBeNull();
        expect(button(container, 'Add a milestone')).toBeUndefined();

        typeInto(container, '#admin-campaign-name', 'Spring friends, again');
        typeInto(container, '#admin-campaign-most', '');
        typeInto(container, '#admin-campaign-why', 'A clearer name.');
        await settle();
        fire(button(container, 'Save')!, 'click');

        expect(close.mock.calls).toEqual([[{
            input: { name: 'Spring friends, again', inviterItem: 'dice.storm', milestones: [{ count: 5, item: 'decoration.void' }], review: true, startsAt: '2026-11-01T08:00:00.000Z', reason: 'A clearer name.' }
        }]]);
    });

    it('opens again on what was written when the server refused it, the reason with it', async () =>
    {
        const container = shown(vi.fn(), null, { name: 'Autumn', inviteeItem: 'pawns.jade', milestones: [], review: false, endsAt: '2026-11-30T08:00:00.000Z', reason: 'Kept from before.' });

        expect(said(container, 'h2')).toBe('A new campaign');
        expect(container.querySelector<HTMLInputElement>('#admin-campaign-name')?.value).toBe('Autumn');
        expect(looked(container, '[data-for="invitee"]')).toEqual(['Jade Dragon Dynasty', 'Pawns']);
        expect(container.querySelector<HTMLInputElement>('#admin-campaign-ends')?.value).toBe(localOf('2026-11-30T08:00:00.000Z'));
        expect(container.querySelector<HTMLTextAreaElement>('#admin-campaign-why')?.value).toBe('Kept from before.');
    });

    it('says it in Persian', async () =>
    {
        useLocale().setLocale('fa');
        const container = shown(vi.fn(), campaign({ gave: true }));

        expect(said(container, 'h2')).toBe('تغییر «Spring friends»');
        expect(said(container, '[data-fixed]')).toBe('این کمپین جایزه داده، پس چیزی که می‌ده همون‌طور می‌مونه.');
        expect(button(container, 'ذخیره')).not.toBeUndefined();
    });
});
