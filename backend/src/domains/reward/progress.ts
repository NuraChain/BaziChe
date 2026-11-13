import type { GameId, QuestTemplate } from './quests.ts';
import type { EntityManager } from 'typeorm';
import type { Match } from '../../entities/match.entity.ts';

export type RewardMatchResult = 'won' | 'lost' | 'drawn' | 'abandoned' | 'void';
export type RewardQuestMetric = 'played' | 'won' | 'played-with-friend' | 'tournament-played' | 'distinct-games' | `tally:${string}`;

export interface QuestCountInput
{
    game: GameId;
    result?: RewardMatchResult;
    credit?: boolean;
    ownTurns?: number;
    playerId?: string;
    opponentIds?: readonly string[];
    sameOpponentCounts?: Record<string, number>;
    friendOpponentIds?: readonly string[];
    establishedOpponents?: readonly string[];
    tournament?: boolean;
    tally?: Record<string, number | null | undefined>;
    distinctGames?: number;
}

export const MIN_QUEST_TURNS: Readonly<Record<GameId, number>> = {
    hokm: 10,
    backgammon: 12,
    poker: 10,
    ludo: 12,
    chess: 14
};

const opponentIds = (facts: QuestCountInput): string[] =>
{
    const ids = facts.opponentIds ?? [];
    if (facts.playerId === undefined)
    {
        return [...new Set(ids)];
    }

    return [...new Set(ids.filter((id) => id !== facts.playerId))];
};

const matchesCounted = (facts: QuestCountInput): boolean =>
{
    const result = facts.result ?? 'lost';

    if (result === 'won' && facts.credit !== true)
    {
        return false;
    }

    if (!['won', 'lost', 'drawn'].includes(result))
    {
        return false;
    }

    if (opponentIds(facts).length === 0)
    {
        return false;
    }

    if (Object.values(facts.sameOpponentCounts ?? {}).some((count) => count > 3))
    {
        return false;
    }

    const ownTurns = facts.ownTurns ?? 0;
    return ownTurns >= (MIN_QUEST_TURNS[facts.game] ?? 10);
};

const playedWithFriend = (facts: QuestCountInput): boolean =>
{
    const ids = opponentIds(facts);
    const friends = new Set(facts.friendOpponentIds ?? []);
    return ids.some((id) => friends.has(id));
};

export const countsForQuests = (facts: QuestCountInput): Record<string, number> =>
{
    const counts: Record<string, number> = {};
    const counted = matchesCounted(facts);

    if (counted)
    {
        counts.played = 1;
    }

    if (counted && facts.result === 'won' && facts.credit === true)
    {
        const established = new Set(facts.establishedOpponents ?? []);
        const hasEstablishedOpponent = opponentIds(facts).some((id) => established.has(id));

        if (hasEstablishedOpponent)
        {
            counts.won = 1;
        }
    }

    if (counted && playedWithFriend(facts))
    {
        counts['played-with-friend'] = 1;
    }

    if (counted && facts.tournament === true)
    {
        counts['tournament-played'] = 1;
    }

    if (counted && typeof facts.distinctGames === 'number' && facts.distinctGames > 0)
    {
        counts['distinct-games'] = facts.distinctGames;
    }

    for (const [name, value] of Object.entries(counted ? facts.tally ?? {} : {}))
    {
        const count = Number(value ?? 0);
        if (Number.isFinite(count) && count > 0)
        {
            counts[`tally:${ name }`] = count;
        }
    }

    return counts;
};

export const deltasForQuests = (quests: readonly QuestTemplate[], game: GameId, counts: Record<string, number>) =>
    quests.flatMap((quest) =>
    {
        if (quest.game !== 'any' && quest.game !== game)
        {
            return [];
        }

        const metric = typeof quest.metric === 'string' ? quest.metric : `tally:${ quest.metric.tally }`;
        const progress = counts[metric] ?? 0;

        return progress <= 0 ? [] : [{ period: quest.period, questId: quest.id, progress, target: quest.target }];
    });

export const weeklyChestReady = (questIds: readonly string[], claimedQuestIds: readonly string[]) =>
{
    const claimed = new Set(claimedQuestIds);
    return questIds.length === 3 && questIds.every((id) => claimed.has(id));
};

export interface RewardFinishPlayer
{
    userId: string;
    seat: number;
    result: RewardMatchResult;
    credit?: boolean;
    ownTurns: number;
    tally: Record<string, number | null | undefined>;
    opponentIds: readonly string[];
}

export interface RewardFinishEffects
{
    changed: string[];
    ready: { userId: string; periodKey: string; questId: string }[];
}

export interface QuestProgressHook
{
    onFinish?(tx: EntityManager, match: Match, game: GameId, players: readonly RewardFinishPlayer[]): Promise<RewardFinishEffects>;
}
