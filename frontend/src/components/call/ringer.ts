import { createEffect, createRoot } from 'azerothjs';

import type { CallView } from '../../api.ts';
import type { Ring, Ringer } from '../../game/sound.ts';
import { runtime } from '../../lib/runtime.ts';
import { useCalls } from '../../stores/calls.store.ts';
import { useSettings } from '../../stores/settings.store.ts';

/** How long the ringer is kept once nothing of a call needs it, so a call's end is heard out before the sound lets go. */
export const RINGER_KEPT_MS = 1500;

/**
 * What a call says on this page while it rings: the ring wherever it rings for the reader, the
 * ringback on the page that rang once it rings there too, and nothing before that or after it.
 */
export function ringOf(call: CallView | null, here: boolean): Ring | null
{
    if (call === null || call.state !== 'ringing')
    {
        return null;
    }

    if (!call.out)
    {
        return 'ring';
    }

    return here && call.rung ? 'ringback' : null;
}

/** Whether this page is in the call: the one that rang it, or the one that took it. */
const inCall = (call: CallView, here: boolean) => here && (call.state === 'live' || (call.state === 'ringing' && call.out));

/**
 * Rings the call on screen under the device's sound switch: `ringOf`'s ring while it rings, and the
 * end once a call this page was in has ended, whoever ended it. The sound engine is fetched the
 * first time a call needs it, and let go of a moment after nothing does, so the page's audio is
 * not kept awake between calls.
 */
export function startRinger()
{
    const calls = useCalls();
    const settings = useSettings();
    const joined = new Set<string>();

    let ringer: Ringer | null = null;
    let making = false;
    let stopped = false;
    let wanted: Ring | null = null;
    let ending = false;
    let needing = false;
    let release: (() => void) | null = null;

    const apply = () =>
    {
        if (ringer === null)
        {
            return;
        }

        if (wanted === null)
        {
            ringer.quiet();
        }
        else
        {
            ringer.ring(wanted);
        }

        if (ending)
        {
            ending = false;
            ringer.end();
        }
    };

    const make = () =>
    {
        release?.();
        release = null;

        if (ringer !== null || making)
        {
            apply();
            return;
        }

        making = true;

        void import('../../game/sound.ts')
            .then((sound) =>
            {
                making = false;

                if (stopped)
                {
                    return;
                }

                ringer = sound.createRinger();

                if (needing)
                {
                    apply();
                }
                else
                {
                    letGo();
                }
            })
            .catch(() =>
            {
                making = false;
            });
    };

    const letGo = () =>
    {
        apply();

        if (ringer === null || release !== null)
        {
            return;
        }

        release = runtime().clock.after(RINGER_KEPT_MS, () =>
        {
            release = null;
            ringer?.dispose();
            ringer = null;
        });
    };

    const dispose = createRoot((end) =>
    {
        createEffect(() =>
        {
            const call = calls.current();
            const here = calls.here();
            const on = settings.settings().sound;

            if (call !== null && inCall(call, here))
            {
                joined.add(call.id);
            }

            const ended = call !== null && call.state === 'ended' && joined.delete(call.id);

            for (const id of joined)
            {
                if (id !== call?.id)
                {
                    joined.delete(id);
                }
            }

            wanted = on ? ringOf(call, here) : null;
            ending = on && (ending || ended);
            needing = on && (wanted !== null || ending || joined.size > 0);

            if (needing)
            {
                make();
            }
            else
            {
                letGo();
            }
        }, { name: 'calls.ringer' });

        return end;
    });

    return () =>
    {
        stopped = true;
        dispose();
        release?.();
        release = null;
        ringer?.dispose();
        ringer = null;
    };
}
