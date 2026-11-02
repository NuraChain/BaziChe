import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@azerothjs/http';
import type { DataSource, EntityManager } from 'typeorm';

import { Avatar } from '../../entities/avatar.entity.ts';
import { ChannelMember } from '../../entities/channel-member.entity.ts';
import { ChannelVote } from '../../entities/channel-vote.entity.ts';
import { ChatFile } from '../../entities/chat-file.entity.ts';
import { cursorFor, instantOf, keyOf, keysetAfter } from '../../lib/keyset.ts';
import { firstRow, rowsOf } from '../../lib/rows.ts';
import { FILE_REACHED_BY_ME, fileNamed } from '../chat/file-rules.ts';
import { sentFileOf, type SentFile } from '../chat/files.ts';
import { candidatesFor, checkSlug, slugFromName } from '../group/slug.ts';
import { avatarHashOf, avatarUrl, type AvatarType } from '../identity/avatar.ts';
import type { SocialService } from '../social/service.ts';
import {
    CHANNEL_BIO_MOST,
    CHANNEL_NAME_LEAST,
    CHANNEL_NAME_MOST,
    CHANNEL_PAGE,
    CHANNEL_TEXT_MOST,
    pollOf,
    speaks,
    type ChannelPostKind,
    type ChannelPrivacy,
    type ChannelRole,
    type Poll
} from './rules.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const UNIQUE_VIOLATION = '23505';

const CLAIM_ATTEMPTS = 8;

/** A channel as its reader sees it. */
export interface ChannelView
{
    id: string;
    slug: string;
    name: string;
    bio: string;
    photo?: string;
    privacy: ChannelPrivacy;
    owner: string;
    role?: ChannelRole;
    memberCount: number;
    unread?: number;
    last?: PostView;
    createdAt: string;
}

/** A poll as its reader sees it: the tally, what they chose, and who chose what only when it is not anonymous. */
export interface PollView
{
    question: string;
    answers: { text: string; votes: number; voters?: string[] }[];
    anonymous: boolean;
    multiple: boolean;
    voters: number;
    mine: number[];
    closed: boolean;
}

export interface PostView
{
    id: string;
    channelId: string;
    kind: ChannelPostKind;
    from?: string;
    text: string;
    file?: SentFile;
    poll?: PollView;
    at: string;
}

interface ChannelRow
{
    id: string;
    slug: string;
    name: string;
    bio: string;
    photo: string | null;
    photo_type: AvatarType | null;
    privacy: ChannelPrivacy;
    owner: string | null;
    role: ChannelRole | null;
    members: number;
    unread: number | null;
    created_at: Date;
}

interface PostRow
{
    id: string;
    channel_id: string;
    kind: ChannelPostKind;
    author: string | null;
    text: string;
    file: SentFile | null;
    poll: Poll | null;
    closed_at: Date | null;
    created_at: Date;
    at_key: string;
}

/**
 * The columns every read of a channel takes, for a reader bound as `$1`: the face, the owner's
 * handle, the reader's role, how many are in it and, for a member, how many posts they have not read.
 */
const CHANNEL_COLUMNS = `
    ch.id, ch.slug, ch.name, ch.bio, ch.photo, av.type as photo_type, ch.privacy, ch.created_at,
    (select u.handle from channel_members o join users u on u.id = o.user_id
      where o.channel_id = ch.id and o.role = 'owner') as owner,
    mine.role,
    (select count(*)::int from channel_members c where c.channel_id = ch.id) as members,
    case when mine.role is null then null else
        (select count(*)::int from channel_posts p
          where p.channel_id = ch.id and p.created_at > mine.last_read_at
            and (p.author_id is null or p.author_id <> $1)) end as unread`;

const CHANNEL_FROM = `
    channels ch
    left join avatars av on av.hash = ch.photo
    left join channel_members mine on mine.channel_id = ch.id and mine.user_id = $1`;

/** Who may read a channel: anybody, when it is public; its members, when it is private. */
const READABLE = `(ch.privacy = 'public' or mine.role is not null)`;

const POST_COLUMNS = `p.id, p.channel_id, p.kind, u.handle as author, p.text, p.file, p.poll, p.closed_at, p.created_at, ${ keyOf('p.created_at') } as at_key`;

