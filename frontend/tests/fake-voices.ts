import type { SoundHandle } from '../src/game/sound.ts';

/** A voices handle a page made: what it was made with, and everything it was told since. */
export interface MadeVoices
{
    on: boolean;
    turned: boolean[];
    worn: string[][];
    played: { cue: string; after?: number }[];
    disposed: boolean;
    handle: SoundHandle;
}

/** Every voices handle made since the last `forgetVoices`, oldest first, and what each one's `ready` answers. */
export const voices = { made: [] as MadeVoices[], ready: Promise.resolve() };

export const forgetVoices = () =>
{
    voices.made = [];
    voices.ready = Promise.resolve();
};

/** Holds every handle's `ready` until what it answers is called, as voices whose packs are still on their way. */
export const holdVoices = () =>
{
    let release = () => undefined as void;

    voices.ready = new Promise<void>((resolve) =>
    {
        release = resolve;
    });

    return () => release();
};

/**
 * Stands in for the engine's `createVoices` in a spec that asks what a page did with its voices:
 * `vi.mock('../src/game/sound.ts', ...)` hands it out beside the real module.
 */
export function createVoices(on: boolean)
{
    const made: MadeVoices = {
        on,
        turned: [],
        worn: [],
        played: [],
        disposed: false,
        handle: {
            play: (cue, options) =>
            {
                made.played.push(options?.after === undefined ? { cue } : { cue, after: options.after });
            },
            wear: (collections) =>
            {
                made.worn.push([...collections]);
            },
            ready: () => voices.ready,
            setEnabled: (next) =>
            {
                made.turned.push(next);
            },
            dispose: () =>
            {
                made.disposed = true;
            }
        }
    };

    voices.made.push(made);

    return made.handle;
}
