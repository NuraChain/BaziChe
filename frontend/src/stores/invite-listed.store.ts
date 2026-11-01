import { createResource, createStore, type Getter } from 'azerothjs';

import { client, type InviteListed } from '../api.ts';
import { attempt } from '../lib/attempt.ts';
import { createGuesses } from '../lib/guess.ts';
import { useAccount } from './account.store.ts';

export interface InviteListedApi
{
    /** Whether the reader is shown among the top inviters, a press still on its way laid over what the server said; null until it has said. */
    listed: Getter<boolean | null>;

    /** Shows the reader among the top inviters or takes them off: at the press, and taken back with a sentence when refused. */
    list(on: boolean): Promise<boolean>;
}

/** The Settings switch that keeps the reader off the top inviters, kept apart from the invite page's own store. */
export const useInviteListed = createStore((): InviteListedApi =>
{
    const account = useAccount();
    const read = createResource(
        () => account.user()?.id ?? null,
        async (who) => ({ who, said: await client.invites.listed() }),
        { name: 'invites.listed' }
    );
    const guesses = createGuesses<InviteListed>();

    const readAgain = async () =>
    {
        await read.refetch();

        const error = read.error();

        if (error !== null)
        {
            throw error;
        }
    };

    return {
        listed: () =>
        {
            const held = read.data();

            return held === undefined || held === null || held.who !== account.user()?.id ? null : guesses.over(held.said).listed;
        },

        list: (on) => attempt(guesses.during(() => ({ listed: on }), () => client.invites.list({ input: { on } }), readAgain))
    };
});
