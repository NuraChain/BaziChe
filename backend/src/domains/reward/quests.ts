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
    | { tally: 'rolls' | 'sixes' | 'captures' | 'home' | 'enters' | 'hands' | 'tricks' | 'kots' | 'trumps' | 'games' | 'gammons' | 'backgammons' | 'hits' | 'borneOff' | 'pots' | 'showdowns' | 'knockouts' | 'moves' | 'captures' | 'checks' | 'checkmates' | 'castles' | 'promotions' | 'enPassants' | 'draws' };

export interface QuestTemplate
{
    id: string;
    period: 'daily' | 'weekly';
    game: GameId | 'any';
    metric: QuestMetric;
    target: number;
    title: string;
    blurb: string;
}

const TALLY_METRICS: Record<GameId, readonly QuestMetric[]> = {
    hokm: [{ tally: 'hands' }, { tally: 'tricks' }, { tally: 'kots' }, { tally: 'trumps' }],
    backgammon: [{ tally: 'games' }, { tally: 'gammons' }, { tally: 'backgammons' }, { tally: 'hits' }, { tally: 'borneOff' }],
    poker: [{ tally: 'hands' }, { tally: 'pots' }, { tally: 'showdowns' }, { tally: 'knockouts' }],
    ludo: [{ tally: 'rolls' }, { tally: 'sixes' }, { tally: 'captures' }, { tally: 'home' }, { tally: 'enters' }],
    chess: [{ tally: 'moves' }, { tally: 'captures' }, { tally: 'checks' }, { tally: 'checkmates' }, { tally: 'castles' }, { tally: 'promotions' }, { tally: 'enPassants' }, { tally: 'draws' }]
} as const;

const makeTemplates = (): QuestTemplate[] =>
{
    const daily: QuestTemplate[] = [
        { id: 'any-played-daily', period: 'daily', game: 'any', metric: 'played', target: 6, title: 'Daily table regular', blurb: 'Finish 6 games of any kind.' },
        { id: 'any-won-daily', period: 'daily', game: 'any', metric: 'won', target: 4, title: 'Daily champion', blurb: 'Win 4 games of any kind.' },
        { id: 'any-friend-daily', period: 'daily', game: 'any', metric: 'played-with-friend', target: 2, title: 'Daily friend games', blurb: 'Play 2 games with a friend.' }
    ];

    const weekly: QuestTemplate[] = [
        { id: 'any-played-weekly', period: 'weekly', game: 'any', metric: 'played', target: 18, title: 'Weekly table regular', blurb: 'Finish 18 games of any kind.' },
        { id: 'any-won-weekly', period: 'weekly', game: 'any', metric: 'won', target: 12, title: 'Weekly champion', blurb: 'Win 12 games of any kind.' },
        { id: 'any-distinct-weekly', period: 'weekly', game: 'any', metric: 'distinct-games', target: 3, title: 'Weekly variety', blurb: 'Play 3 different games.' }
    ];

    const nextQuestTemplates: QuestTemplate[] = [];
    for (const game of AVAILABLE_GAMES)
    {
        const metrics = [
            'played',
            'won',
            'played-with-friend',
            'tournament-played',
            ...TALLY_METRICS[game]
        ] as const;

        for (const metric of metrics)
        {
            const target = metric === 'played' ? 4 : metric === 'won' ? 3 : metric === 'played-with-friend' ? 2 : metric === 'tournament-played' ? 1 : 5;
            nextQuestTemplates.push({
                id: `${ game }-${ typeof metric === 'string' ? metric : metric.tally }-daily`,
                period: 'daily',
                game,
                metric,
                target,
                title: `${ game } daily`,
                blurb: `${ game } reward quest.`
            });
        }

        const weeklyMetrics = ['played', 'won', 'distinct-games', ...TALLY_METRICS[game].slice(0, 2)] as const;
        for (const metric of weeklyMetrics)
        {
            const target = metric === 'played' ? 12 : metric === 'won' ? 9 : metric === 'distinct-games' ? 3 : 10;
            nextQuestTemplates.push({
                id: `${ game }-${ typeof metric === 'string' ? metric : metric.tally }-weekly`,
                period: 'weekly',
                game,
                metric,
                target,
                title: `${ game } weekly`,
                blurb: `${ game } weekly reward quest.`
            });
        }
    }

    return [...daily, ...weekly, ...nextQuestTemplates];
};

export const QUEST_TEMPLATES = makeTemplates();

const chooseAny = (cycleIndex: number, dayOrWeek: number, period: 'daily' | 'weekly'): QuestTemplate =>
{
    const list = QUEST_TEMPLATES.filter((quest) => quest.period === period && quest.game === 'any');
    return list[(cycleIndex + dayOrWeek) % list.length];
};

const selectSpecific = (cycleIndex: number, dayOrWeek: number, period: 'daily' | 'weekly', index: number): QuestTemplate =>
{
    const games = [...AVAILABLE_GAMES];
    const offset = (cycleIndex + dayOrWeek + index) % games.length;
    const rotated = [...games.slice(offset), ...games.slice(0, offset)];
    const game = rotated[index % rotated.length];
    const list = QUEST_TEMPLATES.filter((quest) => quest.period === period && quest.game === game);
    return list[(cycleIndex + dayOrWeek + index) % list.length];
};

/**
 * Deterministic rotation: one any-game quest and two game-specific quests, with the sprites rotated so the
 * same game does not sit in the same slot on consecutive days or weeks.
 */
export const questsFor = (cycleIndex: number, dayOrWeek: number, period: 'daily' | 'weekly'): QuestTemplate[] =>
{
    const gameOne = selectSpecific(cycleIndex, dayOrWeek, period, 0);
    const gameTwo = selectSpecific(cycleIndex, dayOrWeek, period, 2);
    const anyQuest = chooseAny(cycleIndex, dayOrWeek, period);

    const chosen = [gameOne, gameTwo, anyQuest];
    if (chosen[0].game === chosen[1].game)
    {
        const replacement = selectSpecific(cycleIndex, dayOrWeek, period, 3);
        chosen[1] = replacement;
    }

    return chosen.filter((quest, index, list) => list.findIndex((one) => one.id === quest.id) === index);
};
