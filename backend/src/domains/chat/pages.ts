export const THREAD_PAGE = 40;

export const THREAD_MOST = 400;

/** What a conversation's gallery lists apart (MS-D25): its photos and videos, its files and its voice messages. */
export const MEDIA_KINDS = ['media', 'files', 'voice'] as const;

export type MediaKind = typeof MEDIA_KINDS[number];

/** How many of them one page of the gallery carries. */
export const MEDIA_PAGE = 50;

export function threadSize(asked: string | undefined)
{
    const wanted = Number.parseInt(asked ?? '', 10);

    return Number.isFinite(wanted) ? Math.min(Math.max(wanted, 1), THREAD_MOST) : THREAD_PAGE;
}
