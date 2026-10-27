import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { FRAMES } from '../../frontend/src/game/looks/frames.ts';

const sheet = readFileSync(new URL('../../frontend/src/styles/app.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const ruleOf = (selector: string, from = 0) =>
{
    const at = sheet.indexOf(`\n${ selector }\n{`, from);

    return at === -1 ? '' : sheet.slice(at, sheet.indexOf('\n}', at));
};

const still = sheet.indexOf('\n    [data-deco=');

describe('a frame round a picture, in the stylesheet', () =>
{
    it('is drawn a quarter wider than the picture, over it, and passes a pointer through', () =>
    {
        const frame = ruleOf('[data-deco]::after');

        expect(frame).toContain('\n    inset: -12.5%;');
        expect(frame).toContain('\n    pointer-events: none;');
        expect(frame).toContain('\n    background: var(--deco) center / contain no-repeat;');
    });

    it.each([...FRAMES])('draws %s from its own file, and its still twin for somebody who asked for less motion', (collection) =>
    {
        expect(ruleOf(`[data-deco='${ collection }']`)).toContain(`--deco: url('/frames/${ collection }.svg');`);
        expect(sheet.slice(still)).toContain(`    [data-deco='${ collection }']\n    {\n        --deco: url('/frames/${ collection }-still.svg');`);
        expect(sheet.lastIndexOf('@media (prefers-reduced-motion: reduce)', still)).toBeGreaterThan(sheet.indexOf(`\n[data-deco='${ collection }']`));

        for (const name of [collection, `${ collection }-still`])
        {
            expect(existsSync(new URL(`../../frontend/public/frames/${ name }.svg`, import.meta.url)), name).toBe(true);
        }
    });

    it('keeps the presence dot above the frame', () =>
    {
        const avatar = readFileSync(new URL('../../frontend/src/components/ui/avatar.component.azeroth', import.meta.url), 'utf8');

        expect(avatar).toContain("'absolute -bottom-0.5 -end-0.5 z-[2] rounded-full'");
        expect(ruleOf('[data-deco]::after')).toContain('\n    z-index: 1;');
    });
});
