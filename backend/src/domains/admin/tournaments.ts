import type { DataSource, EntityManager } from 'typeorm';

import { User } from '../../entities/index.ts';
import type { Tournament } from '../../entities/tournament.entity.ts';
import type { TournamentService } from '../tournament/service.ts';
import { STAFF_OF } from './play.ts';
import { outranks, type StaffRole } from './roles.ts';
import { record, staffRefusal, type Actor } from './staff.ts';

/** How far the staff may move a start: from a minute ahead, so it is not already due, to a month. */
const SOONEST_MS = 60_000;

const LATEST_MS = 30 * 24 * 60 * 60_000;

/** What a line in the log says was done; the log keeps one kind for all of it. */
export type TournamentDid = 'cancel' | 'start' | 'time' | 'remove' | 'feature' | 'unfeature' | 'hide' | 'show';

interface Named
{
    id: string;
    handle: string;
    staff: StaffRole | null;
}

const stillOn = (tournament: Tournament) =>
{
    if (tournament.status !== 'open' && tournament.status !== 'running')
    {
        throw staffRefusal('staff-tournament-over', 'That tournament is over.');
    }
};

const notBegun = (tournament: Tournament) =>
{
    stillOn(tournament);

    if (tournament.status !== 'open')
    {
        throw staffRefusal('staff-tournament-started', 'That tournament has already started.');
    }
};

export function createTournamentStaff(db: DataSource, tournaments: TournamentService, owners: () => readonly string[])
{
    const noted = (tx: EntityManager, actor: Actor, tournament: Tournament, did: TournamentDid, reason: string, more: Record<string, string> = {}, person?: { id: string; handle: string }) =>
        record(tx, actor, {
            kind: 'tournament',
            reason,
            ...(person === undefined ? {} : { person }),
            details: { did, id: tournament.id, code: tournament.code, name: tournament.name, game: tournament.game, ...more }
        });

    const act = <T>(code: string, work: (tx: EntityManager, tournament: Tournament) => Promise<T>) =>
        db.transaction(async (tx) => await work(tx, await tournaments.staff.lock(tx, code)));

    return {
        cancel: (actor: Actor, code: string, reason: string) => act(code, async (tx, tournament) =>
        {
            stillOn(tournament);

            const done = await tournaments.staff.halt(tx, tournament);

            await noted(tx, actor, tournament, 'cancel', reason);

            return done;
        }),

        start: (actor: Actor, code: string, reason: string) => act(code, async (tx, tournament) =>
        {
            notBegun(tournament);

            const done = await tournaments.staff.startNow(tx, tournament);

            if (done === 'few')
            {
                throw staffRefusal('staff-tournament-few', 'Too few players have a place to start it.');
            }

            await noted(tx, actor, tournament, 'start', reason);

            return done;
        }),

        move: (actor: Actor, code: string, startsAt: string, reason: string) => act(code, async (tx, tournament) =>
        {
            notBegun(tournament);

            const at = new Date(startsAt);
            const ahead = at.getTime() - Date.now();

            if (Number.isNaN(ahead) || ahead < SOONEST_MS || ahead > LATEST_MS)
            {
                throw staffRefusal('staff-tournament-time', 'Pick a start between a minute and thirty days from now.');
            }

            await tournaments.staff.moveStart(tx, tournament, at);
            await noted(tx, actor, tournament, 'time', reason, { from: tournament.startsAt.toISOString(), to: at.toISOString() });
        }),

        feature: (actor: Actor, code: string, on: boolean, reason: string) => act(code, async (tx, tournament) =>
        {
            await tournaments.staff.feature(tx, tournament, on);
            await noted(tx, actor, tournament, on ? 'feature' : 'unfeature', reason);
        }),

        hide: (actor: Actor, code: string, hidden: boolean, reason: string) => act(code, async (tx, tournament) =>
        {
            await tournaments.staff.hide(tx, tournament, hidden);
            await noted(tx, actor, tournament, hidden ? 'hide' : 'show', reason);
        }),

        /** Answers the tournament and the match of the game they were in, for the caller to end once this is written. */
        remove: (actor: Actor, code: string, handle: string, reason: string) => act(code, async (tx, tournament) =>
        {
            stillOn(tournament);

            const person = await tx.getRepository(User).createQueryBuilder('u')
                .select('u.id', 'id')
                .addSelect('u.handle::text', 'handle')
                .addSelect(STAFF_OF, 'staff')
                .where('u.handle = :handle', { handle: handle.trim().replace(/^@/, ''), owners: owners() })
                .getRawOne<Named>();

            if (person === undefined)
            {
                throw staffRefusal('staff-tournament-player', 'Nobody by that name has a place in it.');
            }

            if (person.id !== actor.id && person.staff !== null && !outranks(actor.role, person.staff))
            {
                throw staffRefusal('staff-rank', 'That is above what your role may do.');
            }

            const out = await tournaments.staff.remove(tx, tournament, person.id);

            if (out === 'none')
            {
                throw staffRefusal('staff-tournament-player', 'Nobody by that name has a place in it.');
            }

            await noted(tx, actor, tournament, 'remove', reason, { stage: tournament.status }, { id: person.id, handle: person.handle });

            return { id: tournament.id, match: out.match };
        })
    };
}
