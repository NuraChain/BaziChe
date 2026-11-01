export const SEARCH_FIELD = 'input[type="search"]';

export const FIRST_CHIP = 'button[aria-pressed]';

export const FIRST_TAB = '[role="tab"]';

/** A way back takes its own button off the page, and the keyboard on it would fall to the page with it. */
export function keyboardTo(root: ParentNode | null, control: string)
{
    root?.querySelector<HTMLElement>(control)?.focus();
}
