import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';

import AdminEmpty from '../src/components/admin/admin-empty.component.azeroth';
import EmptyState from '../src/components/ui/empty-state.component.azeroth';
import { FIRST_CHIP, FIRST_TAB, SEARCH_FIELD, keyboardTo } from '../src/lib/way-back.ts';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';

beforeEach(() =>
{
    cleanup();
    useLocale().setLocale('en');
});

afterEach(() =>
{
    cleanup();
});

describe('the way back from a list a search or a filter emptied', () =>
{
    it('is a quiet button where an empty state says what to do next, and the loud one where it does not', () =>
    {
        let pressed = 0;
        const back = renderTest(() => EmptyState({ title: 'Nothing for “zz”.', action: 'Clear the search', wayBack: true, onAction: () => pressed += 1 }) as HTMLElement).container;
        const button = back.querySelector<HTMLButtonElement>('[data-way-back] button')!;

        expect(button.textContent?.trim()).toBe('Clear the search');
        expect(button.className).toContain('border-line-strong');
        expect(button.className, 'a way back was drawn as the page\'s call to action').not.toContain('bg-accent-fill');

        fire(button, 'click');

        expect(pressed).toBe(1);

        const next = renderTest(() => EmptyState({ title: 'No chats yet.', action: 'Find a friend', onAction: () => undefined }) as HTMLElement).container;

        expect(next.querySelector('[data-way-back]'), 'what to do next was marked as a way back').toBeNull();
        expect(next.querySelector('button')?.className).toContain('bg-accent-fill');
    });

    it('is a button under the sentence in the staff\'s empty list, drawn only when there is a way back', () =>
    {
        let pressed = 0;
        const back = renderTest(() => AdminEmpty({ icon: 'people', title: 'Nobody matches.', action: 'Show everybody', onAction: () => pressed += 1 }) as HTMLElement).container;
        const button = back.querySelector<HTMLButtonElement>('[data-empty] [data-way-back] button')!;

        expect(button.textContent?.trim()).toBe('Show everybody');

        fire(button, 'click');

        expect(pressed).toBe(1);

        const none = renderTest(() => AdminEmpty({ icon: 'people', title: 'Nobody has an account yet.' }) as HTMLElement).container;

        expect(none.querySelector('[data-way-back]')).toBeNull();
        expect(none.querySelector('button')).toBeNull();
    });

    it('hands the keyboard to the control that now says what is shown, and to nothing outside the part it is given', () =>
    {
        const outside = document.createElement('input');
        const part = document.createElement('div');

        outside.type = 'search';
        part.innerHTML = '<div role="tablist"><button role="tab" tabindex="-1">All</button><button role="tab">Groups</button></div>'
            + '<button aria-pressed="false">Everything</button><button aria-pressed="true">Turns</button>'
            + '<input type="search">';
        document.body.append(outside, part);

        try
        {
            keyboardTo(part, SEARCH_FIELD);

            expect(document.activeElement).toBe(part.querySelector('input'));

            keyboardTo(part, FIRST_CHIP);

            expect(document.activeElement?.textContent, 'the keyboard went to the chip still chosen, not the first').toBe('Everything');

            keyboardTo(part, FIRST_TAB);

            expect(document.activeElement?.textContent).toBe('All');

            keyboardTo(null, SEARCH_FIELD);

            expect(document.activeElement?.textContent).toBe('All');
        }
        finally
        {
            outside.remove();
            part.remove();
        }
    });
});
