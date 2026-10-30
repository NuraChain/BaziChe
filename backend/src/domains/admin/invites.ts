import type { DataSource, EntityManager, ObjectLiteral, SelectQueryBuilder } from 'typeorm';

import { EquippedItem, InviteCampaign, InviteReward, InviteVisit, OwnedItem, Referral, User } from '../../entities/index.ts';
import { cursorOf, keyOf, keysetAfter, olderThan, type Keyed } from '../../lib/keyset.ts';
import type { AdminInviteCampaign, AdminInviteCampaigns, AdminInviteRewards, AdminInvites, AdminPersonInvites } from '../../schemas.ts';
import type { CampaignState, InviteFlag, Milestone, RewardKind, RewardState } from '../invite/policy.ts';
import { RUNNING, ownReward } from '../invite/service.ts';
import { lookOf } from '../shop/catalogue.ts';
import { face } from './reports.ts';
import { INVITE_DAYS, INVITE_TOP, INVITES_PAGE, type CampaignMove, type GrantedRole, type RewardList, type RewardMove } from './roles.ts';
import { record, staffRefusal, type Actor } from './staff.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A campaign as the staff write it: what it gives, to how many at most, whether every reward waits, and when it runs. */
export interface CampaignInput
{
    name: string;
    inviterItem?: string;
    inviteeItem?: string;
    milestones: Milestone[];
    most?: number;
    review: boolean;
    startsAt?: string;
    endsAt?: string;
}

/** What a campaign gives: once it has written a reward these stay as they were. */
const GIVES = ['inviterItem', 'inviteeItem', 'milestones'];

/** Today by UTC, as a visit is kept by its day. */
const TODAY = `(now() at time zone 'utc')::date`;

/** The days each window of the overview begins on: today, the last seven days, and all. */
const DAYS = { today: TODAY, week: `(${ TODAY } - 6)`, all: null };

const begun = (day: string) => `(${ day }::timestamp at time zone 'utc')`;

/** The moment each window begins, for a column that keeps a time. */
const MOMENTS = { today: begun(TODAY), week: begun(DAYS.week), all: null };

type Windowed = Record<string, number>;

interface Faced
{
    p_handle: string;
    p_name: string;
    p_hue: number;
    p_avatar: string | null;
    p_staff: GrantedRole | null;
    p_owner: boolean;
}

interface CampaignRow extends Keyed
{
    name: string;
    state: CampaignState;
    inviter_item: string | null;
    invitee_item: string | null;
    milestones: Milestone[];
    most: number | null;
    review: boolean;
    starts_at: Date | null;
    ends_at: Date | null;
    created_at: Date;
    author: string | null;
    running: boolean;
    gave: boolean;
    joined: number;
    played: number;
    given: number;
    waiting: number;
    refused: number;
    taken: number;
}

interface RewardRow extends Keyed, Faced
{
    kind: RewardKind;
    milestone: number | null;
    item_id: string;
    state: RewardState;
    delivered: boolean | null;
    created_at: Date;
    decided_at: Date | null;
    decider: string | null;
    reason: string | null;
    campaign_id: string;
    campaign_name: string;
    flags: InviteFlag[] | null;
    suspended: boolean;
    f_handle: string | null;
    f_name: string | null;
    f_hue: number | null;
    f_avatar: string | null;
    f_staff: GrantedRole | null;
    f_owner: boolean;
}

/** Who invited somebody, read beside their invite: nobody's face where the inviter's account is gone. */
interface ByRow
{
    code: string | null;
    created_at: Date;
    counted_at: Date | null;
    flags: InviteFlag[] | null;
    campaign_id: string | null;
    campaign_name: string | null;
    p_handle: string | null;
    p_name: string | null;
    p_hue: number | null;
    p_avatar: string | null;
    p_staff: GrantedRole | null;
    p_owner: boolean;
}

