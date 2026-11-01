import { ApiError } from '../api.ts';
import type { MessageKey } from '../locales/en.ts';

/**
 * The rule a refused field broke, by the schema's own code. The server's sentences are English, so
 * a field is told what is wrong in the reader's words, and only the code is read.
 */
const RULES: Readonly<Partial<Record<string, MessageKey>>> = {
    required: 'form.refused.required',
    nonempty: 'form.refused.required',
    min: 'form.refused.low',
    max: 'form.refused.high',
    pattern: 'form.refused.shape',
    format: 'form.refused.shape',
    type: 'form.refused.shape',
    union: 'form.refused.shape',
    enum: 'form.refused.choice',
    literal: 'form.refused.choice'
};

/** A wire path's field: `items.0.email` is `items`, as the framework's own `applyFieldErrors` lands it. */
const fieldOf = (path: string) => path.split('.', 1)[0] ?? '';

/**
 * What the server said is wrong with each field of a form it refused, by the field's name, the
 * first issue of a field winning. A refusal that names no field answers nothing here: it is a
 * refusal of the whole form, and `whyFailed` words it.
 */
export function refusedFields(error: unknown)
{
    const refused = new Map<string, MessageKey>();

    if (!(error instanceof ApiError))
    {
        return refused;
    }

    for (const issue of error.issues)
    {
        const field = fieldOf(issue.path);

        if (field !== '' && !refused.has(field))
        {
            refused.set(field, RULES[issue.code] ?? 'form.refused.other');
        }
    }

    for (const path of Object.keys(error.fields))
    {
        const field = fieldOf(path);

        if (field !== '' && !refused.has(field))
        {
            refused.set(field, 'form.refused.other');
        }
    }

    return refused;
}

/**
 * Takes the keyboard to the first field the form now marks wrong, once the press that found it
 * has been drawn, so whoever pressed Save is taken to what stopped it and hears why there.
 */
export function focusFirstInvalid(root: ParentNode | null)
{
    queueMicrotask(() => root?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
}

/** What a field is described by: the error `Field` draws while there is one, its hint otherwise. */
export function describedBy(id: string, error: string | null | undefined, hinted = true)
{
    if (error !== null && error !== undefined && error !== '')
    {
        return `${ id }-error`;
    }

    return hinted ? `${ id }-hint` : undefined;
}
