/**
 * A `localStorage` that keeps what it is handed, for a spec: the one this environment gives keeps
 * nothing. `refusing` is a device that keeps nothing at all and says so by throwing, as a private
 * window or a full disk does.
 */
export function memoryStorage()
{
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    const memory = new Map<string, string>();

    const install = (storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) =>
        Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });

    return {
        memory,

        fresh()
        {
            memory.clear();
            install({
                getItem: (key) => memory.get(key) ?? null,
                setItem: (key, value) =>
                {
                    memory.set(key, String(value));
                },
                removeItem: (key) =>
                {
                    memory.delete(key);
                }
            });
        },

        refusing()
        {
            install({
                getItem: () =>
                {
                    throw new Error('SecurityError');
                },
                setItem: () =>
                {
                    throw new Error('QuotaExceededError');
                },
                removeItem: () =>
                {
                    throw new Error('SecurityError');
                }
            });
        },

        restore()
        {
            if (original !== undefined)
            {
                Object.defineProperty(window, 'localStorage', original);
            }
        }
    };
}