interface TopRow extends Faced
{
    joined: number;
    played: number;
    flagged: number;
}

/** The face of the person `alias` names, and their role on the staff: the owner by the wallets the server shows. */
const faced = <T extends ObjectLiteral>(query: SelectQueryBuilder<T>, alias: string) => query
    .addSelect(`${ alias }.handle`, `${ alias }_handle`)
    .addSelect(`${ alias }.display_name`, `${ alias }_name`)
    .addSelect(`${ alias }.hue`, `${ alias }_hue`)
    .addSelect(`${ alias }.avatar`, `${ alias }_avatar`)
    .addSelect(`(select m.role from staff_members m where m.user_id = ${ alias }.id)`, `${ alias }_staff`)
    .addSelect(`exists (select 1 from wallets o where o.user_id = ${ alias }.id and o.address = any(:owners))`, `${ alias }_owner`);

/** How many rows `when` holds in each window, by the time or day in `at`. */
const tally = <T extends ObjectLiteral>(query: SelectQueryBuilder<T>, name: string, at: string, starts: Record<string, string | null>, when = 'true') =>
{
    for (const [window, start] of Object.entries(starts))
    {
        query.addSelect(`(count(*) filter (where ${ when }${ start === null ? '' : ` and ${ at } >= ${ start }` }))::int`, `${ name }_${ window }`);
    }
};

const inWindow = (visits: Windowed, friends: Windowed, rewards: Windowed, window: string) => ({
    visits: visits[`visits_${ window }`],
    joined: friends[`joined_${ window }`],
    played: friends[`played_${ window }`],
    flagged: friends[`flagged_${ window }`],
    given: rewards[`given_${ window }`],
    review: rewards[`review_${ window }`],
    refused: rewards[`refused_${ window }`],
    taken: rewards[`taken_${ window }`]
});

/** The day `back` days before `day`, both as a date reads. */
const dayBefore = (day: string, back: number) => new Date(Date.parse(`${ day }T00:00:00Z`) - back * 86_400_000).toISOString().slice(0, 10);

/** A time the wire carries: none, the moment it names, or undefined for words that name none. */
const timeOf = (text: string | undefined) =>
{
    if (text === undefined)
    {
        return null;
    }

    const at = Date.parse(text);

    return Number.isNaN(at) ? undefined : new Date(at);
};

/** A campaign's input once read: every look one the shop sells, the milestones by their number of friends, and a window that ends after it begins. */
const shapeOf = (input: CampaignInput) =>
{
    const looks = [input.inviterItem, input.inviteeItem, ...input.milestones.map((one) => one.item)].filter((item) => item !== undefined);

    if (looks.length === 0)
    {
        throw staffRefusal('staff-campaign-empty', 'A campaign has to give a look.');
    }

    if (looks.some((item) => lookOf(item) === undefined))
    {
        throw staffRefusal('staff-campaign-look', 'The shop sells no such look.');
    }

    const milestones = input.milestones.map(({ count, item }) => ({ count, item })).sort((left, right) => left.count - right.count);

    if (milestones.some((one, at) => at > 0 && one.count === milestones[at - 1].count))
    {
        throw staffRefusal('staff-campaign-milestone', 'Two milestones ask for the same number of friends.');
    }

    const startsAt = timeOf(input.startsAt);
    const endsAt = timeOf(input.endsAt);

    if (startsAt === undefined || endsAt === undefined || (startsAt !== null && endsAt !== null && endsAt <= startsAt))
    {
        throw staffRefusal('staff-campaign-window', 'A campaign ends after it begins.');
    }

    return {
        name: input.name,
        inviterItem: input.inviterItem ?? null,
        inviteeItem: input.inviteeItem ?? null,
        milestones,
        most: input.most ?? null,
        review: input.review,
        startsAt,
        endsAt
    };
};

type Shaped = ReturnType<typeof shapeOf>;

