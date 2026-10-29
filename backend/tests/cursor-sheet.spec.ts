import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const BASE = readFileSync(new URL('../../frontend/src/styles/base.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const RULE = /:where\(([^)]*)\):where\(:not\(:disabled, \[aria-disabled='true'\]\)\)\s*\{\s*cursor: pointer;\s*\}/;

const layer = () =>
{
    const start = BASE.indexOf('{', BASE.indexOf('@layer base'));
    let depth = 0;

    for (let at = start; at < BASE.length; at += 1)
    {
        depth += BASE[at] === '{' ? 1 : BASE[at] === '}' ? -1 : 0;

        if (depth === 0)
        {
            return BASE.slice(start, at);
        }
    }

    return '';
};

describe('the hand over whatever a press acts on', () =>
{
    it('is drawn once in the base layer, at no specificity, so a component\'s own cursor wins', () =>
    {
        expect(RULE.exec(layer()), 'the rule inside @layer base').not.toBeNull();
        expect(BASE.match(new RegExp(RULE.source, 'g'))?.length).toBe(1);
    });

    it('covers a button and every role a press acts on, and nothing disabled', () =>
    {
        const covered = RULE.exec(layer())?.[1].split(',').map((one) => one.trim()) ?? [];

        expect(covered).toEqual(expect.arrayContaining(['button', '[role=\'button\']', '[role=\'tab\']', '[role=\'menuitem\']', '[role=\'option\']', '[role=\'switch\']', '[role=\'radio\']', '[role=\'checkbox\']', 'summary']));
    });
});
