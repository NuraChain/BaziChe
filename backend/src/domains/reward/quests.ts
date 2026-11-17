/**
 * Reward quest catalog and rotation. The server owns the quest schedule and each player gets the same
 * deterministic selection for the same cycle/day/week; the client never reports progress.
 */

export const AVAILABLE_GAMES = ['hokm', 'backgammon', 'poker', 'ludo', 'chess'] as const;

export type GameId = (typeof AVAILABLE_GAMES)[number];

export type QuestMetric =
    | 'played'
    | 'won'
    | 'played-with-friend'
    | 'tournament-played'
    | 'distinct-games'
    | { tally: string };

export interface QuestTemplate
{
    id: string;
    period: 'daily' | 'weekly';
    game: GameId | 'any';
    metric: QuestMetric;
    target: number;
}

/** A metric as the wire and the progress counters name it: a tally as `tally:<name>`. */
export const metricOf = (quest: Pick<QuestTemplate, 'metric'>) => typeof quest.metric === 'string' ? quest.metric : `tally:${ quest.metric.tally }`;

/** The most a metric can count in one period: different games are as many as there are games, anything else grows with every match. */
export const mostInPeriod = (quest: Pick<QuestTemplate, 'metric' | 'game'>) =>
    quest.metric === 'distinct-games' ? (quest.game === 'any' ? AVAILABLE_GAMES.length : 1) : Number.POSITIVE_INFINITY;

/** A quest as the page draws it, with the NURA it pays: a quest with no progress row is neither done nor claimed. */
export const questView = (quest: QuestTemplate, row: { progress: number; doneAt: Date | null; claimedAt: Date | null } | undefined, reward: number) => ({
    id: quest.id,
    game: quest.game,
    metric: metricOf(quest),
    target: quest.target,
    reward,
    progress: row?.progress ?? 0,
    done: row !== undefined && row.doneAt !== null,
    claimed: row !== undefined && row.claimedAt !== null
});

const TALLY_METRICS: Record<GameId, readonly QuestMetric[]> = {
    hokm: [{ tally: 'hands' }, { tally: 'tricks' }, { tally: 'kots' }, { tally: 'trumps' }],
    backgammon: [{ tally: 'games' }, { tally: 'gammons' }, { tally: 'backgammons' }, { tally: 'hits' }, { tally: 'borneOff' }],
    poker: [{ tally: 'hands' }, { tally: 'pots' }, { tally: 'showdowns' }, { tally: 'knockouts' }],
    ludo: [{ tally: 'rolls' }, { tally: 'sixes' }, { tally: 'captures' }, { tally: 'home' }, { tally: 'enters' }],
    chess: [{ tally: 'moves' }, { tally: 'captures' }, { tally: 'checks' }, { tally: 'checkmates' }, { tally: 'castles' }, { tally: 'promotions' }, { tally: 'enPassants' }, { tally: 'draws' }]
} as const;

/**
 * The daily tally quests and their targets, each sized to about 30 minutes of that game (reward.md
 * section 3): a few matches at the least turns that count. A tally so rare that a day of play may
 * not make it (an en passant, a backgammon) is not asked for daily, and neither is a tournament,
 * which a day may not have.
 */
const DAILY_TALLY_TARGETS: Record<GameId, Readonly<Record<string, number>>> = {
    hokm: { hands: 6, tricks: 25, kots: 1, trumps: 2 },
    backgammon: { games: 3, gammons: 1, hits: 6, borneOff: 30 },
    poker: { hands: 30, pots: 5, showdowns: 3, knockouts: 1 },
    ludo: { rolls: 80, sixes: 12, captures: 3, home: 4, enters: 4 },
    chess: { moves: 60, captures: 12, checks: 6, checkmates: 1, castles: 2, promotions: 1, draws: 1 }
};

const DAILY_TARGETS: Readonly<Record<'played' | 'won' | 'played-with-friend', number>> = { played: 4, won: 3, 'played-with-friend': 2 };

