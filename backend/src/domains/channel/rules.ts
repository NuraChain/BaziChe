/**
 * A channel's bounds, read by both halves. Imports nothing, so the browser can take it whole.
 */

/** A channel's name, in characters. */
export const CHANNEL_NAME_LEAST = 2;
export const CHANNEL_NAME_MOST = 64;

/** A channel's bio, in characters. */
export const CHANNEL_BIO_MOST = 300;

/** The words of a post, or a file's caption, in characters. */
export const CHANNEL_TEXT_MOST = 4096;

/** A poll: its question and each answer, in characters, and how many answers it may offer. */
export const POLL_QUESTION_MOST = 255;
export const POLL_ANSWER_MOST = 100;
export const POLL_ANSWERS_LEAST = 2;
export const POLL_ANSWERS_MOST = 10;

/** How many posts one page of a channel carries. */
export const CHANNEL_PAGE = 30;

export const CHANNEL_PRIVACY = ['public', 'private'] as const;

export type ChannelPrivacy = typeof CHANNEL_PRIVACY[number];

export const CHANNEL_ROLES = ['owner', 'admin', 'member'] as const;

export type ChannelRole = typeof CHANNEL_ROLES[number];

export const CHANNEL_POST_KINDS = ['text', 'file', 'poll'] as const;

export type ChannelPostKind = typeof CHANNEL_POST_KINDS[number];

/** A poll as its poster set it: the question, the answers, and whether it is anonymous and takes several. */
export interface Poll
{
    question: string;
    answers: string[];
    anonymous: boolean;
    multiple: boolean;
}

/** Whether a role may post, delete a post, and edit the channel's face. */
export const speaks = (role: ChannelRole | null) => role === 'owner' || role === 'admin';

/** A poll as it may be kept, its words trimmed, or null when it is not one. */
export function pollOf(value: unknown): Poll | null
{
    if (typeof value !== 'object' || value === null || Array.isArray(value))
    {
        return null;
    }

    const { question, answers, anonymous, multiple, ...rest } = value as Record<string, unknown>;

    if (Object.keys(rest).length > 0 || typeof question !== 'string' || !Array.isArray(answers)
        || typeof anonymous !== 'boolean' || typeof multiple !== 'boolean')
    {
        return null;
    }

    const asked = question.trim();
    const offered = answers.map((one) => (typeof one === 'string' ? one.trim() : ''));

    if (asked === '' || asked.length > POLL_QUESTION_MOST
        || offered.length < POLL_ANSWERS_LEAST || offered.length > POLL_ANSWERS_MOST
        || offered.some((one) => one === '' || one.length > POLL_ANSWER_MOST)
        || new Set(offered.map((one) => one.toLocaleLowerCase())).size !== offered.length)
    {
        return null;
    }

    return { question: asked, answers: offered, anonymous, multiple };
}
