export const primaryPress = (event: PointerEvent) => event.isPrimary && event.button === 0;

export function crossedSlop(event: PointerEvent, start: { x: number; y: number })
{
    const threshold = event.pointerType === 'mouse' ? 4 : 10;

    return Math.hypot(event.clientX - start.x, event.clientY - start.y) >= threshold;
}

export function insideRect(event: PointerEvent, rect: DOMRectReadOnly)
{
    return event.clientX >= rect.left && event.clientX < rect.right
        && event.clientY >= rect.top && event.clientY < rect.bottom;
}
