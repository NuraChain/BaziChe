import { allDecided, blankGame, type Format, type Game, type Standing } from './game.ts';

const MAX_SEATS = 6;

function drawRound(seeds: number[], round: number): Game[]
{
    const count = Math.ceil(seeds.length / MAX_SEATS);
    const base = Math.floor(seeds.length / count);
    const extra = seeds.length % count;
    let offset = 0;

    return Array.from({ length: count }, (_, slot) =>
    {
        const group = seeds.slice(offset, offset + base + Number(slot < extra));
        offset += group.length;

        return { ...blankGame('shootout', round, slot), poker: { seeds: group, lineup: group } };
    });
}

/** A void or abandoned table has no qualifier. A single attendee may advance by walkover. */
export function pokerResult(game: Game, winnerSeat: number | null, absent: ReadonlySet<number>): Game
{
    const seed = winnerSeat === null ? undefined : game.poker?.lineup[winnerSeat];
    const winner = seed !== undefined && !absent.has(seed) ? seed : null;

    return { ...game, winner, how: winner === null ? 'void' : 'played' };
}

export const pokerWalkover = (game: Game, eligible: number[]): Game => ({
    ...game,
    winner: eligible[0] ?? null,
    how: eligible.length === 0 ? 'void' : 'bye'
});

export const shootout: Format = {
    id: 'shootout',
    sizes: [4, 6, 8, 12, 16, 24, 32, 36, 64, 128],
    roundsFor(entrants)
    {
        let rounds = 1;

        while (entrants > MAX_SEATS)
        {
            entrants = Math.ceil(entrants / MAX_SEATS);
            rounds += 1;
        }

        return rounds;
    },
    start: ({ entrants }) => drawRound(Array.from({ length: entrants }, (_, i) => i + 1), 1),
    advance(games)
    {
        if (!allDecided(games))
        {
            return [...games];
        }

        const round = Math.max(...games.map((game) => game.round));
        const winners = games.filter((game) => game.round === round && game.winner !== null)
            .sort((one, other) => one.slot - other.slot).map((game) => game.winner as number);

        return winners.length > 1 ? [...games, ...drawRound(winners, round + 1)] : [...games];
    },
    standings(games, { entrants })
    {
        const rows: Standing[] = Array.from({ length: entrants }, (_, i) => ({
            seed: i + 1, place: null, played: 0, wins: 0, losses: 0, draws: 0, diff: 0, points: 0
        }));
        const lastRound = Math.max(...games.map((game) => game.round));
        const latest = games.filter((game) => game.round === lastRound);
        const finalists = latest.filter((game) => game.winner !== null);
        const champion = allDecided(games) && finalists.length === 1 ? finalists[0].winner : null;

        for (const game of games)
        {
            if (game.how === null || game.poker === undefined)
            {
                continue;
            }

            const tables = games.filter((other) => other.round === game.round);
            const qualifiers = tables.filter((other) => other.how === null || other.winner !== null).length;

            for (const seed of game.poker.seeds)
            {
                const row = rows[seed - 1];
                if (game.how === 'played' && game.poker.lineup.includes(seed))
                {
                    row.played += 1;
                    row.wins += Number(seed === game.winner);
                    row.losses += Number(seed !== game.winner);
                }

                if (seed !== game.winner)
                {
                    row.place = 1 + Math.max(1, qualifiers);
                }
            }
        }

        if (champion !== null)
        {
            rows[champion - 1].place = 1;
        }

        return rows.sort((one, other) => (one.place ?? 0) - (other.place ?? 0) || one.seed - other.seed);
    },
    tables: () => []
};
