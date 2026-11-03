import { attempt } from './attempt.ts';

/**
 * Rings the other person of a direct conversation from wherever a call is offered: the head of a
 * thread, the sheet about a friend (whose conversation may still be on its way). A ring refused is
 * said by the calls' store; a conversation that could not be opened, or the calls' chunk that would
 * not load, is said here, so every press ends in a sentence and nothing is left unhandled.
 */
export async function placeCall(room: string | Promise<string>)
{
    try
    {
        const [{ useCalls }, id] = await Promise.all([import('../stores/calls.store.ts'), room]);

        return await useCalls().ring(id);
    }
    catch (error)
    {
        return await attempt(Promise.reject(error));
    }
}
