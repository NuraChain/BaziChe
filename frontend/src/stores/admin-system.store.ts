import { createResource, createSignal, createStore, untrack, type Getter } from 'azerothjs';

import type { Skill } from '../../../backend/src/domains/system/rules.ts';
import type { AdminSystem, AdminSystemPlayer } from '../../../backend/src/schemas.ts';
import { client } from '../api.ts';
import { useAccount } from './account.store.ts';
import { paged, type Paged } from './admin-rewards.store.ts';

export type AdminSystemView = 'system' | 'players';

export interface AdminSystemApi
{
    want(view: AdminSystemView): void;
    system: Getter<AdminSystem | null>;
    systemFailed: Getter<boolean>;
    systemError: Getter<unknown>;
    players: Paged<AdminSystemPlayer>;
    switchTo(on: boolean, reason: string): Promise<AdminSystem>;
    setGame(game: string, on: boolean, reason: string): Promise<AdminSystem>;
    setSettings(settings: { wait: number; skill: Skill; most: number }, reason: string): Promise<AdminSystem>;
    retire(handle: string, reason: string): Promise<AdminSystemPlayer>;
    refresh(): Promise<void>;
    reset(): void;
}

export const useAdminSystem = createStore((): AdminSystemApi =>
{
    const account = useAccount();

    const reader = () => account.user()?.id ?? null;

    const [wanted, setWanted] = createSignal<readonly AdminSystemView[]>([]);

    /** Players retired from this page, shown as the server answered until the list is read again. */
    const [retired, setRetired] = createSignal<Readonly<Record<string, AdminSystemPlayer>>>({});

    const wants = (view: AdminSystemView) => () => (wanted().includes(view) ? reader() : null);

    const system = createResource(wants('system'), () => client.admin.system(), { name: 'admin.system' });

    const list = paged(
        wants('players'),
        (_, cursor) => client.admin.systemPlayers({ query: cursor === undefined ? {} : { cursor } }),
        'admin.system.players'
    );

    const players: Paged<AdminSystemPlayer> = {
        ...list,
        rows: () => list.rows().map((row) => retired()[row.handle] ?? row),

        async refetch()
        {
            setRetired({});
            await list.refetch();
        }
    };

    /** A config write answers with the whole view, figures included, which is read again so the page shows one answer. */
    const configured = async (write: Promise<AdminSystem>) =>
    {
        const answer = await write;

        await system.refetch();

        return answer;
    };

    return {
        want(view)
        {
            setWanted((now) => (now.includes(view) ? now : [...now, view]));
        },

        system: () => system.data() ?? null,
        systemFailed: () => system.error() !== null && system.data() === undefined,
        systemError: () => system.error(),
        players,

        switchTo: (on, reason) => configured(client.admin.switchSystem({ input: { on, reason } })),

        setGame: (game, on, reason) => configured(client.admin.setSystemGames({ input: { games: { [game]: on }, reason } })),

        setSettings: (settings, reason) => configured(client.admin.setSystemSettings({ input: { ...settings, reason } })),

        async retire(handle, reason)
        {
            const answer = await client.admin.retireSystemPlayer({ params: { handle }, input: { reason } });

            setRetired((now) => ({ ...now, [answer.handle]: answer }));
            await system.refetch();

            return answer;
        },

        async refresh()
        {
            const now = untrack(wanted);

            await Promise.all([
                now.includes('system') ? system.refetch() : undefined,
                now.includes('players') ? players.refetch() : undefined
            ]);
        },

        reset()
        {
            setWanted([]);
            setRetired({});
        }
    };
});
