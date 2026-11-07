import { useLocale } from '../stores/locale.store.ts';
import { useToasts } from '../stores/toasts.store.ts';
import { useVoice } from '../stores/voice.store.ts';
import { primeVoice } from './primed-voice.ts';

/**
 * Joins a table's voice. `pressed` when a press asked for it, which is the one moment WebKit grants the
 * microphone, so it is asked for there (`primed-voice.ts`); a join the page makes by itself - entering
 * a table with voice set to join, a call gone live - asks for nothing more than it always did. Priming
 * on those too held a second microphone beside the first, and on iOS each one ends the other.
 */
export function joinVoice(table: string, pressed = false)
{
    if (pressed)
    {
        primeVoice();
    }

    const voice = useVoice();

    return voice.join(table).then(() =>
    {
        const mic = voice.mic();

        if (mic === 'denied' || mic === 'absent')
        {
            useToasts().show({ kind: 'info', text: useLocale().t(mic === 'denied' ? 'voice.micDenied' : 'voice.micAbsent'), dedupe: 'voice-mic' });
        }
    });
}
