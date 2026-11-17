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

    /** Rows read again after a retire, shown over the loaded pages until the list itself is read again. */
    const [fresher, setFresher] = createSignal<Readonly<Record<string, AdminSystemPlayer>>>({});

    const wants = (view: AdminSystemView) => () => (wanted().includes(view) ? reader() : null);

    const system = createResource(wants('system'), () => client.admin.system(), { name: 'admin.system' });

    const list = paged(
        wants('players'),
        (_, cursor) => client.admin.systemPlayers({ query: cursor === undefined ? {} : { cursor } }),
        'admin.system.players'
    );

    const players: Paged<AdminSystemPlayer> = {
        ...list,
        rows: () => list.rows().map((row) => fresher()[row.handle] ?? row),

        async refetch()
        {
            setFresher({});
            await list.refetch();
        }
    };

    /** The pages already shown, read again from the first, so a page loaded further down is kept. */
    const reread = async (shown: number) =>
    {
        const rows: Record<string, AdminSystemPlayer> = {};
        let cursor: string | undefined;
        let read = 0;

        do
        {
            const page = await client.admin.systemPlayers({ query: cursor === undefined ? {} : { cursor } });

            for (const row of page.rows)
            {
                rows[row.handle] = row;
            }

            read += page.rows.length;
            cursor = page.cursor;
        }
        while (cursor !== undefined && read < shown);

        return rows;
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

            setFresher((now) => ({ ...now, [answer.handle]: answer }));
            // The answer can still name the table it waits at: the filler stands it up on its own sweep.
            const [, again] = await Promise.all([system.refetch(), reread(untrack(list.rows).length)]);

            setFresher((now) => ({ ...now, ...again }));

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
            setFresher({});
        }
    };
});