const stepsOf = (milestones: readonly Milestone[]) => milestones.map((one) => `${ one.count } ${ one.item }`).join(',');

/** The fields a change would move. */
const changedIn = (was: InviteCampaign, now: Shaped) => Object.entries({
    name: was.name === now.name,
    inviterItem: was.inviterItem === now.inviterItem,
    inviteeItem: was.inviteeItem === now.inviteeItem,
    milestones: stepsOf(was.milestones) === stepsOf(now.milestones),
    most: was.most === now.most,
    review: was.review === now.review,
    startsAt: (was.startsAt?.getTime() ?? null) === (now.startsAt?.getTime() ?? null),
    endsAt: (was.endsAt?.getTime() ?? null) === (now.endsAt?.getTime() ?? null)
}).filter(([, kept]) => !kept).map(([field]) => field);

const campaignWire = (row: CampaignRow) => ({
    id: row.id,
    name: row.name,
    state: row.state,
    ...(row.inviter_item === null ? {} : { inviterItem: row.inviter_item }),
    ...(row.invitee_item === null ? {} : { inviteeItem: row.invitee_item }),
    milestones: row.milestones,
    ...(row.most === null ? {} : { most: row.most }),
    review: row.review,
    ...(row.starts_at === null ? {} : { startsAt: row.starts_at.toISOString() }),
    ...(row.ends_at === null ? {} : { endsAt: row.ends_at.toISOString() }),
    at: row.created_at.toISOString(),
    ...(row.author === null ? {} : { by: row.author }),
    running: row.running,
    gave: row.gave,
    joined: row.joined,
    played: row.played,
    given: row.given,
    waiting: row.waiting,
    refused: row.refused,
    taken: row.taken
});

const rewardWire = (row: RewardRow) => ({
    id: row.id,
    kind: row.kind,
    ...(row.milestone === null ? {} : { milestone: row.milestone }),
    item: row.item_id,
    state: row.state,
    ...(row.delivered === null ? {} : { delivered: row.delivered }),
    at: row.created_at.toISOString(),
    ...(row.decided_at === null ? {} : { decidedAt: row.decided_at.toISOString() }),
    ...(row.decider === null ? {} : { decidedBy: row.decider }),
    ...(row.reason === null ? {} : { reason: row.reason }),
    campaign: { id: row.campaign_id, name: row.campaign_name },
    ...(row.flags === null ? {} : { flags: row.flags }),
    person: { ...face(row.p_handle, row.p_name, row.p_hue, row.p_avatar, row.p_staff, row.p_owner), suspended: row.suspended },
    ...(row.f_handle === null || row.f_name === null || row.f_hue === null ? {} : { friend: face(row.f_handle, row.f_name, row.f_hue, row.f_avatar, row.f_staff, row.f_owner) })
});

const byWire = (row: ByRow) => ({
    ...(row.p_handle === null || row.p_name === null || row.p_hue === null ? {} : { person: face(row.p_handle, row.p_name, row.p_hue, row.p_avatar, row.p_staff, row.p_owner) }),
    ...(row.code === null ? {} : { code: row.code }),
    at: row.created_at.toISOString(),
    ...(row.counted_at === null ? {} : { countedAt: row.counted_at.toISOString() }),
    ...(row.flags === null ? {} : { flags: row.flags }),
    ...(row.campaign_id === null || row.campaign_name === null ? {} : { campaign: { id: row.campaign_id, name: row.campaign_name } })
});

