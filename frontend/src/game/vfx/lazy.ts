import type { Vfx, VfxOptions } from './engine.ts';

/**
 * The engine over `host`, fetched the first time something asks for it, so a page or a table where
 * nobody wears an effect never loads it. A host let go before it arrives gets no canvas.
 */
export function lazyVfx(host: HTMLElement, options: VfxOptions = {})
{
    let made: Promise<Vfx | null> | null = null;
    let vfx: Vfx | null = null;
    let gone = false;

    const engine = () => made ??= import('./engine.ts').then(({ createVfx }) =>
    {
        if (!gone)
        {
            vfx = createVfx(host, options);
        }
        return vfx;
    }, () => null);

    return {
        /** Fetches the engine ahead of the first effect, so that one plays when it is due. */
        warm()
        {
            void engine();
        },

        /** Runs `effect` once the engine is here; nothing once let go. */
        play(effect: (vfx: Vfx) => void)
        {
            void engine().then((one) =>
            {
                if (one !== null && !gone)
                {
                    effect(one);
                }
            });
        },

        dispose()
        {
            gone = true;
            vfx?.dispose();
            vfx = null;
        }
    };
}
