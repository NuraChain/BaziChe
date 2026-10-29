import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';

import GiveLookSheet, { type GiveAsk } from '../src/components/admin/give-look-sheet.component.azeroth';
import '../src/locales/app-catalogue.ts';
import '../src/locales/admin-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';

const settle = async () =>
{
    for (let step = 0; step < 16; step += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
};

const shown = (close = vi.fn(), owned: string[] = [], initial?: GiveAsk) =>
    renderTest(() => GiveLookSheet({ overlayId: 'give', close, name: 'Sara Kamali', owned, ...(initial === undefined ? {} : { initial }) }) as HTMLElement).container;

const button = (root: ParentNode, label: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find((one) => one.textContent?.trim() === label)!;

const said = (root: ParentNode, selector: string) => root.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

const typeInto = (root: ParentNode, value: string) =>
{
    const field = root.querySelector<HTMLTextAreaElement>('#admin-give-why')!;

    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
};

const pick = async (root: ParentNode, which: 0 | 1, label: string) =>
{
    root.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="listbox"]')[which]!.click();
    await settle();
    [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((one) => one.textContent?.trim() === label)!.click();
    await settle();
};

const chosen = (root: ParentNode) => said(root, '[data-chosen] [data-name]');

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

describe('the sheet that gives somebody a look', () =>
{
    it('asks which look and why, and closes with the look and the reason as written, trimmed', async () =>
    {
        const close = vi.fn();
        const container = shown(close);

        expect(said(container, 'h2')).toBe('Give Sara Kamali a look');
        expect(container.textContent).toContain('It is in their collection at once, and they are not told.');
        expect(chosen(container)).toBe('Nura Glow avatar decoration');
        expect(container.querySelector('[data-chosen] img')?.getAttribute('src')).toBe('/looks/decoration.glow.svg');

        await pick(container, 0, 'Stormforged Monarch');
        await pick(container, 1, 'Dice');

        expect(chosen(container)).toBe('Stormforged Monarch dice');

        typeInto(container, '  A prize for the Friday cup.  ');
        fire(button(container, 'Give it'), 'click');

        expect(close.mock.calls).toEqual([[{ item: 'dice.storm', reason: 'A prize for the Friday cup.' }]]);
    });

    it('keeps the kind chosen when another collection is chosen', async () =>
    {
        const container = shown();

        await pick(container, 1, 'Dice');
        await pick(container, 0, 'Jade Dragon Dynasty');

        expect(chosen(container)).toBe('Jade Dragon Dynasty dice');
        expect([...container.querySelectorAll('button[aria-haspopup="listbox"]')].map((one) => one.textContent?.trim())).toEqual(['Jade Dragon Dynasty', 'Dice']);
    });

    it('names each look of the collection by its kind alone, since the collection is chosen beside it', async () =>
    {
        const container = shown();

        container.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="listbox"]')[1]!.click();
        await settle();

        const offered = [...document.querySelectorAll('[role="option"]')].map((one) => one.textContent?.trim());

        expect(offered).toHaveLength(15);
        expect(offered.slice(0, 5)).toEqual(['Avatar decoration', 'Profile effect', 'Profile theme', 'Nameplate', 'Dice']);
    });

    it('says when they own the look already, and gives nothing for it', async () =>
    {
        const close = vi.fn();
        const container = shown(close, ['dice.storm']);

        expect(container.querySelector('[data-owned]')).toBeNull();

        await pick(container, 0, 'Stormforged Monarch');
        await pick(container, 1, 'Dice');

        expect(said(container, '[data-owned]')).toBe('They own it already.');
        expect(button(container, 'Give it').disabled).toBe(true);

        typeInto(container, 'A prize for the Friday cup.');
        fire(button(container, 'Give it'), 'click');

        expect(close).not.toHaveBeenCalled();
    });

    it('asks for a reason of three characters or more before it gives anything', () =>
    {
        const close = vi.fn();
        const container = shown(close);

        typeInto(container, ' ab ');
        fire(button(container, 'Give it'), 'click');

        expect(said(container, '#admin-give-why-error')).toBe('Say why, in three characters or more.');
        expect(close).not.toHaveBeenCalled();

        typeInto(container, 'abc');

        expect(container.querySelector('#admin-give-why-error')).toBeNull();
    });

    it('opens on what was asked before, and closes with nothing when put away', () =>
    {
        const close = vi.fn();
        const container = shown(close, [], { item: 'pawns.jade', reason: 'For the cup.' });

        expect(chosen(container)).toBe('Jade Dragon Dynasty pawns');
        expect(container.querySelector<HTMLTextAreaElement>('#admin-give-why')?.value).toBe('For the cup.');

        fire(button(container, 'Cancel'), 'click');

        expect(close.mock.calls).toEqual([[null]]);
    });

    it('says it in Persian', () =>
    {
        useLocale().setLocale('fa');
        const container = shown(vi.fn(), [], { item: 'dice.inferno', reason: 'جایزه‌ی مسابقه' });

        expect(said(container, 'h2')).toBe('یه استایل به Sara Kamali بده');
        expect(chosen(container)).toBe('تاس سلطان دوزخ');
        expect([...container.querySelectorAll('button[aria-haspopup="listbox"]')].map((one) => one.textContent?.trim())).toEqual(['سلطان دوزخ', 'تاس']);
        expect(button(container, 'بده بهش')).toBeDefined();
    });
});
