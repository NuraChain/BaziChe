import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { createSignal } from 'azerothjs';

import Field from '../src/components/ui/field.component.azeroth';
import Input from '../src/components/ui/input.component.azeroth';
import TextArea from '../src/components/ui/text-area.component.azeroth';
import { describedBy, focusFirstInvalid, refusedFields } from '../src/lib/form.ts';
import '../src/locales/app-catalogue.ts';
import { ApiError } from './fake-api.ts';

type Rendered = Parameters<typeof renderTest>[0] extends () => infer R ? R : never;

const validation = (fields: Record<string, string>, issues?: Array<{ path: string; code: string }>) =>
    new ApiError(422, 'validation-failed', 'Validation failed', issues === undefined
        ? { fields }
        : { fields, issues: issues.map((issue) => ({ ...issue, message: 'Not accepted' })) });

afterEach(() =>
{
    cleanup();
    document.body.replaceChildren();
});

describe('Field', () =>
{
    it('says the hint and the error it is given now, not the ones it was first drawn with', () =>
    {
        const [hint, setHint] = createSignal('200 characters left');
        const [error, setError] = createSignal<string | null>(null);

        const { container } = renderTest(() => Field({
            id: 'bio',
            label: 'Bio',
            get hint()
            {
                return hint();
            },
            get error()
            {
                return error();
            }
        }) as Rendered);

        expect(container.querySelector('#bio-hint')?.textContent).toBe('200 characters left');

        setHint('199 characters left');

        expect(container.querySelector('#bio-hint')?.textContent, 'the hint kept its first words').toBe('199 characters left');

        setError('Write at least 3 characters.');

        expect(container.querySelector('#bio-error')?.textContent).toBe('Write at least 3 characters.');

        setError('That handle is taken.');

        expect(container.querySelector('#bio-error')?.textContent, 'the error kept its first words').toBe('That handle is taken.');

        setError(null);

        expect(container.querySelector('#bio-error'), 'a cleared error stayed').toBeNull();
        expect(container.querySelector('#bio-hint')?.textContent).toBe('199 characters left');
    });
});

describe('TextArea', () =>
{
    it('is marked wrong while it is told it is, to the eye and to a screen reader', () =>
    {
        const [invalid, setInvalid] = createSignal(false);

        const { container } = renderTest(() => TextArea({
            id: 'why',
            value: '',
            onInput: () => undefined,
            get invalid()
            {
                return invalid();
            }
        }) as Rendered);

        const box = container.querySelector('#why')!;
        const shell = box.parentElement!;

        expect(box.getAttribute('aria-invalid')).toBe('false');
        expect(shell.className).toContain('border-line');
        expect(shell.className).not.toContain('border-danger');

        setInvalid(true);

        expect(box.getAttribute('aria-invalid')).toBe('true');
        expect(shell.className).toContain('border-danger');
        expect(shell.className).not.toContain('border-line');
        expect(shell.className, 'the keyboard on it turns it blue').not.toContain('focus-within:border-accent');
        expect(shell.className).toContain('focus-within:ring-danger/20');
        expect(container.querySelector('#why'), 'the box was drawn again').toBe(box);
    });
});

describe('Input', () =>
{
    it('stays marked wrong while the keyboard is on it, and shows the keyboard with a ring', () =>
    {
        const [invalid, setInvalid] = createSignal(false);

        const { container } = renderTest(() => Input({
            id: 'name',
            value: '',
            onInput: () => undefined,
            get invalid()
            {
                return invalid();
            }
        }) as Rendered);

        const shell = container.querySelector('#name')!.parentElement!;

        expect(shell.className).toContain('focus-within:border-accent');

        setInvalid(true);

        expect(container.querySelector('#name')?.getAttribute('aria-invalid')).toBe('true');
        expect(shell.className).toContain('border-danger');
        expect(shell.className, 'the keyboard on it turns it blue').not.toContain('focus-within:border-accent');
        expect(shell.className).toContain('focus-within:ring-danger/20');
    });
});

describe('a form the server refused', () =>
{
    it('says each field it named in the reader\'s words, by the rule it broke, the first rule of a field winning', () =>
    {
        const refused = refusedFields(validation(
            { displayName: 'Too short', bio: 'Too long', when: 'Bad', kind: 'Bad', size: 'Bad', why: 'Bad' },
            [
                { path: 'displayName', code: 'min' },
                { path: 'displayName', code: 'required' },
                { path: 'bio', code: 'max' },
                { path: 'when', code: 'format' },
                { path: 'kind', code: 'enum' },
                { path: 'size', code: 'type' },
                { path: 'why', code: 'nonempty' }
            ]
        ));

        expect(Object.fromEntries(refused)).toEqual({
            displayName: 'form.refused.low',
            bio: 'form.refused.high',
            when: 'form.refused.shape',
            kind: 'form.refused.choice',
            size: 'form.refused.shape',
            why: 'form.refused.required'
        });
    });

    it('lands a nested path on its field, and a rule it has no words for, or a field named with no rule, as not accepted', () =>
    {
        const refused = refusedFields(validation(
            { 'items.0.email': 'Bad', note: 'Bad', other: 'Bad' },
            [{ path: 'items.0.email', code: 'pattern' }, { path: 'note', code: 'refine' }]
        ));

        expect(Object.fromEntries(refused)).toEqual({
            items: 'form.refused.shape',
            note: 'form.refused.other',
            other: 'form.refused.other'
        });
        expect(Object.fromEntries(refusedFields(validation({ name: 'Bad' })))).toEqual({ name: 'form.refused.other' });
    });

    it('names no field for a refusal of the whole form, or for anything that is not an answer', () =>
    {
        expect(refusedFields(new ApiError(409, 'conflict', 'Taken', undefined)).size).toBe(0);
        expect(refusedFields(new ApiError(503, 'unavailable', 'Down', undefined)).size).toBe(0);
        expect(refusedFields(new TypeError('Failed to fetch')).size).toBe(0);
        expect(refusedFields(null).size).toBe(0);
    });
});

describe('the field a form says is wrong', () =>
{
    it('takes the keyboard to the first of them once the press that found them has been drawn', async () =>
    {
        const form = document.createElement('form');
        form.innerHTML = '<input id="a" aria-invalid="false"><input id="b" aria-invalid="true"><textarea id="c" aria-invalid="true"></textarea>';
        document.body.append(form);
        const before = document.createElement('button');
        document.body.append(before);
        before.focus();

        focusFirstInvalid(form);

        expect(document.activeElement, 'moved before the page was drawn').toBe(before);

        await Promise.resolve();

        expect(document.activeElement).toBe(form.querySelector('#b'));
    });

    it('leaves the keyboard where it is when nothing is wrong, or there is no form', async () =>
    {
        const form = document.createElement('form');
        form.innerHTML = '<input id="a" aria-invalid="false">';
        document.body.append(form);
        const before = document.createElement('button');
        document.body.append(before);
        before.focus();

        focusFirstInvalid(form);
        focusFirstInvalid(null);
        await Promise.resolve();

        expect(document.activeElement).toBe(before);
    });

    it('is described by its error while it has one, and by its hint otherwise', () =>
    {
        expect(describedBy('name', 'Write the name people will see.')).toBe('name-error');
        expect(describedBy('name', null)).toBe('name-hint');
        expect(describedBy('name', undefined)).toBe('name-hint');
        expect(describedBy('name', '')).toBe('name-hint');
        expect(describedBy('name', null, false)).toBeUndefined();
        expect(describedBy('name', 'Wrong', false)).toBe('name-error');
    });
});
