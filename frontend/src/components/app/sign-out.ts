import { leaveReach } from '../../lib/push.ts';
import { useSession } from '../../stores/session.store.ts';
import { useWallet } from '../../stores/wallet.store.ts';

/** Why the app sent the reader to sign in, said on that page (`pages/sign-in.page`); a sign-out of their own says nothing. */
export type SignedOutWhy = 'ended' | 'wallet';

const signInFor = (next: string | null, why?: SignedOutWhy) =>
{
    const query = new URLSearchParams();

    if (next !== null)
    {
        query.set('next', next);
    }

    if (why !== undefined)
    {
        query.set('why', why);
    }

    const said = query.toString();

    return said === '' ? '/sign-in' : `/sign-in?${ said }`;
};

const here = () => `${ window.location.pathname }${ window.location.search }`;

export async function signOut(next: string | null = null, why?: SignedOutWhy)
{
    useWallet().disconnect();
    await leaveReach();
    await useSession().signOut();
    window.location.replace(signInFor(next, why));
    return true;
}

export function watchSignedOut()
{
    let leaving = false;

    const ended = async () =>
    {
        if (leaving)
        {
            return;
        }

        leaving = true;
        useWallet().disconnect();
        await leaveReach();
        window.location.replace(signInFor(here(), 'ended'));
    };

    const left = (address: string) =>
    {
        const mine = useSession().account()?.address;

        if (leaving || mine === undefined || mine.toLowerCase() !== address.toLowerCase())
        {
            return;
        }

        leaving = true;
        void signOut(here(), 'wallet');
    };

    const stops = [useSession().onEnded(() => void ended()), useWallet().onLeft(left)];

    return () =>
    {
        for (const stop of stops)
        {
            stop();
        }
    };
}
