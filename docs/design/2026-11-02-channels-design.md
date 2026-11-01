# Channels

The owner, 2026-11-01: "system channel ham be chat ha ezafe kon, betonan channel besazan, aks o bio
dashte bashe, member betonan invite konan, tosh mitonan post aks,film,text,vote inaro bezaran" — a
channel system beside the chats: people make a channel with a photo and a bio, members invite
others, and posts in it are photos, videos, text and polls. Asked, the owner chose:

- **Readable by the server, and public** (over sealed and invite-only): a channel is a broadcast,
  joined by anybody who finds it, with no ceiling on its members. It says on its face that it is
  not end to end encrypted.
- **The owner and the admins post** (over everybody): members read, vote and invite.
- **Polls** can be anonymous, and can take more than one answer; both are the poster's choice.

Decisions are numbered CN-D1 onward; each is a default taken here that the owner may overturn.

## Why a channel is not a group (CN-D1)

A group is a sealed room: every line is encrypted to every member's devices under an epoch key that
turns over whenever somebody joins or leaves (`chat/epochs.ts`). A channel the owner asked for is
public and unbounded, which that design cannot be and should not pretend to be: a key shared with
anybody who presses Join protects nothing, and re-keying for each of thousands of joiners is cost
with no secrecy bought. So a channel is its own thing, in its own domain (`domains/channel/`), with
its own tables, and its posts are plain rows the server reads, orders and counts. Nothing about the
sealed chats changes, and a channel is never drawn with the lock a sealed room shows.

## What a channel is

```
channels         id, slug (citext, unique), name, bio, photo (avatars.hash), privacy, created_by, created_at
channel_members  channel_id, user_id, role (owner | admin | member), joined_at, last_read_at
channel_posts    id, channel_id, author_id, kind (text | file | poll), text, file_id, file (jsonb), poll (jsonb), created_at
channel_votes    post_id, user_id, choice, voted_at
```

- **Name, bio, photo** (CN-D2). The name is 2 to 64 characters, the bio up to 300. The photo is an
  avatar: uploaded through the route a profile picture uses (sniffed, at most 64 KB, kept by its
  hash), so a channel's face is held to every rule a person's is and served from the same place.
- **The slug** is the channel's address, `/app/channels/<slug>`, claimed by INSERT against the
  unique index as a group's is.
- **Privacy** (CN-D3): `public` is found in Discover and joined by anybody; `private` is reached only
  by being invited. The owner chose public as the kind a channel is; private is the same table with
  the Join button gone, kept because a channel for a club is a real want and costs one column.
- **One owner**, by a partial unique index, as a group has. The owner names and un-names admins and
  can hand the channel on; an owner who leaves hands it to the longest-standing admin, then member;
  the last one out takes the channel with them.

## Who does what (CN-D4)

| | Owner | Admin | Member | Anybody else |
|---|---|---|---|---|
| Read the posts | ✓ | ✓ | ✓ | a public channel's, before joining |
| Post, delete any post | ✓ | ✓ | | |
| Vote in a poll | ✓ | ✓ | ✓ | |
| Invite somebody | ✓ | ✓ | ✓ | |
| Edit the name, bio, photo, privacy | ✓ | ✓ | | |
| Name or un-name an admin, remove a member | ✓ | | | |
| Hand the channel on, delete it | ✓ | | | |

**Inviting** is adding a person, as a group does it, and gated by the same `mayMessage` rule: a
block, an account that takes nothing from strangers and a minor being added by a stranger are each
refused by the one rule. A member of a public channel can also share its link.

## Posts (CN-D5)

- **Text**: up to 4,096 characters, drawn as a line's words are (links, bold, spoilers).
- **A photo, a video or a file**, with a caption, under the limits the chat holds (10 MB a photo, 50
  MB a video or a file; `domains/chat/files.ts`). The file rides the chat's pipeline (`chat_files`,
  the upload, the fetch) **with its key in the post rather than sealed in a message**: the bytes are
  still ciphertext where they are kept, and the key is as readable as the post, which is what a
  channel is. The size and a video's length are on the post before anything is fetched, as in the
  chat. Who may fetch a channel's file: whoever may read the channel.
