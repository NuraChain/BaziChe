import { CALL_ENDINGS, type CallEnding } from '../../../../backend/src/domains/call/rules.ts';
import type { MessageLine } from '../../data/chat.ts';
import { isLineKey, namedParams } from '../../lib/lines.ts';
import type { MessageKey } from '../../locales/en.ts';
import type { LocaleApi } from '../../stores/locale.store.ts';
import { voiceClock } from './gist.ts';

/** How a call that ended reads from each side of it (MS-D34): whoever rang, and whoever was rung. */
const CALL_SAID = {
    out: { answered: 'chat.call.outgoing', missed: 'chat.call.noAnswer', declined: 'chat.call.declined', busy: 'chat.call.busy', cancelled: 'chat.call.cancelled' },
    in: { answered: 'chat.call.incoming', missed: 'chat.call.missed', declined: 'chat.call.declined', busy: 'chat.call.missed', cancelled: 'chat.call.missed' }
} as const satisfies Record<'out' | 'in', Record<Exclude<CallEnding, 'failed'>, MessageKey>>;

const said = (ending: string | readonly string[] | undefined): ending is Exclude<CallEnding, 'failed'> =>
    typeof ending === 'string' && ending !== 'failed' && (CALL_ENDINGS as readonly string[]).includes(ending);

/** Whether a line is a call that rang for the reader and nobody took up: the one said "Missed call" to them. */
export function callMissed(line: MessageLine, me: string)
{
    const { who, ending } = line.params;

    return line.key === 'chat.line.call' && typeof who === 'string' && said(ending) && who.toLowerCase() !== me.toLowerCase() && CALL_SAID.in[ending] === 'chat.call.missed';
}

/**
 * A line the server wrote, in the reader's words, or nothing for a key this client does not know.
 * A call's line is said from the reader's own side: the one who rang reads "Outgoing call", the
 * other "Incoming call", and a call nobody answered is "Missed call" only to whoever it rang.
 */
export function lineSaid(line: MessageLine, me: string, nameOf: (handle: string) => string, locale: Pick<LocaleApi, 't' | 'list' | 'n'>)
{
    if (!isLineKey(line.key))
    {
        return '';
    }

    if (line.key !== 'chat.line.call')
    {
        return locale.t(line.key, namedParams(line.params, nameOf, locale));
    }

    const { who, ending, seconds } = line.params;

    if (typeof who !== 'string' || !said(ending))
    {
        return locale.t('chat.line.call', namedParams(line.params, nameOf, locale));
    }

    const side = who.toLowerCase() === me.toLowerCase() ? 'out' : 'in';

    return locale.t(CALL_SAID[side][ending], { duration: voiceClock(Number(typeof seconds === 'string' ? seconds : 0), locale.n) });
}
