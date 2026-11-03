import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../frontend/', import.meta.url);

const read = (path: string) => readFileSync(new URL(path, root), 'utf8').replace(/\r\n/g, '\n');

describe('the marks the landing’s footer draws', () =>
{
    const sheet = read('public/brand-marks.svg');
    const footer = read('src/components/layout/site-footer.component.azeroth');
    const named = [...footer.matchAll(/mark: '([a-z]+)'/g)].map(([, id]) => id);
    const drawn = [...sheet.matchAll(/<symbol id="([a-z]+)" viewBox="0 0 24 24">\s*<path d="[^"]+"\/>\s*<\/symbol>/g)].map(([, id]) => id);

    it('are every mark the footer names, and nothing else', () =>
    {
        expect(named, 'the footer names its marks').toEqual(['github', 'telegram', 'discord', 'x']);
        expect([...drawn].sort()).toEqual([...named].sort());
    });

    it('take the colour of whatever draws them', () =>
    {
        expect(sheet, 'no mark paints a colour of its own').not.toMatch(/fill=|stroke=|style=/);
        expect(footer).toContain('fill="currentColor" aria-hidden="true"><use href={ `/brand-marks.svg#${ one.mark }` } /></svg>');
    });
});