- **A poll**: a question (up to 255 characters), 2 to 10 answers (up to 100 each), anonymous or not,
  one answer or several. A vote can be taken back and changed until the poll is closed by its poster.
  The tally is the server's, counted from `channel_votes`; an anonymous poll never says who chose
  what, to anybody, its poster included. The server still knows who voted (it has to, to count one
  vote a person), and the poll says so: "Anonymous: nobody in the channel sees who voted for what."
- **Deleting** a post takes its votes and lets its file go when nothing else names it.
- Posts are read newest last, a keyset page at a time, as a thread is. Unread is the posts after the
  reader's own `last_read_at`, and the chat list shows a channel's count beside its rooms.

## Realtime

A post, a vote, an edit and a membership change ring the channel's members over the existing socket
with one new frame, `{ t: 'channel', id }`, and the browser reads the page, as the chat does it: the
socket says something changed, it never carries the post.

## Where

- **Chats** gets a Channels tab beside its rooms: the channels the reader is in, with unread counts,
  "New channel", and Discover for public ones.
- **A channel's page**: its photo, name, bio and member count; Join or Leave; Invite; "Not end-to-end
  encrypted" with what that means; the posts; and, for the owner and the admins, a composer with the
  paperclip and a poll button.
- **Settings of a channel**: name, bio, photo, privacy, admins, members, delete.

## Decisions

| | Decision | Default taken |
|---|---|---|
| CN-D1 | What a channel is | Its own domain and tables, readable by the server; not a group mode |
| CN-D2 | Its face | Name 2–64, bio up to 300, photo as an avatar (64 KB, hashed) |
| CN-D3 | Privacy | Public (found and joined by anybody) by default; private reached only by invitation |
| CN-D4 | Roles | Owner and admins post and edit; members read, vote and invite; one owner |
| CN-D5 | Posts | Text 4,096; photo, video, file with caption under the chat's limits, key in the post; polls 2–10 answers, anonymous or not, one or several |
| CN-D6 | Not in this work | Comments, reactions on posts, view counts, scheduled posts, editing a post, signed posts, a post forwarded into a chat |

## Phases, each its own commit

- **CN0** `docs(spec)`: this document.
- **CN1** `feat(schema)`: the four tables.
- **CN2** `feat(channels)`: the server: channels, members, roles, posts, files, polls, the frame.
- **CN3** `feat(channels)`: the browser's store, the tab, the list, Discover, New channel.
- **CN4** `feat(channels)`: a channel's page, its posts, its composer and its polls.

## As built

CN0 `7bf83e24`, CN1 `cdc2e469`, the file rules asked of channel posts `b9ae0599`, the shared file
check `c62f4892`, CN2 `d422afcf`; CN3 and CN4 landed as the browser's commit after them.

What changed on the way, against the design:

- **A change rings over the socket's own nudge**, `me` with the topic `channels`, rather than a new
  frame: the gateway already said "something of yours changed" by topic, and a new frame would have
  been new vocabulary for the same news.
- **The Channels tab is in the chat list**, beside All, Direct, Groups and Tables, with the unread
  count; Discover is the public channels under the reader's own, in the same tab.
- **The paperclip is the chat's own sheet**, which posts to the channel instead of sending into a
  room (`FileSheet`'s `onSend`), so a photo is re-drawn and a file over its limit refused the same way.
- **Members**: a sheet lists everybody with their role; the owner names and un-names admins and
  takes members out. Handing the channel on has its route and its store call and no button yet.

Not done, stated:

- **No notification for being invited**: the channel is in the invited person's list at the next
  nudge, and nothing rings their bell.
- **No Postgres was at hand**: `channels.db.spec.ts` was typechecked and never run, and the snapshot
  was written by hand.
- No real browser was driven; the page, the polls and the posts are held by rendered specs.
- CN-D6 stands: no comments, reactions, view counts, scheduled or edited posts.
