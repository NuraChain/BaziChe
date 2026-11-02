/** How a photo stands in the viewer: how large, and how far its middle is moved from the stage's, in pixels. */
export interface Frame
{
    scale: number;
    x: number;
    y: number;
}

export interface Size
{
    w: number;
    h: number;
}

/** A place on the stage, measured from its middle. */
export interface Point
{
    x: number;
    y: number;
}

/** As far in as a photo goes. */
export const ZOOM_MOST = 4;

/** How far in a double press takes a photo at rest. */
export const ZOOM_DOUBLE = 2.5;

export const AT_REST: Frame = { scale: 1, x: 0, y: 0 };

/** The size a photo is drawn at whole inside a stage, as large as fits. */
export function fitted(natural: Size, stage: Size): Size
{
    if (natural.w <= 0 || natural.h <= 0 || stage.w <= 0 || stage.h <= 0)
    {
        return { w: 0, h: 0 };
    }

    const by = Math.min(stage.w / natural.w, stage.h / natural.h);

    return { w: natural.w * by, h: natural.h * by };
}

/**
 * A frame kept to what can be seen: between whole and as far in as it goes, and never moved so far
 * that the stage shows past a zoomed photo's edge; a side that does not fill the stage stays centred.
 */
export function held(frame: Frame, shown: Size, stage: Size): Frame
{
    const scale = Math.min(ZOOM_MOST, Math.max(1, frame.scale));
    const room = (side: number, of: number) => Math.max(0, (side * scale - of) / 2);
    const keep = (value: number, most: number) => Math.min(most, Math.max(-most, value));

    return { scale, x: keep(frame.x, room(shown.w, stage.w)), y: keep(frame.y, room(shown.h, stage.h)) };
}

/** In or out by a factor about a point of the stage, which stays under the pointer or the fingers. */
export function zoomAt(frame: Frame, factor: number, point: Point, shown: Size, stage: Size)
{
    const scale = Math.min(ZOOM_MOST, Math.max(1, frame.scale * factor));
    const by = scale / frame.scale;

    return held({ scale, x: point.x - (point.x - frame.x) * by, y: point.y - (point.y - frame.y) * by }, shown, stage);
}

/** Moved by a drag. */
export function panBy(frame: Frame, dx: number, dy: number, shown: Size, stage: Size)
{
    return held({ scale: frame.scale, x: frame.x + dx, y: frame.y + dy }, shown, stage);
}

/** A double press: in about where it was pressed, or back to whole. */
export function doubled(frame: Frame, point: Point, shown: Size, stage: Size)
{
    return frame.scale > 1 ? AT_REST : zoomAt(frame, ZOOM_DOUBLE, point, shown, stage);
}