const makeTemplates = (): QuestTemplate[] =>
{
    const daily: QuestTemplate[] = [
        { id: 'any-played-daily', period: 'daily', game: 'any', metric: 'played', target: 6 },
        { id: 'any-won-daily', period: 'daily', game: 'any', metric: 'won', target: 4 },
        { id: 'any-friend-daily', period: 'daily', game: 'any', metric: 'played-with-friend', target: 2 }
    ];

    const weekly: QuestTemplate[] = [
        { id: 'any-played-weekly', period: 'weekly', game: 'any', metric: 'played', target: 18 },
        { id: 'any-won-weekly', period: 'weekly', game: 'any', metric: 'won', target: 12 },
        { id: 'any-distinct-weekly', period: 'weekly', game: 'any', metric: 'distinct-games', target: 3 }
    ];

    const nextQuestTemplates: QuestTemplate[] = [];
    for (const game of AVAILABLE_GAMES)
    {
        const dailyMetrics: [QuestMetric, number][] = [
            ...Object.entries(DAILY_TARGETS) as [QuestMetric, number][],
            ...Object.entries(DAILY_TALLY_TARGETS[game]).map(([tally, target]): [QuestMetric, number] => [{ tally }, target])
        ];

        for (const [metric, target] of dailyMetrics)
        {
            nextQuestTemplates.push({
                id: `${ game }-${ typeof metric === 'string' ? metric : metric.tally }-daily`,
                period: 'daily',
                game,
                metric,
                target
            });
        }

        // One game's matches make one distinct game at most, so `distinct-games` is an any-game quest only.
        const weeklyMetrics = ['played', 'won', ...TALLY_METRICS[game].slice(0, 2)] as const;
        for (const metric of weeklyMetrics)
        {
            const target = metric === 'played' ? 12 : metric === 'won' ? 9 : 10;
            nextQuestTemplates.push({
                id: `${ game }-${ typeof metric === 'string' ? metric : metric.tally }-weekly`,
                period: 'weekly',
                game,
                metric,
                target
            });
        }
    }

    return [...daily, ...weekly, ...nextQuestTemplates];
};

export const QUEST_TEMPLATES = makeTemplates();

/** A template by its period and id, whatever the rotation drew: a row of progress is only written for a quest that was drawn. */
export const templateOf = (period: 'daily' | 'weekly', questId: string) =>
    QUEST_TEMPLATES.find((quest) => quest.period === period && quest.id === questId) ?? null;

const TEMPLATES_OF = (period: 'daily' | 'weekly', game: GameId | 'any') => QUEST_TEMPLATES.filter((quest) => quest.period === period && quest.game === game);

/** The games quests may be drawn from, in the catalogue's order whatever order they were read in, so the draw is the same everywhere. */
export const drawnGames = (available: Iterable<string>): GameId[] =>
{
    const open = new Set(available);

    return AVAILABLE_GAMES.filter((game) => open.has(game));
};

/**
 * Deterministic rotation over the games that are available: one any-game quest and one quest each
 * of two different games. Day (or week) n takes games 2n and 2n+1 round-robin, so over as many
 * days as there are games each one is drawn twice, and two games in a row are always different.
 * A template is chosen by n itself, so the same game on two consecutive days asks for two
 * different things; with a single game available there is one game quest, with none only the
 * any-game one.
 */
export const questsFor = (cycleIndex: number, dayOrWeek: number, period: 'daily' | 'weekly', games: readonly GameId[]): QuestTemplate[] =>
{
    const n = cycleIndex * (period === 'daily' ? 30 : 4) + dayOrWeek - 1;
    // Different games cannot be more than the games there are to play.
    const anyList = TEMPLATES_OF(period, 'any').filter((quest) => quest.metric !== 'distinct-games' || quest.target <= games.length);
    const drawn = games.length === 0 ? [] : [...new Set([games[(2 * n) % games.length], games[(2 * n + 1) % games.length]])];

    return [
        ...drawn.map((game) =>
        {
            const list = TEMPLATES_OF(period, game);

            return list[n % list.length];
        }),
        anyList[n % anyList.length]
    ];
};
