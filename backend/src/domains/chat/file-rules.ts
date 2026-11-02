/**
 * The two questions every rule about a kept photo, video or file asks, spelled once, as SQL over a
 * `chat_files` row aliased `v` and a reader bound as `:me`.
 *
 * A file is named by a chat message, by a report that disclosed one, or by a channel's post. Each
 * way a file is let go, each sweep and the count of uploads still waiting asks `FILE_NAMED`; who may
 * fetch a file and which file a send or a post may name asks `FILE_REACHED_BY_ME`. A third place to
 * name a file is a third clause here and nowhere else: a copy that forgot it would let a channel's
 * files be swept an hour after they were posted.
 */

/** Something still names the file `alias`: a message, a report or a channel's post. */
export const fileNamed = (alias: string) => `(exists (select 1 from messages m where m.file_id = ${ alias }.id)
    or exists (select 1 from reports r where r.file_id = ${ alias }.id)
    or exists (select 1 from channel_posts p where p.file_id = ${ alias }.id))`;

/**
 * The reader may fetch the file `v`: they uploaded it; or they are in a room holding a live message
 * that names it, with no block between them and another member there (the rule every read of a room
 * applies); or a post names it in a channel they may read, which is any public one and a private one
 * they are in. A channel applies no block rule to reading: it is a broadcast, and a block governs
 * who reaches whom, which a channel's invitations ask instead.
 */
export const FILE_REACHED_BY_ME = `(v.uploader_id = :me or exists (
    select 1
    from messages named
    join conversation_members seat on seat.conversation_id = named.conversation_id and seat.user_id = :me
    where named.file_id = v.id
      and (named.expires_at is null or named.expires_at > now())
      and not exists (select 1
                        from conversation_members other
                        join blocks b on (b.user_id = :me and b.blocked_id = other.user_id)
                                      or (b.user_id = other.user_id and b.blocked_id = :me)
                       where other.conversation_id = named.conversation_id and other.user_id <> :me))
    or exists (
    select 1
    from channel_posts posted
    join channels ch on ch.id = posted.channel_id
    where posted.file_id = v.id
      and (ch.privacy = 'public'
           or exists (select 1 from channel_members cm where cm.channel_id = ch.id and cm.user_id = :me))))`;
