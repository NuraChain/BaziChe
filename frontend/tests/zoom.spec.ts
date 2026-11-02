import { describe, expect, it } from 'vitest';

import { AT_REST, ZOOM_DOUBLE, ZOOM_MOST, doubled, fitted, held, panBy, zoomAt, type Frame, type Point, type Size } from '../src/lib/zoom.ts';

/**
 * How a photo is zoomed and moved in the viewer (MS-D24): drawn whole as large as fits, in by the
 * wheel, a pinch or a double press about the place pressed, up to four times, moved by a drag, and
 * never moved so far that the stage shows past its edges.
 */

const STAGE: Size = { w: 800, h: 600 };

/** A landscape photo drawn whole across the stage: 800 by 400. */
const SHOWN = fitted({ w: 1600, h: 800 }, STAGE);

/** Where a point of the photo, measured from its own middle, stands on the stage. */
const placed = (frame: Frame, of: Point) => ({ x: frame.x + of.x * frame.scale, y: frame.y + of.y * frame.scale });

describe('a photo in the viewer', () =>
{
    it('is drawn whole as large as the stage holds, a side at its edge', () =>
    {
        expect(SHOWN).toEqual({ w: 800, h: 400 });
        expect(fitted({ w: 600, h: 1200 }, STAGE), 'a portrait one fills the height').toEqual({ w: 300, h: 600 });
        expect(fitted({ w: 100, h: 50 }, STAGE), 'a small one is drawn as large as it fits').toEqual({ w: 800, h: 400 });
        expect(fitted({ w: 0, h: 0 }, STAGE), 'one not yet measured').toEqual({ w: 0, h: 0 });
    });

    it('zooms about the point pressed, which stays under the pointer', () =>
    {
        const point = { x: 200, y: -50 };
        const frame = zoomAt(AT_REST, 2, point, SHOWN, STAGE);

        expect(frame.scale).toBe(2);

        // The photo's point that was under the pointer (200, -50 of its middle at rest) is under it still.
        expect(placed(frame, { x: 200, y: -50 })).toEqual(point);
    });

    it('goes no further in than four times, and no further out than whole', () =>
    {
        expect(zoomAt(AT_REST, 10, { x: 0, y: 0 }, SHOWN, STAGE).scale).toBe(ZOOM_MOST);
        expect(zoomAt({ scale: 2, x: 100, y: 0 }, 0.1, { x: 0, y: 0 }, SHOWN, STAGE)).toEqual(AT_REST);
    });

    it('is moved by a drag, and never so far that the stage shows past its edges', () =>
    {
        const zoomed = { scale: 2, x: 0, y: 0 };

        // At twice its size it is 1,600 by 800 on a stage of 800 by 600: 400 to spare each side across, 100 down.
        expect(panBy(zoomed, 150, 40, SHOWN, STAGE)).toEqual({ scale: 2, x: 150, y: 40 });
        expect(panBy(zoomed, 900, 900, SHOWN, STAGE)).toEqual({ scale: 2, x: 400, y: 100 });
        expect(panBy(zoomed, -900, -900, SHOWN, STAGE)).toEqual({ scale: 2, x: -400, y: -100 });
    });

    it('keeps a side that does not fill the stage in its middle', () =>
    {
        const portrait = fitted({ w: 600, h: 1200 }, STAGE);
        const frame = panBy({ scale: 1.5, x: 0, y: 0 }, 300, 300, portrait, STAGE);

        // At one and a half times a 300 by 600 photo is 450 wide: narrower than the stage, so it stays put across.
        expect(frame).toEqual({ scale: 1.5, x: 0, y: 150 });
        expect(panBy(AT_REST, 50, 50, SHOWN, STAGE), 'whole, it does not move at all').toEqual(AT_REST);
    });

    it('goes in at a double press about where it was pressed, and back to whole at the next', () =>
    {
        const point = { x: -120, y: 60 };
        const near = doubled(AT_REST, point, SHOWN, STAGE);

        expect(near.scale).toBe(ZOOM_DOUBLE);
        expect(placed(near, { x: -120, y: 60 })).toEqual(point);
        expect(doubled(near, point, SHOWN, STAGE)).toEqual(AT_REST);
    });

    it('holds a frame that was moved too far back to what can be seen', () =>
    {
        expect(held({ scale: 9, x: 5000, y: -5000 }, SHOWN, STAGE)).toEqual({ scale: ZOOM_MOST, x: 1200, y: -500 });
        expect(held({ scale: 0.2, x: 30, y: 30 }, SHOWN, STAGE)).toEqual(AT_REST);
    });
});
