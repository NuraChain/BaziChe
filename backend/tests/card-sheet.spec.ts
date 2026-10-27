import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { SHOP_COLLECTIONS } from '../src/domains/shop/catalogue.ts';
import { PALETTES } from '../../frontend/src/game/looks/palette.ts';

const sheet = readFileSync(new URL('../../frontend/src/styles/app.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The body of the rule written with exactly this selector at the start of a line. */
const rule = (selector: string) => new RegExp(`\\n *${ escaped(selector) }\\n *\\{([^}]*)\\}`).exec(sheet)?.[1] ?? '';

/** Where the block that opens with this header starts and ends in the sheet. */
const block = (header: string) =>
{
    const start = sheet.indexOf(`\n${ header }\n{`);
    let depth = 0;

    for (let at = sheet.indexOf('{', start); at < sheet.length; at += 1)
    {
        depth += sheet[at] === '{' ? 1 : sheet[at] === '}' ? -1 : 0;

        if (depth === 0)
        {
            return start < 0 ? null : [start, at] as const;
        }
    }

    return null;
};

const HOLO = '@media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)';

describe('cards in a look, in the stylesheet', () =>
{
    it('draws a face and a back from the look their box carries, and the classic ones where it carries none', () =>
    {
        expect(rule('.card-face')).toContain('background-image: var(--deck, url(\'/board/deck.svg\'));');
        expect(rule('.card-back')).toContain('background: var(--back, url(\'/board/card-back.svg\')) center / 100% 100% no-repeat;');
    });

    it.each([...SHOP_COLLECTIONS])('draws %s’s deck and back, and its edge and glint on the holographic edge', (collection) =>
    {
        const faces = rule(`[data-faces='${ collection }']`);

        expect(faces).toContain(`--deck: url('/decks/${ collection }.svg');`);
        expect(faces).toContain(`--holo-a: ${ PALETTES[collection].edge };`);
        expect(faces).toContain(`--holo-b: ${ PALETTES[collection].glint };`);
        expect(rule(`[data-backs='${ collection }']`)).toContain(`--back: url('/backs/${ collection }.svg');`);
    });

    it('bursts on the felt under the cards, at both card tables, and takes no press meant for them', () =>
    {
        const bursts = rule('.hokm-burst,\n.poker-burst');

        expect(bursts).toContain('z-index: 0;');
        expect(bursts).toContain('pointer-events: none;');
        expect(rule('.hokm-trick,\n.hokm-deck'), 'a card on the felt lies under its burst').toContain('z-index: 1;');
        expect(rule('.poker-centre'), 'the board lies under its burst').toContain('z-index: 1;');
        expect(rule('.poker-seat'), 'a seat\'s cards lie under its burst').toContain('z-index: 3;');
    });

    it('names no look the shop does not sell', () =>
    {
        const named = [...sheet.matchAll(/\[data-(?:faces|backs)='([^']+)'\]/g)].map(([, collection]) => collection);

        expect(new Set(named)).toEqual(new Set(SHOP_COLLECTIONS));
    });

    it('moves the holographic edge only under a fine pointer that hovers, for somebody who asked for no less motion', () =>
    {
        const holo = block(HOLO);
        const follows = [...sheet.matchAll(/var\(--h[xy]\b/g)].map((one) => one.index);

        expect(holo, 'the holographic edge has no block of its own').not.toBeNull();
        expect(follows.length).toBeGreaterThan(0);
        expect(follows.filter((at) => at < holo![0] || at > holo![1]), 'the pointer is followed outside the block').toEqual([]);
        expect(sheet.slice(holo![0], holo![1])).toContain('.hokm-hands[data-faces] .card-hold:hover .card-face');
        expect(sheet.slice(holo![0], holo![1])).toContain('.poker-hole[data-faces] .poker-pocket:hover .card-face');
    });
});
