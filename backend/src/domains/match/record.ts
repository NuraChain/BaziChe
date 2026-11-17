import { In, IsNull, type EntityManager } from 'typeorm';

import { Match, MatchAction, MatchPlayer, PlayerStats } from '../../entities/index.ts';
import type { AchieveService } from '../achieve/service.ts';
import type { QuestProgressHook, RewardFinishEffects, RewardFinishPlayer } from '../reward/progress.ts';
import type { GameId } from '../reward/quests.ts';
import { isSystem } from '../system/sql.ts';
import type { Ending, Engine } from './engine.ts';
import { movesOf, planOf, type Verdict } from './judge.ts';
import { XP_FINISH, xpFor } from './levels.ts';
import { START } from './rating.ts';

interface Ledger
{
    seat: number;
    own: number;
    exit: number | null;
    walked: boolean;
    last: number;
}

const summed = (column: string, param: string) => `(select coalesce(jsonb_object_agg(counter, coalesce((${ column } ->> counter)::numeric, 0) + coalesce((cast(:${ param } as jsonb) ->> counter)::numeric, 0)), '{}'::jsonb)
                   from jsonb_object_keys(${ column } || cast(:${ param } as jsonb)) as counter)`;

const ledgerOf = (tx: EntityManager, matchId: string, verbs: readonly string[]) =>
    tx.getRepository(MatchAction)
        .createQueryBuilder('a')
        .select('a.seat', 'seat')
        .addSelect(`(count(*) filter (where a.kind = 'play' and a.user_id is not null and a.payload ->> 'verb' in (:...verbs)))::int`, 'own')
        .addSelect(`min(a.rev) filter (where a.kind = 'forfeit')`, 'exit')
        .addSelect(`coalesce(bool_or(a.kind = 'forfeit' and a.user_id is not null), false)`, 'walked')
        .addSelect('max(a.rev)', 'last')
        .where('a.match_id = :matchId', { matchId, verbs: [...verbs] })
        .groupBy('a.seat')
        .getRawMany<Ledger>();

const eventsOf = async (tx: EntityManager, matchId: string): Promise<unknown[]> =>
{
    const rows = await tx.getRepository(MatchAction).find({
        select: { events: true },
        where: { matchId }
    });

    return rows.flatMap((row) => (row.events ?? []) as unknown[]);
};

/** The seats of a match held by system players: one query per finish. */
const systemSeatsOf = async (tx: EntityManager, matchId: string): Promise<Set<string>> =>
{
    const rows = await tx.query(
        `select mp.user_id from match_players mp where mp.match_id = $1 and ${isSystem('mp.user_id')}`,
        [matchId]
    ) as { user_id: string }[];

    return new Set(rows.map((row) => row.user_id));
};

/** A win that was not credited (the others walked out) is not a game played. */
export const playedOf = (verdict: Pick<Verdict, 'result' | 'credit'>) => (verdict.result === 'won' && !verdict.credit ? 0 : 1);

/**
 * What a seat adds to `system_played`, `system_won` and `system_xp`: everything it earned, when the
 * match had a system seat and the seat is a person's. A system player's own row never needs the
 * split, because no board ever shows it.
 */
export const apartOf = (match: { system: boolean; mine: boolean }, earned: { played: number; won: number; xp: number }) =>
    match.system && !match.mine ? { played: earned.played, won: earned.won, xp: earned.xp } : { played: 0, won: 0, xp: 0 };

/** What a seat adds to `system_tallies`, on the same terms as `apartOf`. */
export const talliesApartOf = (match: { system: boolean; mine: boolean }, tally: Readonly<Record<string, number>>): Record<string, number> =>
    (match.system && !match.mine ? { ...tally } : {});

/**
 * The players a finished match reports to the quests: nobody when any seat was a system player.
 * Leaving out only the system opponents is not enough: in a team game a person's partner is in
 * `opponentIds` too, so two people could earn quests together against summoned opponents.
 */
export const questPlayersOf = <Player>(players: readonly Player[], system: ReadonlySet<string>): Player[] =>
    (system.size > 0 ? [] : [...players]);

/**
 * A person's win streak after a match. One with a system seat neither adds nor resets it, so a best
 * streak can never be built against opponents summoned at will; a system player's own moves as usual.
 */
export const streakOf = (held: number, move: Verdict['streak'], match: { system: boolean; mine: boolean }) =>
    (match.system && !match.mine ? held : { add: held + 1, reset: 0, keep: held }[move]);

export interface Recorder
{
    finish(tx: EntityManager, match: Match, engine: Engine, state: unknown, ending: Ending): Promise<RewardFinishEffects>;
}