export function createChannelService(db: DataSource, social: SocialService, origin: string)
{
    const photoOf = (row: { photo: string | null; photo_type: AvatarType | null }) =>
        (row.photo === null || row.photo_type === null ? undefined : avatarUrl(origin, row.photo, row.photo_type));

    /** A channel this reader may read, by its slug, or null: a private one they are not in answers as one that is not there. */
    const readable = async (me: string, slug: string) =>
        firstRow<ChannelRow>(await db.query(`select ${ CHANNEL_COLUMNS } from ${ CHANNEL_FROM } where ch.slug = $2 and ${ READABLE }`, [me, slug]));

    const mustRead = async (me: string, slug: string) =>
    {
        const found = await readable(me, slug);

        if (found === null)
        {
            throw new NotFoundError('No channel there.');
        }
        return found;
    };

    const mustBeIn = async (me: string, slug: string) =>
    {
        const found = await mustRead(me, slug);

        if (found.role === null)
        {
            throw new ForbiddenError('Join the channel first.');
        }
        return found as ChannelRow & { role: ChannelRole };
    };

    const mustSpeak = async (me: string, slug: string) =>
    {
        const found = await mustBeIn(me, slug);

        if (!speaks(found.role))
        {
            throw new ForbiddenError('Only the owner and the admins can do that.');
        }
        return found;
    };

    const mustOwn = async (me: string, slug: string) =>
    {
        const found = await mustBeIn(me, slug);

        if (found.role !== 'owner')
        {
            throw new ForbiddenError('Only the owner can do that.');
        }
        return found;
    };

    /** A photo given as the address an avatar upload answered with, as the hash it is kept under; '' is none. */
    const photoHash = async (url: string) =>
    {
        if (url === '')
        {
            return null;
        }

        const hash = avatarHashOf(origin, url);

        if (hash === null || !(await db.getRepository(Avatar).existsBy({ hash })))
        {
            throw new BadRequestError('That picture was not uploaded here.');
        }
        return hash;
    };

    const face = (input: { name: string; bio: string }) =>
    {
        const name = input.name.trim();
        const bio = input.bio.trim();

        if (name.length < CHANNEL_NAME_LEAST || name.length > CHANNEL_NAME_MOST)
        {
            throw new ValidationError({ name: 'Give the channel a name of 2 to 64 characters.' }, 'That name will not do.');
        }

        if (bio.length > CHANNEL_BIO_MOST)
        {
            throw new ValidationError({ bio: 'A bio is 300 characters at most.' }, 'That bio is too long.');
        }
        return { name, bio };
    };

    /** The tally of polls among `rows`, for a reader: counts always, names only where a poll is not anonymous. */
    const pollsFor = async (me: string, rows: readonly PostRow[]) =>
    {
        const ids = rows.filter((row) => row.kind === 'poll').map((row) => row.id);
        const votes = ids.length === 0
            ? []
            : rowsOf<{ post_id: string; user_id: string; handle: string | null; choice: number }>(await db.query(
                `select v.post_id, v.user_id, u.handle, v.choice
                   from channel_votes v left join users u on u.id = v.user_id
                  where v.post_id = any($1::uuid[])
                  order by v.voted_at, v.user_id`,
                [ids]
            ));

        return new Map(rows.filter((row) => row.poll !== null).map((row) =>
        {
            const poll = row.poll!;
            const its = votes.filter((one) => one.post_id === row.id);

            const view: PollView = {
                question: poll.question,
                answers: poll.answers.map((text, choice) =>
                {
                    const chose = its.filter((one) => one.choice === choice);

                    return {
                        text,
                        votes: chose.length,
                        ...(poll.anonymous ? {} : { voters: chose.flatMap((one) => (one.handle === null ? [] : [one.handle])) })
                    };
                }),
                anonymous: poll.anonymous,
                multiple: poll.multiple,
                voters: new Set(its.map((one) => one.user_id)).size,
                mine: its.filter((one) => one.user_id === me).map((one) => one.choice).sort((a, b) => a - b),
                closed: row.closed_at !== null
            };

            return [row.id, view] as const;
        }));
    };

    const postsAs = async (me: string, rows: readonly PostRow[]): Promise<PostView[]> =>
    {
        const polls = await pollsFor(me, rows);

        return rows.map((row) => ({
            id: row.id,
            channelId: row.channel_id,
            kind: row.kind,
            ...(row.author === null ? {} : { from: row.author }),
            text: row.text,
            ...(row.file === null ? {} : { file: row.file }),
            ...(polls.has(row.id) ? { poll: polls.get(row.id)! } : {}),
            at: row.created_at.toISOString()
        }));
    };

    const onePost = async (channelId: string, postId: string) =>
    {
        const row = UUID.test(postId)
            ? firstRow<PostRow>(await db.query(
                `select ${ POST_COLUMNS } from channel_posts p left join users u on u.id = p.author_id where p.id = $1 and p.channel_id = $2`,
                [postId, channelId]
            ))
            : null;

        if (row === null)
        {
            throw new NotFoundError('No such post here.');
        }
        return row;
    };

    const lastOf = async (me: string, channelIds: readonly string[]) =>
    {
        if (channelIds.length === 0)
        {
            return new Map<string, PostView>();
        }

        const rows = rowsOf<PostRow>(await db.query(
            `select distinct on (p.channel_id) ${ POST_COLUMNS }
               from channel_posts p left join users u on u.id = p.author_id
              where p.channel_id = any($1::uuid[])
              order by p.channel_id, p.created_at desc, p.id desc`,
            [channelIds]
        ));

        return new Map((await postsAs(me, rows)).map((post) => [post.channelId, post]));
    };

    const asView = (row: ChannelRow, last?: PostView): ChannelView => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        bio: row.bio,
        ...(photoOf(row) === undefined ? {} : { photo: photoOf(row)! }),
        privacy: row.privacy,
        owner: row.owner ?? '',
        ...(row.role === null ? {} : { role: row.role }),
        memberCount: row.members,
        ...(row.unread === null ? {} : { unread: row.unread }),
        ...(last === undefined ? {} : { last }),
        createdAt: row.created_at.toISOString()
    });

    const viewOf = async (me: string, slug: string) =>
    {
        const row = await mustRead(me, slug);
        const last = await lastOf(me, [row.id]);

        return asView(row, last.get(row.id));
    };

    /** Lets a deleted post's file go when nothing else names it, inside the caller's transaction. */
    const letGo = async (tx: EntityManager, fileId: string | null) =>
    {
        if (fileId !== null)
        {
            await tx.getRepository(ChatFile)
                .createQueryBuilder()
                .delete()
                .where('id = :fileId', { fileId })
                .andWhere(`not ${ fileNamed('chat_files') }`)
                .execute();
        }
    };

    /** Everybody in a channel, whom a change in it rings. */
    const membersOf = async (channelId: string) =>
        rowsOf<{ user_id: string }>(await db.query('select user_id from channel_members where channel_id = $1', [channelId])).map((row) => row.user_id);

    return {
        membersOf,

        /** The channels the reader is in, the one with the newest post first. */
        async mine(me: string): Promise<ChannelView[]>
        {
            const rows = rowsOf<ChannelRow>(await db.query(
                `select ${ CHANNEL_COLUMNS } from ${ CHANNEL_FROM }
                  where mine.role is not null
                  order by coalesce((select max(p.created_at) from channel_posts p where p.channel_id = ch.id), ch.created_at) desc, ch.id desc
                  limit 200`,
                [me]
            ));
            const last = await lastOf(me, rows.map((row) => row.id));

            return rows.map((row) => asView(row, last.get(row.id)));
        },

        /** Public channels the reader is not in, the busiest first. */
        async discover(me: string, limit: number): Promise<ChannelView[]>
        {
            const rows = rowsOf<ChannelRow>(await db.query(
                `select ${ CHANNEL_COLUMNS } from ${ CHANNEL_FROM }
                  where ch.privacy = 'public' and mine.role is null
                  order by (select count(*) from channel_members c where c.channel_id = ch.id) desc, ch.created_at desc
                  limit $2`,
                [me, limit]
            ));

            return rows.map((row) => asView(row));
        },

        view: (me: string, slug: string) => viewOf(me, slug),

        async create(me: string, input: { name: string; bio: string; photo: string; privacy: ChannelPrivacy })
        {
            const { name, bio } = face(input);
            const photo = await photoHash(input.photo);
            const wanted = slugFromName(name) || 'channel';

            for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt += 1)
            {
                const slug = candidatesFor(wanted, attempt, Math.random);

                if (checkSlug(slug) !== null)
                {
                    continue;
                }

                try
                {
                    await db.transaction(async (tx) =>
                    {
                        const made = rowsOf<{ id: string }>(await tx.query(
                            `insert into channels (slug, name, bio, photo, privacy, created_by) values ($1, $2, $3, $4, $5, $6) returning id`,
                            [slug, name, bio, photo, input.privacy, me]
                        ))[0];

                        await tx.getRepository(ChannelMember).insert({ channelId: made.id, userId: me, role: 'owner' });
                    });

                    return await viewOf(me, slug);
                }
                catch (error)
                {
                    if ((error as { code?: string }).code !== UNIQUE_VIOLATION)
                    {
                        throw error;
                    }
                }
            }

            throw new ConflictError('That name is taken. Try another.');
        },

        async edit(me: string, slug: string, input: { name: string; bio: string; photo: string; privacy: ChannelPrivacy })
        {
            const found = await mustSpeak(me, slug);
            const { name, bio } = face(input);
            const photo = await photoHash(input.photo);

            await db.query('update channels set name = $2, bio = $3, photo = $4, privacy = $5 where id = $1', [found.id, name, bio, photo, input.privacy]);
            return viewOf(me, slug);
        },

        /** Joins a public channel. A private one is reached only by being invited. */
        async join(me: string, slug: string)
        {
            const found = await mustRead(me, slug);

            if (found.role === null && found.privacy !== 'public')
            {
                throw new NotFoundError('No channel there.');
            }

            await db.query(
                `insert into channel_members (channel_id, user_id, role) values ($1, $2, 'member') on conflict do nothing`,
                [found.id, me]
            );
            return { channel: await viewOf(me, slug), id: found.id };
        },

        /**
         * Invites somebody, which is adding them, as a group does it: any member may, and the rule
         * that governs who may write into somebody's lists decides. A block, an account that takes
         * nothing from strangers, and a minor being added by a stranger are each refused by that rule.
         */
        async invite(me: string, slug: string, otherId: string)
        {
            const found = await mustBeIn(me, slug);
            const refusal = await social.mayMessage(me, otherId);

            if (refusal !== null)
            {
                throw new ForbiddenError(refusal === 'blocked'
                    ? 'You cannot reach that account.'
                    : 'They are not taking invitations from people they have not added.');
            }

            const seated = rowsOf<{ user_id: string }>(await db.query(
                `insert into channel_members (channel_id, user_id, role) values ($1, $2, 'member')
                 on conflict do nothing returning user_id`,
                [found.id, otherId]
            ));

            // `arrived` is whether they were seated now: somebody already in is not told again.
            return { channel: await viewOf(me, slug), id: found.id, arrived: seated.length > 0 };
        },

        /**
         * Leaves, and hands the channel on rather than stranding it: an owner's place goes to the
         * longest-standing admin, then member; the last one out takes the channel with them.
         */
        async leave(me: string, slug: string)
        {
            const found = await mustBeIn(me, slug);

            await db.transaction(async (tx) =>
            {
                await tx.getRepository(ChannelMember).delete({ channelId: found.id, userId: me });

                if (found.role !== 'owner')
                {
                    return;
                }

                const heir = firstRow<{ user_id: string }>(await tx.query(
                    `select user_id from channel_members where channel_id = $1
                      order by (role = 'admin') desc, joined_at, user_id limit 1`,
                    [found.id]
                ));

                if (heir === null)
                {
                    await tx.query('delete from channels where id = $1', [found.id]);
                    return;
                }

                await tx.query(`update channel_members set role = 'owner' where channel_id = $1 and user_id = $2`, [found.id, heir.user_id]);
            });

            return found.id;
        },

        /** The owner takes somebody out. They can come back to a public channel by joining. */
        async remove(me: string, slug: string, otherId: string)
        {
            const found = await mustOwn(me, slug);

            if (otherId === me)
            {
                throw new BadRequestError('Leave the channel instead.');
            }

            await db.getRepository(ChannelMember).delete({ channelId: found.id, userId: otherId });
            return { channel: await viewOf(me, slug), id: found.id };
        },

        /** The owner names an admin, or makes one a member again. */
        async setRole(me: string, slug: string, otherId: string, role: 'admin' | 'member')
        {
            const found = await mustOwn(me, slug);

            if (otherId === me)
            {
                throw new BadRequestError('Hand the channel on to change your own role.');
            }

            const moved = rowsOf<{ user_id: string }>(await db.query(
                `update channel_members set role = $3 where channel_id = $1 and user_id = $2 and role <> 'owner' returning user_id`,
                [found.id, otherId, role]
            ));

            if (moved.length === 0)
            {
                throw new NotFoundError('They are not in this channel.');
            }
            return { channel: await viewOf(me, slug), id: found.id };
        },

        /** The owner hands the channel on to somebody in it, and stays as an admin. */
        async transfer(me: string, slug: string, otherId: string)
        {
            const found = await mustOwn(me, slug);

            await db.transaction(async (tx) =>
            {
                const there = await tx.getRepository(ChannelMember).existsBy({ channelId: found.id, userId: otherId });

                if (!there || otherId === me)
                {
                    throw new NotFoundError('They are not in this channel.');
                }

                await tx.query(`update channel_members set role = 'admin' where channel_id = $1 and user_id = $2`, [found.id, me]);
                await tx.query(`update channel_members set role = 'owner' where channel_id = $1 and user_id = $2`, [found.id, otherId]);
            });

            return { channel: await viewOf(me, slug), id: found.id };
        },

        /** The owner deletes the channel, its posts and its votes; its files go with the last thing naming them. */
        async destroy(me: string, slug: string)
        {
            const found = await mustOwn(me, slug);
            const members = await membersOf(found.id);

            await db.transaction(async (tx) =>
            {
                const files = rowsOf<{ file_id: string }>(await tx.query('select file_id from channel_posts where channel_id = $1 and file_id is not null', [found.id]));

                await tx.query('delete from channels where id = $1', [found.id]);

                for (const one of files)
                {
                    await letGo(tx, one.file_id);
                }
            });

            return members;
        },

        /** Everybody in it with their role, for those in it. */
        async members(me: string, slug: string)
        {
            const found = await mustBeIn(me, slug);

            return rowsOf<{ handle: string; role: ChannelRole }>(await db.query(
                `select u.handle, m.role from channel_members m join users u on u.id = m.user_id
                  where m.channel_id = $1
                  order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, m.joined_at, u.handle
                  limit 500`,
                [found.id]
            ));
        },

        /** One page of posts, newest first by keyset, handed back oldest first within the page. */
        async posts(me: string, slug: string, cursor: string | undefined)
        {
            const found = await mustRead(me, slug);
            const after = keysetAfter(cursor);
            const rows = rowsOf<PostRow>(await db.query(
                `select ${ POST_COLUMNS } from channel_posts p left join users u on u.id = p.author_id
                  where p.channel_id = $1
                    and ($2::text is null or (p.created_at, p.id) < (${ instantOf('$2') }, $3::uuid))
                  order by p.created_at desc, p.id desc
                  limit $4`,
                [found.id, after?.micros ?? null, after?.id ?? null, CHANNEL_PAGE + 1]
            ));
            const shown = rows.slice(0, CHANNEL_PAGE);
            const oldest = shown.at(-1);

            return {
                posts: await postsAs(me, [...shown].reverse()),
                hasMore: rows.length > CHANNEL_PAGE,
                ...(rows.length > CHANNEL_PAGE && oldest !== undefined ? { cursor: cursorFor(oldest.at_key, oldest.id) } : {})
            };
        },

        async markRead(me: string, slug: string)
        {
            const found = await mustBeIn(me, slug);

            await db.query('update channel_members set last_read_at = now() where channel_id = $1 and user_id = $2', [found.id, me]);
        },

        /**
         * Posts, for the owner and the admins: words, a photo, a video or a file with a caption, or a
         * poll. A file has to be one its poster may fetch (their own upload, or one they can already
         * see), and what a reader is told of it is held to the check a sealed message's file is.
         */
        async post(me: string, slug: string, input: { kind: ChannelPostKind; text: string; file?: unknown; poll?: unknown })
        {
            const found = await mustSpeak(me, slug);
            const text = input.text.trim();

            if (text.length > CHANNEL_TEXT_MOST)
            {
                throw new BadRequestError('That is too long to post.');
            }

            let file: SentFile | null = null;
            let poll: Poll | null = null;

            if (input.kind === 'text')
            {
                if (text === '')
                {
                    throw new BadRequestError('A post needs words.');
                }
            }
            else if (input.kind === 'file')
            {
                file = sentFileOf(input.file);

                if (file === null)
                {
                    throw new BadRequestError('That is not a file a post can carry.');
                }

                const reachable = await db.getRepository(ChatFile)
                    .createQueryBuilder('v')
                    .where('v.id = :id', { id: file.id })
                    .andWhere(FILE_REACHED_BY_ME, { me })
                    .getExists();

                if (!reachable)
                {
                    throw new NotFoundError('There is no file of yours with that id.');
                }
            }
            else
            {
                poll = pollOf(input.poll);

                if (poll === null || text !== '')
                {
                    throw new BadRequestError('That is not a poll: a question and 2 to 10 different answers.');
                }
            }

            if ((input.kind !== 'file' && input.file !== undefined) || (input.kind !== 'poll' && input.poll !== undefined))
            {
                throw new BadRequestError('A post carries what its kind does and nothing else.');
            }

            const made = rowsOf<{ id: string }>(await db.query(
                `insert into channel_posts (channel_id, author_id, kind, text, file_id, file, poll)
                 values ($1, $2, $3, $4, $5, $6, $7) returning id`,
                [found.id, me, input.kind, text, file?.id ?? null, file === null ? null : JSON.stringify(file), poll === null ? null : JSON.stringify(poll)]
            ))[0];

            await db.query('update channel_members set last_read_at = now() where channel_id = $1 and user_id = $2', [found.id, me]);

            const [view] = await postsAs(me, [await onePost(found.id, made.id)]);

            return { post: view, id: found.id };
        },

        /** The owner and the admins delete a post; its votes go with it, and its file with the last thing naming it. */
        async removePost(me: string, slug: string, postId: string)
        {
            const found = await mustSpeak(me, slug);
            const row = await onePost(found.id, postId);

            await db.transaction(async (tx) =>
            {
                const gone = rowsOf<{ file_id: string | null }>(await tx.query('delete from channel_posts where id = $1 returning file_id', [row.id]));

                await letGo(tx, gone[0]?.file_id ?? null);
            });

            return found.id;
        },

        /**
         * A member's answer to a poll, replacing whatever they chose before: an empty choice takes
         * their vote back. One answer, unless the poll takes several; never after it was closed.
         */
        async vote(me: string, slug: string, postId: string, choices: readonly number[])
        {
            const found = await mustBeIn(me, slug);
            const row = await onePost(found.id, postId);
            const poll = row.poll;

            if (row.kind !== 'poll' || poll === null)
            {
                throw new NotFoundError('That post is not a poll.');
            }

            if (row.closed_at !== null)
            {
                throw new ForbiddenError('That poll is closed.');
            }

            const chosen = [...new Set(choices)];

            if (chosen.some((one) => !Number.isSafeInteger(one) || one < 0 || one >= poll.answers.length) || (!poll.multiple && chosen.length > 1))
            {
                throw new BadRequestError(poll.multiple ? 'Choose among the answers.' : 'Choose one answer.');
            }

            await db.transaction(async (tx) =>
            {
                await tx.getRepository(ChannelVote).delete({ postId: row.id, userId: me });

                if (chosen.length > 0)
                {
                    await tx.getRepository(ChannelVote).insert(chosen.map((choice) => ({ postId: row.id, userId: me, choice })));
                }
            });

            const [view] = await postsAs(me, [await onePost(found.id, row.id)]);

            return { post: view, id: found.id };
        },

        /** Its poster, the owner or an admin closes a poll; its tally stands as it is. */
        async closePoll(me: string, slug: string, postId: string)
        {
            const found = await mustBeIn(me, slug);
            const row = await onePost(found.id, postId);
            const author = firstRow<{ author_id: string | null }>(await db.query('select author_id from channel_posts where id = $1', [row.id]));

            if (row.kind !== 'poll')
            {
                throw new NotFoundError('That post is not a poll.');
            }

            if (author?.author_id !== me && !speaks(found.role))
            {
                throw new ForbiddenError('Only its poster, the owner and the admins can close a poll.');
            }

            await db.query('update channel_posts set closed_at = coalesce(closed_at, now()) where id = $1', [row.id]);

            const [view] = await postsAs(me, [await onePost(found.id, row.id)]);

            return { post: view, id: found.id };
        }
    };
}

export type ChannelService = ReturnType<typeof createChannelService>;
