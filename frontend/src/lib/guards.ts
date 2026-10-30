import { redirect, type GuardContext, type GuardVerdict } from 'azerothjs';

import type { Ability } from '../../../backend/src/domains/admin/roles.ts';

export function safeNext(candidate: string | string[] | undefined)
{
    const value = Array.isArray(candidate) ? candidate[0] : candidate;
    return value !== undefined && value.startsWith('/app') && !value.startsWith('//') ? value : '/app';
}

async function settled(): Promise<{ signedIn: () => boolean }>
{
    const { useSession } = await import('../stores/session.store.ts');
    const session = useSession();
    await session.ready();
    return session;
}

const PERSON = /^\/app\/people\/([^/]+)\/?$/;

export async function requireSession(context: GuardContext): Promise<GuardVerdict>
{
    if ((await settled()).signedIn())
    {
        return true;
    }

    // A profile is the one page somebody can be sent before they have a wallet, so its link works
    // for them too: it opens as the public page, not as the way in.
    const person = PERSON.exec(context.pathname);

    return person === null
        ? redirect({ pathname: '/sign-in', query: { next: context.pathname } })
        : redirect(`/people/${ person[1] }`);
}

export async function signedOutPerson(context: GuardContext): Promise<GuardVerdict>
{
    return (await settled()).signedIn() ? redirect(`/app/people/${ encodeURIComponent(String(context.params.handle ?? '')) }`) : true;
}

/** The reader's role and the admin's rules, fetched as an address under /admin is asked for: imported here, every constant a page of the admin reads from the rules would ride in the first chunk. */
async function staffRules()
{
    const [{ useSession }, { may }, { sectionsFor }] = await Promise.all([
        import('../stores/session.store.ts'),
        import('../../../backend/src/domains/admin/roles.ts'),
        import('./admin-sections.ts')
    ]);
    const session = useSession();
    await session.ready();
    return { role: session.account()?.staff ?? null, may, sectionsFor };
}

export const requireAbility = (ability: Ability) => async (): Promise<GuardVerdict> =>
{
    const { role, may } = await staffRules();
    return may(role, ability);
};

export async function requireStaff(): Promise<GuardVerdict>
{
    const { role, sectionsFor } = await staffRules();
    return sectionsFor(role).length > 0;
}

export async function firstSection(): Promise<GuardVerdict>
{
    const { role, sectionsFor } = await staffRules();
    const [first] = sectionsFor(role);
    return first === undefined ? false : redirect(`/admin/${ first }`);
}

export async function requireAnonymous(context: GuardContext): Promise<GuardVerdict>
{
    if (!(await settled()).signedIn())
    {
        return true;
    }
    return redirect(safeNext(context.query.next));
}