export function createRecorder(achieve: AchieveService, reward?: QuestProgressHook): Recorder
{
    return {
        async finish(tx, match, engine, state, ending)
        {
            let effects: RewardFinishEffects = { changed: [], ready: [] };
            const game = engine.id as GameId;
            const matchId = match.id;
            const format = { seats: match.seats, variant: match.variant };
            const players = await tx.getRepository(MatchPlayer).find({ where: { matchId }, order: { userId: 'ASC' } });
            const engagement = engine.engagement(format);
            const ledger = await ledgerOf(tx, matchId, engagement.verbs);
            const places = engine.standings(state);
            const last = Math.max(0, ...ledger.map((row) => row.last));
            const system = await systemSeatsOf(tx, matchId);

            const plan = planOf({
                seats: players.map((player) =>
                {
                    const row = ledger.find((one) => one.seat === player.seat);

                    return {
                        seat: player.seat,
                        side: engine.sideOf(player.seat, format),
                        place: places.find((one) => one.seat === player.seat)?.place ?? players.length,
                        quitter: row === undefined || row.exit === null ? null : { walked: row.walked, rev: row.exit },
                        own: row?.own ?? 0,
                        unsettled: ending.unsettled.includes(player.seat),
                        trailing: ending.trailing.includes(player.seat)
                    };
                }),
                after: engagement.after,
                winners: ending.winners,
                forfeited: ledger.some((row) => row.exit === last)
            });

            await tx.getRepository(Match).update(
                { id: matchId, finishedAt: IsNull() },
                { finishedAt: () => 'now()', deadlineAt: null, outcome: plan.outcome, winnerSeat: plan.winnerSeat }
            );

            const verdictOf = (seat: number) => plan.verdicts.find((one) => one.seat === seat);
            const counted = players.filter((player) => verdictOf(player.seat)?.result !== 'void');
            const uncounted = players.filter((player) => verdictOf(player.seat)?.result === 'void');
            const stats = tx.getRepository(PlayerStats);

            if (counted.length > 0)
            {
                await stats.createQueryBuilder()
                    .insert()
                    .values(counted.map((player) => ({ userId: player.userId, game })))
                    .orIgnore()
                    .execute();
            }

            const locked = counted.length === 0
                ? []
                : await stats.createQueryBuilder('s')
                    .where('s.game = :game and s.user_id in (:...ids)', { game, ids: counted.map((player) => player.userId) })
                    .orderBy('s.user_id')
                    .setLock('pessimistic_write')
                    .getMany();

            const resting = uncounted.length === 0
                ? []
                : await stats.find({ where: { game, userId: In(uncounted.map((player) => player.userId)) } });

            const rowOf = (userId: string) => [...locked, ...resting].find((row) => row.userId === userId);
            const moves = movesOf(plan, new Map(players.map((player) => [player.seat, rowOf(player.userId)?.rating ?? START])), system.size > 0);
            const bySeat = engine.tally(await eventsOf(tx, matchId));

            for (const player of players)
            {
                const verdict = verdictOf(player.seat);

                if (verdict === undefined)
                {
                    continue;
                }

                const move = moves.find((one) => one.seat === player.seat);
                const tally = bySeat.get(player.seat) ?? {};
                const earned = verdict.paid === 'full'
                    ? xpFor({ won: verdict.credit, bonus: engine.points(tally) })
                    : (verdict.paid === 'finish' ? XP_FINISH : 0);

                await tx.getRepository(MatchPlayer).update(
                    { matchId, seat: player.seat },
                    move === undefined
                        ? { result: verdict.result, xp: earned }
                        : { result: verdict.result, xp: earned, ratingBefore: move.before, ratingAfter: move.after }
                );

                if (verdict.result === 'void')
                {
                    continue;
                }

                const held = rowOf(player.userId);
                const after = move?.after ?? held?.rating ?? START;
                const seated = { system: system.size > 0, mine: system.has(player.userId) };
                const streak = streakOf(held?.streak ?? 0, verdict.streak, seated);
                const played = playedOf(verdict);
                const won = verdict.credit ? 1 : 0;
                const apart = apartOf(seated, { played, won, xp: earned });

                await stats.createQueryBuilder()
                    .update(PlayerStats)
                    .set({
                        rating: after,
                        peakRating: () => 'greatest(peak_rating, :after)',
                        played: () => 'played + :played',
                        won: () => 'won + :won',
                        drawn: () => 'drawn + :drawn',
                        abandoned: () => 'abandoned + :quit',
                        streak,
                        bestStreak: () => 'greatest(best_streak, :streak)',
                        tallies: () => summed('tallies', 'tallies'),
                        systemTallies: () => summed('system_tallies', 'systemTallies'),
                        xp: () => 'xp + :xp',
                        systemPlayed: () => 'system_played + :systemPlayed',
                        systemWon: () => 'system_won + :systemWon',
                        systemXp: () => 'system_xp + :systemXp'
                    })
                    .where('user_id = :userId and game = :game')
                    .setParameters({
                        after,
                        played,
                        won,
                        drawn: verdict.result === 'drawn' ? 1 : 0,
                        quit: verdict.result === 'abandoned' ? 1 : 0,
                        streak,
                        tallies: JSON.stringify(tally),
                        xp: earned,
                        systemPlayed: apart.played,
                        systemWon: apart.won,
                        systemXp: apart.xp,
                        systemTallies: JSON.stringify(talliesApartOf(seated, tally)),
                        userId: player.userId,
                        game
                    })
                    .execute();
            }

            for (const player of counted)
            {
                await achieve.record(tx, player.userId, matchId, game);
            }

            if (reward?.onFinish !== undefined)
            {
                const rewardPlayers: RewardFinishPlayer[] = questPlayersOf(counted.flatMap((player): RewardFinishPlayer[] =>
                {
                    const verdict = verdictOf(player.seat);

                    return verdict === undefined ? [] : [{
                        userId: player.userId,
                        seat: player.seat,
                        result: verdict.result,
                        credit: verdict.credit,
                        ownTurns: ledger.find((row) => row.seat === player.seat)?.own ?? 0,
                        tally: bySeat.get(player.seat) ?? {},
                        opponentIds: [...new Set(players.filter((other) => other.userId !== player.userId).map((other) => other.userId))]
                    }];
                }), system);

                effects = await reward.onFinish(tx, match, game, rewardPlayers);
            }

            return effects;
        }
    };
}
