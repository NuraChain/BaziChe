import { attempt } from './attempt.ts';
import { primeVoice } from './primed-voice.ts';

/**
 * Rings a conversation's room from wherever a call is offered: the other person of a direct one, from
 * the head of its thread or the sheet about a friend (whose conversation may still be on its way), or a
 * group's voice chat from the head of its thread, which the ring begins or joins. A ring refused is
 * said by the calls' store; a conversation that could not be opened, or the calls' chunk that would
 * not load, is said here, so every press ends in a sentence and nothing is left unhandled.
 */
export async function placeCall(room: string | Promise<string>)
{
    // Inside the press, before the calls' chunk is fetched: Safari grants the microphone nowhere else.
    primeVoice();

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
