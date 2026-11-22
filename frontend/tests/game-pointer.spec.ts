import { describe, expect, it } from 'vitest';

import { crossedSlop, insideRect, primaryPress } from '../src/game/pointer.ts';

const contact = (props: PointerEventInit) => new PointerEvent('pointerdown', { isPrimary: true, pointerType: 'touch', ...props });

describe('board pointer contacts', () =>
{
    it('accepts only the primary contact and main button', () =>
    {
        expect(primaryPress(contact({}))).toBe(true);
        expect(primaryPress(contact({ isPrimary: false }))).toBe(false);
        expect(primaryPress(contact({ button: 2 }))).toBe(false);
    });

    it('tolerates fingertip jitter while keeping mouse pickup precise', () =>
    {
        const origin = { x: 12, y: 15 };
        expect(crossedSlop(contact({ clientX: 17, clientY: 21 }), origin)).toBe(false);
        expect(crossedSlop(contact({ clientX: 18, clientY: 23 }), origin)).toBe(true);
        expect(crossedSlop(contact({ pointerType: 'mouse', clientX: 12, clientY: 19 }), origin)).toBe(true);
    });

    it('rejects releases beyond the surface and on its far edge', () =>
    {
        const rect = new DOMRect(50, 20, 100, 80);
        expect(insideRect(contact({ clientX: 50, clientY: 20 }), rect)).toBe(true);
        expect(insideRect(contact({ clientX: 150, clientY: 21 }), rect)).toBe(false);
        expect(insideRect(contact({ clientX: 51, clientY: 101 }), rect)).toBe(false);
    });
});
