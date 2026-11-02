import { GROUP_REFUSALS, type GroupRefusal } from '../../../backend/src/domains/group/refusals.ts';
import { ApiError } from '../api.ts';
import { whyFailed } from './failure.ts';

/**
 * What a group's refusal is said as, in the reader's words: what went wrong on the way first, as
 * every reader of a refusal says it, then the group's own word, and the plain sentence for the rest.
 */
export function whyGroup(error: unknown)
{
    const code = error instanceof ApiError ? error.code : undefined;

    return code !== undefined && Object.hasOwn(GROUP_REFUSALS, code)
        ? whyFailed(error, `group.refused.${ code as GroupRefusal }`)
        : whyFailed(error);
}