export function createInviteAdmin(db: DataSource, owners: () => readonly string[])
{
    const campaignsFrom = (manager: EntityManager) => manager.getRepository(InviteCampaign).createQueryBuilder('campaign')
        .leftJoin(User, 'author', 'author.id = campaign.created_by')
        .select('campaign.id', 'id')
        .addSelect(keyOf('campaign.created_at'), 'at_key')
        .addSelect('campaign.name', 'name')
        .addSelect('campaign.state', 'state')
        .addSelect('campaign.inviter_item', 'inviter_item')
        .addSelect('campaign.invitee_item', 'invitee_item')
        .addSelect('campaign.milestones', 'milestones')
        .addSelect('campaign.most', 'most')
        .addSelect('campaign.review', 'review')
        .addSelect('campaign.starts_at', 'starts_at')
        .addSelect('campaign.ends_at', 'ends_at')
        .addSelect('campaign.created_at', 'created_at')
        .addSelect('author.handle', 'author')
        .addSelect(`(${ RUNNING })`, 'running')
        .addSelect('exists (select 1 from invite_rewards w where w.campaign_id = campaign.id)', 'gave')
        .addSelect('(select count(*) from referrals r where r.campaign_id = campaign.id)::int', 'joined')
        .addSelect('(select count(*) from referrals r where r.campaign_id = campaign.id and r.counted_at is not null)::int', 'played')
        .addSelect(`(select count(*) from invite_rewards w where w.campaign_id = campaign.id and w.state = 'given')::int`, 'given')
        .addSelect(`(select count(*) from invite_rewards w where w.campaign_id = campaign.id and w.state = 'review')::int`, 'waiting')
        .addSelect(`(select count(*) from invite_rewards w where w.campaign_id = campaign.id and w.state = 'refused')::int`, 'refused')
        .addSelect(`(select count(*) from invite_rewards w where w.campaign_id = campaign.id and w.state = 'taken')::int`, 'taken');

    const campaignOf = async (manager: EntityManager, id: string) =>
    {
        const row = await campaignsFrom(manager).where('campaign.id = :campaign', { campaign: id }).getRawOne<CampaignRow>();

        return row === undefined ? null : campaignWire(row);
    };

    const rewardsFrom = (manager: EntityManager) =>
    {
        const query = manager.getRepository(InviteReward).createQueryBuilder('w')
            .innerJoin(User, 'p', 'p.id = w.user_id')
            .innerJoin(InviteCampaign, 'c', 'c.id = w.campaign_id')
            .leftJoin(Referral, 'ref', 'ref.invitee_id = w.invitee_id')
            .leftJoin(User, 'f', `f.id = case w.kind when 'inviter' then w.invitee_id when 'invitee' then ref.inviter_id end`)
            .leftJoin(User, 'd', 'd.id = w.decided_by')
            .select('w.id', 'id')
            .addSelect(keyOf('w.created_at'), 'at_key')
            .addSelect('w.kind', 'kind')
            .addSelect('w.milestone', 'milestone')
            .addSelect('w.item_id', 'item_id')
            .addSelect('w.state', 'state')
            .addSelect('w.delivered', 'delivered')
            .addSelect('w.created_at', 'created_at')
            .addSelect('w.decided_at', 'decided_at')
            .addSelect('d.handle', 'decider')
            .addSelect('w.reason', 'reason')
            .addSelect('c.id', 'campaign_id')
            .addSelect('c.name', 'campaign_name')
            .addSelect('ref.flags', 'flags')
            .addSelect('p.is_suspended', 'suspended');

        return faced(faced(query, 'p'), 'f').setParameter('owners', owners());
    };

    const rewardOf = async (manager: EntityManager, id: string) =>
    {
        const row = await rewardsFrom(manager).where('w.id = :reward', { reward: id }).getRawOne<RewardRow>();

        return row === undefined ? null : rewardWire(row);
    };

    const waiting = async () => await db.getRepository(InviteReward).countBy({ state: 'review' });

    return {
        waiting,

        /**
         * What inviting friends came to, counted by UTC days as a visit is kept: today, the last seven
         * days and all, the last fourteen days one by one, the inviters whose friends played most, the
         * campaign running, and the rewards waiting for the staff.
         */
        async overview(): Promise<AdminInvites>
        {
            const opening = db.getRepository(InviteVisit).createQueryBuilder('v').select(`${ TODAY }::text`, 'day');
            const joining = db.getRepository(Referral).createQueryBuilder('r').select('count(*)::int', 'total');
            const rewarding = db.getRepository(InviteReward).createQueryBuilder('w').select('count(*)::int', 'total');

            tally(opening, 'visits', 'v.day', DAYS);
            tally(joining, 'joined', 'r.created_at', MOMENTS);
            tally(joining, 'played', 'r.counted_at', MOMENTS, 'r.counted_at is not null');
            tally(joining, 'flagged', 'r.counted_at', MOMENTS, 'r.flags is not null');

            for (const state of ['given', 'review', 'refused', 'taken'] as const)
            {
                tally(rewarding, state, 'w.created_at', MOMENTS, `w.state = '${ state }'`);
            }

            const visits = (await opening.getRawOne<Windowed & { day: string }>())!;
            const friends = (await joining.getRawOne<Windowed>())!;
            const rewards = (await rewarding.getRawOne<Windowed>())!;
            const today = visits.day;
            const first = dayBefore(today, INVITE_DAYS - 1);
            const opened = await db.getRepository(InviteVisit).createQueryBuilder('v')
                .select('v.day::text', 'day')
                .addSelect('count(*)::int', 'count')
                .where('v.day >= :first', { first })
                .groupBy('v.day')
                .getRawMany<{ day: string; count: number }>();
            const joinedOn = await db.getRepository(Referral).createQueryBuilder('r')
                .select(`((r.created_at at time zone 'utc')::date)::text`, 'day')
                .addSelect('count(*)::int', 'count')
                .where(`r.created_at >= (cast(:first as date)::timestamp at time zone 'utc')`, { first })
                .groupBy(`(r.created_at at time zone 'utc')::date`)
                .getRawMany<{ day: string; count: number }>();
            const playedOn = await db.getRepository(Referral).createQueryBuilder('r')
                .select(`((r.counted_at at time zone 'utc')::date)::text`, 'day')
                .addSelect('count(*)::int', 'count')
                .where(`r.counted_at >= (cast(:first as date)::timestamp at time zone 'utc')`, { first })
                .groupBy(`(r.counted_at at time zone 'utc')::date`)
                .getRawMany<{ day: string; count: number }>();
            const on = (rows: readonly { day: string; count: number }[], day: string) => rows.find((row) => row.day === day)?.count ?? 0;
            const top = await faced(db.getRepository(Referral).createQueryBuilder('r')
                .innerJoin(User, 'p', 'p.id = r.inviter_id')
                .select('count(*)::int', 'joined')
                .addSelect('count(r.counted_at)::int', 'played')
                .addSelect('count(r.flags)::int', 'flagged'), 'p')
                .setParameter('owners', owners())
                .groupBy('p.id')
                .orderBy('count(r.counted_at)', 'DESC')
                .addOrderBy('count(*)', 'DESC')
                .addOrderBy('p.handle', 'ASC')
                .limit(INVITE_TOP)
                .getRawMany<TopRow>();
            const running = await campaignsFrom(db.manager).where(RUNNING).getRawOne<CampaignRow>();

            return {
                today: inWindow(visits, friends, rewards, 'today'),
                week: inWindow(visits, friends, rewards, 'week'),
                all: inWindow(visits, friends, rewards, 'all'),
                days: Array.from({ length: INVITE_DAYS }, (_, at) =>
                {
                    const day = dayBefore(today, INVITE_DAYS - 1 - at);

                    return { day, visits: on(opened, day), joined: on(joinedOn, day), played: on(playedOn, day) };
                }),
                top: top.map((row) => ({ person: face(row.p_handle, row.p_name, row.p_hue, row.p_avatar, row.p_staff, row.p_owner), joined: row.joined, played: row.played, flagged: row.flagged })),
                ...(running === undefined ? {} : { running: campaignWire(running) }),
                waiting: await waiting()
            };
        },

        /** Every campaign, newest first, fifty a page by the microsecond keyset, each with what came of it. */
        async campaigns(cursor: string | null): Promise<AdminInviteCampaigns>
        {
            const after = keysetAfter(cursor);
            const query = campaignsFrom(db.manager);

            if (after !== null)
            {
                query.where(olderThan('campaign.created_at', 'campaign.id'), after);
            }

            const rows = await query
                .orderBy('campaign.created_at', 'DESC')
                .addOrderBy('campaign.id', 'DESC')
                .limit(INVITES_PAGE + 1)
                .getRawMany<CampaignRow>();

            return { campaigns: rows.slice(0, INVITES_PAGE).map(campaignWire), ...cursorOf(rows, INVITES_PAGE) };
        },

        /** A campaign written as a draft, with the reason in the log. */
        async write(actor: Actor, input: CampaignInput, reason: string): Promise<AdminInviteCampaign>
        {
            const shaped = shapeOf(input);

            return await db.transaction(async (tx) =>
            {
                const made = await tx.getRepository(InviteCampaign).save({ ...shaped, state: 'draft', createdBy: actor.id });

                await record(tx, actor, { kind: 'invite-campaign', reason, details: { campaign: made.id, name: made.name, to: 'draft' } });

                return (await campaignOf(tx, made.id))!;
            });
        },

        /**
         * A campaign written again, under its row's lock, which a count rewarding under it holds shared:
         * what it gives only while it has written no reward, anything else at any time, and nothing at all
         * once it has ended. A change to nothing writes nothing.
         */
        async change(actor: Actor, id: string, input: CampaignInput, reason: string)
        {
            if (!UUID.test(id))
            {
                return null;
            }

            const shaped = shapeOf(input);

            return await db.transaction(async (tx) =>
            {
                const campaign = await tx.getRepository(InviteCampaign).createQueryBuilder('campaign')
                    .setLock('pessimistic_write')
                    .where('campaign.id = :id', { id })
                    .getOne();

                if (campaign === null)
                {
                    return null;
                }

                if (campaign.state === 'ended')
                {
                    throw staffRefusal('staff-campaign-ended', 'An ended campaign stays as it ended.');
                }

                const fields = changedIn(campaign, shaped);

                if (fields.length === 0)
                {
                    return await campaignOf(tx, id);
                }

                if (fields.some((field) => GIVES.includes(field)) && await tx.getRepository(InviteReward).existsBy({ campaignId: id }))
                {
                    throw staffRefusal('staff-campaign-gave', 'What a campaign gives stays once it has given something.');
                }

                await tx.getRepository(InviteCampaign).update({ id }, shaped);
                await record(tx, actor, { kind: 'invite-campaign', reason, details: { campaign: id, name: shaped.name, to: 'changed', fields: fields.join(' ') } });

                return await campaignOf(tx, id);
            });
        },

        /**
         * A campaign started, paused or ended, under a lock on every campaign in id order, so two starts
         * at once start one: a second running is refused, a start whose end has passed too, a pause
         * only of one that runs, and an ended campaign is final. A move to where it is writes nothing.
         */
        async move(actor: Actor, id: string, to: CampaignMove, reason: string)
        {
            if (!UUID.test(id))
            {
                return null;
            }

            return await db.transaction(async (tx) =>
            {
                const all = await tx.getRepository(InviteCampaign).createQueryBuilder('campaign')
                    .setLock('pessimistic_write')
                    .orderBy('campaign.id', 'ASC')
                    .getMany();
                const campaign = all.find((one) => one.id === id);

                if (campaign === undefined)
                {
                    return null;
                }

                if (campaign.state === to)
                {
                    return await campaignOf(tx, id);
                }

                if (campaign.state === 'ended')
                {
                    throw staffRefusal('staff-campaign-ended', 'An ended campaign stays as it ended.');
                }

                if (to === 'paused' && campaign.state !== 'active')
                {
                    throw staffRefusal('staff-campaign-move', 'Only a campaign that runs can be paused.');
                }

                if (to === 'active')
                {
                    if (all.some((one) => one.state === 'active'))
                    {
                        throw staffRefusal('staff-campaign-running', 'Another campaign is running.');
                    }

                    const over = await tx.getRepository(InviteCampaign).createQueryBuilder('campaign')
                        .select('campaign.ends_at is not null and campaign.ends_at <= now()', 'over')
                        .where('campaign.id = :id', { id })
                        .getRawOne<{ over: boolean }>();

                    if (over?.over === true)
                    {
                        throw staffRefusal('staff-campaign-window', 'Its end has passed.');
                    }
                }

                await tx.getRepository(InviteCampaign).update({ id }, { state: to });
                await record(tx, actor, { kind: 'invite-campaign', reason, details: { campaign: id, name: campaign.name, to } });

                return await campaignOf(tx, id);
            });
        },

        /**
         * The rewards newest first, fifty a page by the microsecond keyset: waiting, given, refused, taken back, or
         * all, and only one person's where a handle is named (whatever its case, a leading @ dropped).
         */
        async rewards(list: RewardList, cursor: string | null, person: string | null = null): Promise<AdminInviteRewards>
        {
            const after = keysetAfter(cursor);
            const query = rewardsFrom(db.manager).where(list === 'all' ? 'true' : 'w.state = :state', { state: list });

            if (person !== null)
            {
                query.andWhere('p.handle = :person', { person: person.replace(/^@/, '') });
            }

            if (after !== null)
            {
                query.andWhere(olderThan('w.created_at', 'w.id'), after);
            }

            const rows = await query
                .orderBy('w.created_at', 'DESC')
                .addOrderBy('w.id', 'DESC')
                .limit(INVITES_PAGE + 1)
                .getRawMany<RewardRow>();

            return { rewards: rows.slice(0, INVITES_PAGE).map(rewardWire), ...cursorOf(rows, INVITES_PAGE), waiting: await waiting() };
        },

        /**
         * Inviting friends as one person's page reads it: who invited them, by which code and when, when
         * their invite counted, its flags and its campaign; how many friends they brought in, played and
         * were flagged, counted as the overview counts its inviters; and their rewards newest first.
         */
        async ofPerson(userId: string): Promise<AdminPersonInvites>
        {
            const [by, invited, rows] = await Promise.all([
                faced(db.getRepository(Referral).createQueryBuilder('r')
                    .leftJoin(User, 'p', 'p.id = r.inviter_id')
                    .leftJoin(InviteCampaign, 'c', 'c.id = r.campaign_id')
                    .select('r.code', 'code')
                    .addSelect('r.created_at', 'created_at')
                    .addSelect('r.counted_at', 'counted_at')
                    .addSelect('r.flags', 'flags')
                    .addSelect('c.id', 'campaign_id')
                    .addSelect('c.name', 'campaign_name'), 'p')
                    .setParameter('owners', owners())
                    .where('r.invitee_id = :id', { id: userId })
                    .getRawOne<ByRow>(),
                db.getRepository(Referral).createQueryBuilder('r')
                    .select('count(*)::int', 'joined')
                    .addSelect('count(r.counted_at)::int', 'played')
                    .addSelect('count(r.flags)::int', 'flagged')
                    .where('r.inviter_id = :id', { id: userId })
                    .getRawOne<{ joined: number; played: number; flagged: number }>(),
                rewardsFrom(db.manager)
                    .where('w.user_id = :id', { id: userId })
                    .orderBy('w.created_at', 'DESC')
                    .addOrderBy('w.id', 'DESC')
                    .limit(INVITES_PAGE + 1)
                    .getRawMany<RewardRow>()
            ]);

            return {
                ...(by === undefined ? {} : { by: byWire(by) }),
                invited: invited ?? { joined: 0, played: 0, flagged: 0 },
                rewards: rows.slice(0, INVITES_PAGE).map(rewardWire),
                ...(rows.length > INVITES_PAGE ? { more: true } : {})
            };
        },

        /** Whose reward it is, asked before it is decided so the rank rule is asked first; nothing for an id that is none. */
        async held(id: string)
        {
            if (!UUID.test(id))
            {
                return null;
            }

            const row = await db.getRepository(InviteReward).createQueryBuilder('w')
                .innerJoin(User, 'p', 'p.id = w.user_id')
                .select('w.user_id', 'userId')
                .addSelect('p.handle', 'handle')
                .where('w.id = :id', { id })
                .getRawOne<{ userId: string; handle: string }>();

            return row ?? null;
        },

        /**
         * A reward given or refused from review, or taken back once given, under the person's row lock
         * and then the reward's, the order a count rewarding takes them in. Given, the look is theirs in
         * that transaction; taken back, it leaves them only if it came as a reward, off every slot it was
         * worn in. A suspended account is given nothing. A decision it already has writes nothing.
         */
        async decide(actor: Actor, id: string, to: RewardMove, reason: string)
        {
            if (!UUID.test(id))
            {
                return null;
            }

            return await db.transaction(async (tx) =>
            {
                const seen = await tx.getRepository(InviteReward).findOne({ select: { id: true, userId: true }, where: { id } });

                if (seen === null)
                {
                    return null;
                }

                const person = await tx.getRepository(User).createQueryBuilder('u').setLock('pessimistic_write').where('u.id = :id', { id: seen.userId }).getOneOrFail();
                const reward = await tx.getRepository(InviteReward).createQueryBuilder('w').setLock('pessimistic_write').where('w.id = :id', { id }).getOneOrFail();
                const decided = { given: false, taken: false, worn: [] as string[], actorId: null as string | null, item: reward.itemId };

                if (reward.state === to)
                {
                    return { reward: (await rewardOf(tx, id))!, ...decided };
                }

                if (to === 'taken' ? reward.state !== 'given' : reward.state !== 'review')
                {
                    throw staffRefusal('staff-reward-move', 'That reward does not stand where that decision is made.');
                }

                if (to === 'given' && person.isSuspended)
                {
                    throw staffRefusal('staff-reward-suspended', 'A suspended account is given nothing.');
                }

                let delivered = reward.delivered;

                if (to === 'given')
                {
                    delivered = await ownReward(tx, reward.userId, reward.itemId);
                    decided.given = delivered;
                    decided.actorId = reward.kind === 'inviter'
                        ? reward.inviteeId
                        : (reward.kind === 'invitee' ? (await tx.getRepository(Referral).findOne({ select: { inviteeId: true, inviterId: true }, where: { inviteeId: reward.inviteeId! } }))?.inviterId ?? null : null);
                }

                if (to === 'taken' && reward.delivered === true && await tx.getRepository(OwnedItem).existsBy({ userId: reward.userId, itemId: reward.itemId, via: 'reward' }))
                {
                    decided.worn = (await tx.getRepository(EquippedItem).findBy({ userId: reward.userId, itemId: reward.itemId })).map((one) => one.slot);
                    decided.taken = true;
                    await tx.getRepository(OwnedItem).delete({ userId: reward.userId, itemId: reward.itemId });
                }

                await tx.getRepository(InviteReward).update({ id }, { state: to, delivered: to === 'refused' ? null : delivered, decidedAt: () => 'now()', decidedBy: actor.id, reason });
                await record(tx, actor, { kind: 'invite-reward', person: { id: person.id, handle: person.handle }, reason, details: { reward: id, item: reward.itemId, to, campaign: reward.campaignId } });

                return { reward: (await rewardOf(tx, id))!, ...decided };
            });
        }
    };
}
