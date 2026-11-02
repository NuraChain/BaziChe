# Photos, videos, files, calls and groups in the chat

The owner, 2026-11-02, pasted a brief for a Telegram-inspired messenger built into Baziche: photos,
albums, videos and files in every conversation, with a viewer, a player and a gallery; secure media
storage; one-to-one voice calls with ringing, missed and busy states and a history; group voice calls
with moderation; and a group system with an owner, administrators whose rights the owner chooses,
moderators, permissions, ownership transfer, invitation links, join requests, bans, mutes and a log.
Everything enforced by the server, synchronized in real time, tested between real browsers.

This document is the design. It starts from what the inspection found, because the brief asks that
what works is reused and not rebuilt. Decisions are numbered MS-D1 onward; each is a default taken
here that the owner may overturn.

## What exists

- **The chat is sealed end to end** (`nura-e2ee/v1`, `.claude/rules/chat-and-keys.md`). Every line a
  person writes is AES-256-GCM under a key derived from the room's epoch key, signed by the sending
  device, with its kind, time, expiry and a franking commitment bound into its AAD. The server keeps
  ciphertext and an envelope. Kinds: `text`, `voice`, `reaction`, `edit`, `deleted`, and the three the
  server writes, `system`, `invite`, `result`. A line is in the thread at the press with a clock, ✓ once
  stored and ✓✓ once read; Not sent keeps Try again. Replies, reactions, edits for two days, forwards,
  deletions by the author, disappearing messages, reports with a franked disclosure, and a search over
  what this browser has opened.
- **Voice messages are sealed files** (`voice_notes`, bytea in Postgres, 128 B to 6 MiB): uploaded by a
  raw `PUT /api/chat/voice/:id`, fetched by `GET` by the uploader and by whoever sits in a room holding
  a live message that names the file (`HEARD_BY_ME`), budgets of 200 MiB a day and ten unsent, a file
  that goes with the last live message naming it, a sweep for uploads nobody sent, a report that keeps
  its file, a player and a recorder.
- **Pictures** are `avatars` rows by content hash (64 KiB at most, sniffed by the server), served at
  `/avatars/<hash>.<ext>`.
- **No object storage.** One server per database; nginx in front, whose server block in the README
  lets an 8 MiB body through.
- **The realtime socket** is a doorbell: frames say what changed and pages read it again through the
  routes. It also carries voice: `voice` joins a room, `signal` passes an offer, answer or candidate
  between two joinings, and `sound` carries Opus or μ-law frames that the hub forwards to the others in
  the room. The crowd pass held 3,000 sockets on one process.
- **Table voice** is a line straight between two browsers where one connects, carried by this server
  from the first moment and for good where none does (no STUN or TURN: the owner had both taken out and
  asked whether it could work without them; it does). A playout worklet that measures the line, a gate,
  RNNoise, three quality presets, a volume for each person, a voice manager that says what was measured.
  Who can hear whom is the messaging policy, per pair (`mayTalk`).
- **Notifications** are a kind, an actor, a count and a reference, deduplicated by key; a push carries
  nothing and the worker reads the list over the reader's own session.
- **Groups** have two roles, `owner` and `member` (a partial unique index allows one owner), a slug that
  never moves, a crest from a closed set, a blurb, a game, public or private (a private group answers a
  stranger as one that does not exist), add (asked of `mayMessage`; the page offers friends), remove and
  transfer by the owner, leave with an heir, lines for created, joined, left, removed, renamed, owner,
  closed and opened, and a thread that moves in lockstep with the membership. `groupSummary` carries
  every member's handle.

What is missing is the brief: photos, videos and files; a viewer, a player and a gallery; calls outside
a table, ringing, a history; administrators, rights, moderators and permissions; a group photo;
invitation links and join requests; bans, mutes, deleting somebody else's message, pinned messages; a
group log; a members list paged by the server.

## The constraint that shapes the media: it stays sealed

A photo is the most private thing most people send. A chat that seals words and voice and sends photos
in the clear would hand the server exactly what the seal is for. So **every photo, video and file is
sealed in the sender's browser the way a voice message is** (MS-D17): a fresh key a file, the key in the
sealed document of the message, ciphertext on the server.

That decides what several lines of the brief can mean, and this design says so rather than pretending:

- **The server cannot make thumbnails, transcode a video, read its length or check what a file is.**
  The sender's browser makes the thumbnail, the poster, the dimensions and the duration, and puts them
  in the sealed document. Every reader's browser checks the bytes again after it opens them.
- **"Do not trust file extensions or client-provided MIME types"** is done where the bytes can be
  seen: the type is read from the bytes in the sender's browser before anything is sent, and again in
  every reader's browser before anything is shown or saved (MS-D22). The server checks everything it
  can see: who uploads, how much, how often, that every chunk has the size the file declared, that a
  message names only files its sender may name, and that only the people of a room holding a live
  message that names a file can fetch it.
- **What the server learns** grows by one fact: which files are photos, videos, documents or
  thumbnails, and how many a message carries (MS-D23), so that it can page a gallery. It already knew
  who sent what, when and how large it was.

Calls are not sealed (MS-D37), and group administration is metadata the server keeps, as it is today.

## Part 1: groups

### Roles, rights and rank (MS-D1 to MS-D3)

Four roles, each above the next: **owner**, **admin**, **moderator**, **member** (ranks 3, 2, 1, 0).
`group_members.role` holds all four; the partial unique index keeps one owner.

**Nobody acts on themselves or on somebody of their rank or above** (the staff's own rule, `outranks`).
So an admin cannot touch the owner or another admin, a moderator cannot touch an admin or a moderator,
and a member touches nobody.

**An admin holds the rights the owner gave them, and no more** (MS-D2). `group_members.rights` is a
list from a closed set, present on an admin's row and on nobody else's (a CHECK):

| Right | Lets an admin |
|---|---|
| `info` | change the name, the photo, the description, the crest and the game |
| `invite` | add people, and make and revoke invitation links |
| `approve` | answer join requests |
| `remove` | remove a member |
| `ban` | ban and unban |
| `delete` | delete somebody else's message |
| `pin` | pin and unpin messages |
| `members` | mute and unmute members, and make or unmake moderators |
| `calls` | start a voice chat whatever the permissions say, end it for everyone, mute, let speak and remove participants |

**Only the owner makes, unmakes and changes admins**, and only the owner changes the group's
permissions, closes or opens its doors, and hands it on. An admin never makes an admin, so nobody can
grant a right they do not hold.

**A moderator's tools are fixed** (MS-D3): delete members' messages, mute and unmute members, and work
the group's reports. They hold no rights list, which keeps the line between the two roles plain:
an admin runs the group, a moderator keeps the conversation in order.

### What members may do (MS-D4)

Eight switches on the group, the owner's to set, read by the server on every act they cover:

| Switch | Default | Off means |
|---|---|---|
| `members_send` | on | only the owner, admins and moderators write (an announcement group) |
| `members_media` | on | only they send photos, videos, files and voice messages |
| `members_add` | on | only the owner and admins with `invite` add people |
| `members_pin` | off | only the owner and admins with `pin` pin |
| `members_info` | off | only the owner and admins with `info` change how the group looks |
| `members_call` | on | only the owner and admins with `calls` start a voice chat |
| `members_join_call` | on | only the owner, admins and moderators join a voice chat |
| `members_speak` | on | members join a voice chat unable to speak until somebody lets them |

`approval` (off by default) makes joining a public group a request. The columns have no default, as
`privacy` has none: `create` writes them (the backfill rule).

### Ownership (MS-D5, MS-D6)

**Handing the group on** (`POST /groups/:slug/owner`): the owner chooses a member, the page says what
moves (everything the owner can do, and that only the new owner can hand it on again), and the server,
in one transaction with the group's row locked, checks the caller is still the owner, that the other is
a member and not suspended, demotes the owner to an admin holding every right, promotes the other, and
writes the log's row. The chat says it (`owner`), the new owner is told (`group-owner`), and the group
is rung. Two transfers at once wait on the lock, and the second is refused because its caller is no
longer the owner. The single-owner index makes two owners unrepresentable; the demotion comes first.

**An owner who leaves hands the group to an heir** (MS-D6): the admin promoted longest ago, else the
moderator, else the longest-standing member; the last member out takes the group with them, as today.
The product deletes no account (suspension is how one is stopped), so ownership moves only by these two
paths; a suspended owner keeps the group until the suspension is lifted.

### Coming in and going out

- **Adding** asks `mayMessage`, as today, and `members_add` or the `invite` right; the page offers
  friends.
- **Invitation links** (MS-D8): `group_invites`, a token of 22 characters from 16 random bytes, made by
  the owner or an admin with `invite`, with an end (an hour, a day, a week, never), a limit of uses
  (1, 10, 100, none), and whether a join through it waits for approval. Revoked or past its end it is a
  link that no longer works, in the same bytes as one that never did. A use is counted in the statement
  that seats the person, so a limit cannot be raced past. The link opens `/app/g/:token`: the group's
  photo, name, description and member count, and Join or Request to join; for a private group the link
  is the only way a stranger sees its name.
- **Join requests** (MS-D9): a link that asks for approval, or a public group with `approval` on, makes
  a request instead of a seat (`group_requests`, one a person a group). The owner and admins with
  `approve` see them, are told (`group-request`, one row a group counting up), and approve (the person
  is seated, told `group-approved`, and the line says they joined) or decline (nobody is told).
- **Removing** is the owner's or an admin's with `remove`, of somebody ranked lower; they may come back.
- **Banning** (MS-D10, `group_bans`) removes and keeps out: no join, no link, no request, no add. Unban
  by the owner or an admin with `ban`.
- **Muting** (MS-D11, `group_mutes`): an hour, a day, a week or until lifted, by the owner, an admin
  with `members` or a moderator, of somebody ranked lower. A muted member reads and reacts but sends no
  line and edits none. The mute outlives leaving and coming back, so it cannot be shed that way.

### In the thread

- **Deleting somebody else's message** (MS-D12): the owner, an admin with `delete` and a moderator
  delete the lines of anybody ranked lower, as the author's own delete does (the tombstone, its
  reactions and edits, its files), and the log says whose. The author is not told.
- **Pinned messages** (MS-D13, `conversation_pins`): in any conversation but a table's. In a direct
  chat either person pins; in a group, the owner, an admin with `pin`, or anybody while `members_pin`
  is on. Twenty at most, newest first. The thread shows the newest under its head and a press steps
  through them; a group's line says who pinned one. The target is in the clear, as a reaction's is; its
  words are opened by each reader.
- **Sending is asked of the group** (MS-D4): `members_send`, `members_media` and a mute are checked in
  the send route, beside the checks it already makes, and the composer says why it cannot send
  ("Only admins can send messages here", "You are muted until 14:30").

### The log (MS-D14)

`group_events`: who (and their role then), the kind, the person and their handle as it was, the details,
when; written in the transaction that makes the change; no route edits or deletes a row. Kinds: created,
joined, left, removed, banned, unbanned, muted, unmuted, role (to admin, moderator or member), rights,
permissions, info, owner, invite (made, revoked), request (approved, declined), deleted (a message),
pinned, unpinned, call (started, ended), report (dismissed or actioned). The owner, admins and moderators
read it, fifty a page by the microsecond keyset.

### The group's reports (MS-D40 to MS-D45)

What the moderators "work" (MS-D3) is a copy, for the group's staff, of a report filed with Nura's team
about a line in the group's room. Nothing new decides what was said: the copy reads the report's own
disclosure, which franking verified when it was filed, so a line deleted or run out since is still the
words the reporter showed, and nobody can put words in somebody's mouth to get them muted.

- **Filing** (MS-D40): the report sheet opened from a line of a group's room asks "Also tell {group}'s
  admins", on by default; with it on, `POST /social/reports` writes `group_reports` (the group, the
  report, the person reported, open) beside the report, in its transaction. A report with no line shown
  goes to Nura's team alone: there would be nothing for the group's staff to look at.
- **Who reads it** (MS-D41): whoever may work reports in the group (`reports`: the owner, an admin holding
  `delete`, a moderator) and outranks the person reported, so a report about a moderator reaches the
  admins with `delete` and the owner, one about an admin the owner, and one about the owner nobody in
  the group. The person reported never sees one about them. To anybody else the copies are not there.
- **The reporter is not named to the group** (MS-D42): the staff are the reporter's neighbours, and a
  name would invite the retaliation a report is for. Nura's team still sees who filed it.
- **Working it** (MS-D43): `GET /groups/:slug/reports?list=&cursor=` (open first by default, fifty a page by
  the microsecond keyset), each the person reported, the category, when, the line as disclosed, and
  whether it is still in the room. From the panel the staff delete the line where they may (the thread's
  own delete, MS-D12) and mute or ban from the member sheet, then close it as "nothing to do"
  (`dismissed`) or "dealt with" (`actioned`): `POST /groups/:slug/reports/:id/close`, the row locked, the
  log's kind `report` with the outcome, in that transaction. A closed copy stays closed; Nura's team's
  report goes on as it was.
- **Telling the staff** (MS-D44): `group-report` in the `groups` category, one row a group
  (`group-report:<group>`) counting up, to each member who reads the copy, leading to the group's
  Reports panel; taken back from whoever has no open copy left to read. The panel's tab counts the open
  copies the reader reads (`reports` on the group's summary, as `requests` is).
- **What a copy shows of a voice message or a file** (MS-D45): what it is ("Voice message (0:12)", the
  file's name), never its content: the file is kept for Nura's team, and the staff hear or open it in
  the thread while it is still there.

### The members list (MS-D15)

`groupSummary` stops carrying every handle. It carries the count, up to six faces (staff first) for the
card and the head, the owner's handle, and the reader's own role, rights and mute. `GET
/groups/:slug/members?q=&cursor=` is the list: the owner, the admins, the moderators, then members by
when they joined, fifty a page, searched by handle and name as the social search folds them; each row
the person as lists draw them, their role, when they joined, and to the staff their mute.

### The photo and the setup (MS-D7, MS-D16)

A group's photo is a picture like a person's: made 512 px in the browser, WebP or JPEG under 64 KiB,
sniffed and kept by hash in `avatars`, so the route that serves pictures serves it; the crest stays for a
group with none. Creating a group asks for the name, a photo, a description, public or private, the
first members (friends, up to fifty) and, folded under "Permissions", the switches at their defaults.

### Real time and notices

A change to a group rings its members (`groups` on the `me` scope and the conversation's `chat`), so a
role, a right, a permission, a mute, a ban or a removal is seen at once and the page reads again. New
kinds of notice: `group-request`, `group-approved`, `group-owner` and `group-report`, under the `groups`
category.

## Part 2: photos, videos and files

### The file (MS-D17)

A file is cut into chunks of 1 MiB. Each chunk is sealed with AES-256-GCM under the file's own key, with
a nonce of an eight-byte random prefix and the chunk's index, and an AAD that names the file, the index
and how many chunks there are, so a chunk cannot be moved, repeated or dropped without the file failing
to open. The key, the prefix, the size and the type travel in the sealed document.

### Where it is kept (MS-D18)

**In Postgres**, as voice notes and pictures are: `chat_files` (the id the browser chose, the uploader,
the kind, the size and how many chunks it declared) and `chat_file_chunks` (one row a chunk). One
database is backed up and restored; nothing else has to be kept in step with it.

The brief prefers direct uploads to object storage with signed addresses. That was weighed and not
taken: it is a second service with credentials of its own, a second thing to back up and keep in step
with the database, for bytes this server cannot read anyway. Chunks give what signed uploads are for:
no request holds more than a chunk, so memory stays flat whatever the file; an upload resumes from the
first chunk the server lacks; and nginx's 8 MiB limit is never approached.

### Upload, resume, cancel (MS-D27)

1. `POST /api/chat/files` `{ id, kind, bytes, chunks }` declares the file: `kind` is `photo`, `video`,
   `file` or `thumb`. Answered with the chunks already kept, so a retry resumes. Refused: `file-size`
   (413), `file-taken` (409, the id is somebody else's), `file-budget` (429, the day's bytes),
   `file-pending` (429, too many files no message names), `file-quota` (429, what one account keeps).
2. `PUT /api/chat/files/:id/:n`, `application/octet-stream`, one chunk, read with a streaming limit;
   every chunk but the last is exactly 1 MiB and 16 bytes. Two or three go at once.
3. The send names the files. A file a message does not name within the hour is let go, and so is one
   whose upload was cancelled (`DELETE /api/chat/files/:id`, its uploader's, while no message names it).

### Fetching, and who may

`GET /api/chat/files/:id` streams the chunks in order, `application/octet-stream`, private and
immutable with the id as its ETag, `nosniff`, `default-src 'none'`. It answers the uploader and anybody
seated in a room holding a live message that names the file, with no block between them and another
member there: the rule voice files follow. Everybody else, and a file not wholly uploaded, is answered
as a file that is not there. A send names only files its sender may fetch, so a forward names the file
and copies nothing. Ids are 122 random bits; nothing about an id authorises anything.

### Limits (MS-D19)

Constants both halves read (`domains/chat/media.ts`, importing nothing):

| | |
|---|---|
| Items in one message | 10 |
| A photo, once prepared | 20 MiB |
| A video, a file | 128 MiB |
| A thumbnail or a poster | 512 KiB |
| A day's uploads | 2 GiB an account |
| Files waiting to be sent | 30 an account |
| What one account keeps | 20 GiB |

File chunks and fetches have a budget of their own beside the api's, so a gallery scrolled quickly does
not spend the budget every other request draws from.

### The message

Kind `media`. The sealed document is `{"media": [item, ...], "text"?: caption, "reply"?, "fwd"?}`; an
item is `{"kind", "id", "key", "iv", "size", "mime", "name"?, "w"?, "h"?, "ms"?, "tone"?, "thumb"?}`
and a thumbnail `{"id", "key", "iv", "size", "w", "h"}`. In the clear beside the envelope the send says
which files the message names, in order, each with its thumbnail (`message_files`: the message, the file,
its place, whether it is a thumbnail, its kind, and the room and time copied in so the gallery reads one
index). The document names them again, so a row moved onto another file opens as tampered. A message is
either up to ten photos and videos together (an album, in the order chosen) or up to ten files, never
both, as Telegram sends them. The caption is a line's words: 500 characters, formatting and mentions.

It counts as a line everywhere a voice message does: unread, the list's last line ("Photo", "3 photos",
"Video", "File: report.pdf"), notifications and push, the senders a read passes, replies, reactions,
forwards and the report.

### What the sender's browser does (MS-D20 to MS-D22)

- **A photo** is decoded upright, drawn at no more than 2560 px on its longer side and encoded again
  (JPEG at 0.86, or WebP, else PNG, where it has transparency), which also drops what the camera wrote
  into it, the place it was taken among it. An animated GIF, WebP or PNG is sent as it is. A thumbnail of
  640 px and the photo's tone go with it.
- **A video** has to play in the sender's browser: its length, size and a poster from its first frame
  are read there. One that does not play is offered as a file. Nothing is transcoded: the server cannot
  see the bytes, and a transcoder in the browser is megabytes.
- **A file** is read for what its bytes are. Accepted: PDF, plain text, Word, Excel and PowerPoint files
  without macros, OpenDocument, RTF, and pictures, audio and video kept as they are. Refused at the
  sender and again at every reader: archives, and anything that runs or renders a page (programs,
  scripts, installers, disk images, shortcuts, HTML, SVG, XML, macro-enabled documents). A box nobody
  here can look inside is a box this chat does not hand over.
- **Choosing**: the composer's attachment button opens Photo or video and File; a photo can be dropped
  on the thread or pasted. Everything chosen waits in a sheet first: the items in order (removed or
  reordered there), a caption, "Send as files" for pictures, and Send. Each item then uploads with its
  own progress, Cancel and Try again, and the message goes when every item is up.

### What every reader's browser checks

After opening the file it reads the bytes again: a picture must decode as a picture, a video's
container must be one the document says, and a file must be a type the allowlist keeps. Anything else is
shown as a file that cannot be opened here and is never offered to save. A download is named for what
its bytes are (the extension follows the type), saved through an object address of a type that renders
nothing, and let go at once.

### In the thread (MS-D21, MS-D24)

- **Photos and videos** are drawn from their thumbnails at their own shape, an album as a grid that
  keeps every item whole; the tone holds the place until the thumbnail opens. The original is fetched
  only when the viewer asks for it.
- **The viewer** opens over the conversation: the original, zoom (wheel, pinch, a double tap), pan,
  the next and the previous of the album and then of the room's media (arrows, swipes), the caption,
  Download, Escape to close.
- **The player** is ours: play, pause, a timeline to seek, the time and the length, volume and mute,
  speed, full screen, the poster, loading, buffering and a failure. A video is fetched and opened whole
  before it plays (a sealed file cannot be read part by part without a service worker standing between
  the page and the server), with progress on its poster; one under 8 MiB is fetched when it comes on
  screen (never under Save-Data), anything larger at the press. Nothing plays by itself, and nothing
  plays with sound unasked.
- **A file** is a row: its type, name, size, Download with progress, and a preview where the browser
  can show one safely (a picture, a video, audio, text as text, a PDF in the browser's own viewer).

### The gallery (MS-D25)

From a conversation's head: Media (photos and videos as a grid), Files and Voice, each fifty a page by
the keyset from the server and drawn as they come on screen, so a room of thousands of messages reads
one index. Files can be searched by name among what has been read, and the field says that. A press
opens the viewer, or the message in the thread.

### Reports (MS-D26)

Reporting a media message with it disclosed keeps its files for the report, as a voice message's is
kept, and the staff's report page shows them, opened in the staff's browser under the disclosed keys.

## Part 3: calls

### Topology (MS-D28)

- **A direct call** is the table voice's engine in a room of its own: a line straight between the two
  browsers where one connects (DTLS-SRTP), carried by this server from the first moment and whenever the
  line drops or never connects. Every part of it that works at a table works here: the playout worklet,
  the gate, RNNoise, the presets, the volume, the voice manager's facts.
- **A group call is carried by this server only.** Each participant sends one stream to the server and
  hears one stream for each person speaking; the server forwards Opus frames and decodes nothing. That
  is a selective forwarding unit, running over the page's own authenticated socket. It also makes the
  staff's controls real: a participant the server will not carry is silent for everybody, whatever their
  browser does, which a mesh cannot promise.

**Why not LiveKit, mediasoup or Janus.** Each would put a second media server beside this one, with UDP
ports opened past nginx, a native module or a second process, credentials of its own, and an operator
to keep it running. The forwarding that exists is already authenticated by the session, measured
(the voice quality pass, the crowd pass's 3,000 sockets) and enforced by the server. Its costs are
stated, not hidden: it rides TCP, so a lossy mobile line is smoothed by the playout's buffer and not by
retransmission at the codec's pace; the server forwards about 40 kbps for each speaker to each
listener; and a call holds at most 50 participants (`GROUP_CALL_MOST`). The forwarding sits behind one
function (`hub.sound`), which is where a WebRTC SFU would plug in if the product outgrows it.

### The call and its states (MS-D30 to MS-D32)

`calls`: the conversation, `direct` or `group`, who started it, `ringing`, `live` or `ended`, when it
was answered and ended, and how (`answered`, `missed`, `declined`, `busy`, `cancelled`, `failed`).
One call is open in a room at a time (a partial unique index) and a person is in one call at a time.
`call_participants`: who joined, when, when they left, and the moderation a reconnect must not shed
(held, a raised hand, removed).

Every change is a conditional update from the state it expects, so a repeated accept, decline or hang
up changes nothing the second time, and nothing is ever written twice.

| Brief | Here |
|---|---|
| IDLE | no call |
| INITIATING | the caller's request is on its way |
| RINGING | `ringing`, delivered to a page of the callee's |
| ACCEPTED | `live`, answered |
| CONNECTING | in the call's room, nobody heard yet |
| CONNECTED | the other is heard (a carried call counts from its first moment, as at a table) |
| RECONNECTING | the socket or the line dropped and is being brought back |
| ENDED, REJECTED, MISSED | `ended` as `answered` or `cancelled`, `declined`, `missed` |
| FAILED | `ended` as `failed`, or a refusal |

- **Ringing lasts 45 seconds** (`RING_SECONDS`), then the call is missed. A callee who is in a call, or
  being rung by somebody else, is busy, and the call ends at once as `busy`. A caller already in a call
  cannot start another.
- **The callee's every page rings**, and a page that connects while the call rings is told at once. A
  push wakes a device with no page open (`call`, which the worker says as "Sara is calling"). Answered
  on one device, the others stop.
- **A live direct call ends** at a hang up, or 30 seconds after either side left the room and did not
  come back (a reload or a dropped socket comes back inside that). **A group call ends** when somebody
  with the right ends it for everyone, or two minutes after its last participant left.
- **Who may call** (MS-D29): a direct call rings only between friends, with no block and nobody
  suspended; a minor is never rung by a stranger. A group call is for its members, under the
  permissions; inside it the per-pair rule of table voice holds, so somebody a minor may not talk with
  is neither heard nor hears them.

### Inside a group call (MS-D33)

Join and leave freely. Mute and unmute oneself. Raise a hand. Somebody with the `calls` right (and the
owner) can mute a participant or everybody below them, which the server enforces by not carrying them
until they are let speak; let a raised hand speak; remove a participant, who cannot come back into that
call; and end it for everyone. With `members_speak` off, members join unable to speak and raise a hand.

### The hub

A voice room is named by the frame's `room` (it was `table`): a table's id as before, or `call:<id>`.
`voiceRoom(user, room)` answers whether they may be in it and how: a table's call as today, or a call
that is live in a conversation they belong to, with whether a line may be tried (a direct call) and
whether they are held. A group call's `sound` goes to everybody in the room who may talk with the
sender, and never from somebody held. Joining and leaving a call's room is written to its participants
and rings the call. Calls ring by a `call` nudge, and a page reads `GET /api/calls/:id`.

### ICE (MS-D36)

As at a table, a line is tried with no ICE server: two browsers on one network connect directly, and
two behind different routers are carried by this server, so every call works. An operator who wants
more calls on direct lines can give coturn's address and shared secret (`VOICE_TURN_URLS`,
`VOICE_TURN_SECRET`, both or neither, written empty by default); the server then hands each joining
credentials that end in six hours (coturn's REST scheme), never the secret. `docs/operations/
self-hosting.md` says how to run it.

### What a call promises (MS-D37)

Calls are encrypted on the way: DTLS-SRTP on a direct line, TLS to the server when carried. **They are
not end-to-end encrypted.** This server passes a carried call on and could hear it; a group call is
always carried. Nothing is recorded or kept. Signalling rides the authenticated socket, the server
decides who is in which call from its own records, and a frame that names a call the sender is not in
goes nowhere. The page says calls are "encrypted on the way, not end to end".

### In the browser (MS-D38, MS-D39)

- **Calling**: the call button in a direct chat's head and on a friend's sheet. An outgoing card says
  Calling, then Ringing once a page of theirs has it, then Connecting and the time, with mute and hang
  up; a ringback plays meanwhile.
- **Being called**: a card over whatever page is open (the whole screen on a phone) with the caller's
  picture and name, Accept and Decline, and a ringtone under the device's sound switch. The ringtone and
  the ringback are made here, offline, like the looks' voices.
- **In a call**: a bar across the top of every page (the person or the group, the time, mute, hang up),
  pressed for the call's own view: the people, speaking rings, muted and held marks, raised hands, how
  good each line is (the voice manager's facts), the microphone and the speaker, and for the staff each
  participant's controls and End for everyone.
- **A group's head** shows a live voice chat (its faces and count, and Join) to anybody who opens it.
- **The chat says what happened** (MS-D34): one line in a direct chat when a call ends ("Outgoing call ·
  5:12", "Missed call", "Declined", "Cancelled", "Busy"), said from the reader's side, a press offering
  to call again; in a group "Sara started a voice chat" and "Voice chat ended · 12 min".
- **Notices** (MS-D35): `call` while it rings, turned into `call-missed` under the same key when it is
  missed or the caller gives up; `group-call` when a voice chat starts. A category of their own,
  `calls`. The card on an open page rings whatever the bell is set to: it is the call, not a notice.
- **History**: a Calls tab on the chats page, newest first, thirty a page: the person or the group, in
  or out, how it ended, how long, and Call back.

## Decisions

| | Decision | Default |
|---|---|---|
| MS-D1 | Roles | owner, admin, moderator, member; act only on somebody ranked lower, never on oneself |
| MS-D2 | Admin rights | nine (`info`, `invite`, `approve`, `remove`, `ban`, `delete`, `pin`, `members`, `calls`), chosen by the owner one by one; only the owner makes or changes admins |
| MS-D3 | Moderators | fixed: delete members' messages, mute members, work the group's reports; made by the owner or an admin with `members` |
| MS-D4 | Member permissions | eight switches (send on, media on, add on, pin off, info off, start a call on, join a call on, speak on); `approval` off |
| MS-D5 | Transfer | atomic under the group's lock; the old owner becomes an admin with every right; the new owner told; the log's row |
| MS-D6 | An owner leaving | the oldest admin, else moderator, else member takes it; no account is deleted by the product |
| MS-D7 | Group photo | a picture in the pictures store, 512 px, 64 KiB at most; the crest when there is none |
| MS-D8 | Links | 128-bit tokens; ends and limits of uses; approval per link; revoked or ended answers as never made |
| MS-D9 | Requests | one a person a group; answered by the owner or an admin with `approve`; an approval tells, a refusal does not |
| MS-D10 | Bans | remove and keep out of every way in; lifted by the owner or an admin with `ban` |
| MS-D11 | Mutes | an hour, a day, a week or until lifted; reading and reacting go on; survives leaving |
| MS-D12 | Deleting others' messages | the owner, admins with `delete`, moderators; lines of somebody ranked lower; the author not told |
| MS-D13 | Pins | every conversation but a table's; twenty at most; the bar under the head |
| MS-D14 | The log | append only, the staff of the group read it, fifty a page |
| MS-D15 | Members | paged by the server, staff first, searched by handle and name; the summary keeps six faces |
| MS-D16 | Creating a group | name, photo, description, privacy, first members, permissions folded |
| MS-D17 | Media sealed | a fresh key a file, 1 MiB chunks, nonce and AAD bound to the file, the index and the count |
| MS-D18 | Storage | Postgres chunk rows; no object storage |
| MS-D19 | Limits | ten items; photo 20 MiB, video and file 128 MiB, thumbnail 512 KiB; 2 GiB a day, 30 unsent, 20 GiB kept |
| MS-D20 | Photos | re-encoded upright, metadata dropped, 2560 px; animations as they are; thumbnail 640 px and a tone |
| MS-D21 | Videos | no transcoding; must play in the sender's browser or go as a file; fetched whole, under 8 MiB on sight |
| MS-D22 | Files | an allowlist read from the bytes at both ends; archives and anything that runs or renders refused |
| MS-D23 | What the server learns | each file's kind and how many a message carries, for the gallery |
| MS-D24 | Viewer | over the conversation; zoom, pan, swipe and arrows; original fetched only there |
| MS-D25 | Gallery | Media, Files, Voice; fifty a page from one index |
| MS-D26 | Reports | keep a media message's files; the staff see them |
| MS-D27 | Uploads | resumable by chunk, progress, cancel, try again; a day's budget of their own for requests |
| MS-D28 | Call topology | direct: a line or carried; group: carried only (SFU over the socket), 50 at most |
| MS-D29 | Who may call | friends for a direct call; members under the permissions for a group call; the pair rule inside |
| MS-D30 | States | `ringing`, `live`, `ended` with how; conditional updates, so nothing happens twice |
| MS-D31 | Ringing | 45 s; busy when in or being rung for another call |
| MS-D32 | Ending | direct: hang up, or 30 s alone; group: ended by the right, or 2 min empty |
| MS-D33 | Group call controls | mute, mute all, let speak, raise a hand, remove, end for everyone |
| MS-D34 | Lines | one at a direct call's end from the reader's side; started and ended in a group |
| MS-D35 | Notices | `call`, `call-missed`, `group-call` in a `calls` category; the ring on a page is the call itself |
| MS-D36 | ICE | none by default; optional coturn by shared secret, credentials of six hours |
| MS-D37 | Encryption | on the way, not end to end; said so on the page |
| MS-D38 | Call UI | card, bar, call view, ringtone and ringback made here |
| MS-D39 | History | a Calls tab, thirty a page |
| MS-D40 | A group's reports | a copy of a report about a line in its room, asked for in the report sheet (on by default), reading the report's verified disclosure |
| MS-D41 | Who reads a copy | whoever may work reports and outranks the person reported; nobody in the group for the owner |
| MS-D42 | The reporter | never named to the group's staff; Nura's team sees them |
| MS-D43 | Working one | the line deleted, a mute or a ban from the usual places, then closed as dismissed or actioned, logged as `report` |
| MS-D44 | Telling the staff | `group-report` in `groups`, one row a group, taken back once nothing is left open for them |
| MS-D45 | Voice and files in a copy | said as what they are, never opened for the group |

## Not in this work

Video calls and screen sharing; recording a call; scheduled voice chats; streaming a sealed video while
it downloads (a service worker would have to stand between the page and the server); transcoding on
either side; a link to a group opened by somebody signed out shows the sign-in first; stickers, GIF
search and link previews; choosing several messages at once; topics, slow mode and broadcast channels;
end-to-end encrypted calls (each line's fingerprint would have to be signed with the device key, and a
carried call encrypted frame by frame under a key the room's devices share).

## Phases, each its own commit with specs, faults put in one at a time, the sized checks, a build in the copy and a walk

Groups: **G1** the schema; **G2** roles, rights, rank, permissions, transfer and the heir, the photo and
the information, add, remove, ban, mute, the log and the members list on the server, and sending asked
of the group; **G3** links and requests; **G4** pins and deleting others' messages; **G5** the group's
pages (head, members, admins and rights, permissions, links, requests, banned, the log) and the new
setup; **G6** the thread (the pin bar, the staff's delete, the composer that says why it cannot send);
**G7** the group's reports (the schema, the server, then the panel and the report sheet's switch).

Media: **M1** the schema; **M2** files, chunks, fetching, budgets, the sweep, the media message, the
gallery read and reports keeping files on the server; **M3** sealing in chunks, the upload queue, the
composer's attachments and the sheet before sending; **M4** the bubbles, the viewer, the player and the
file row; **M5** the gallery; **M6** media in the staff's report page.

Calls: **C1** a voice frame names its room; **C2** the schema; **C3** direct calls on the server (the
states, the ring, the sweep, lines, notices, push); **C4** direct calls in the browser (the call store,
the cards, the bar, the call view, the sounds); **C5** group calls on the server (rooms carried only,
held, hands, the controls); **C6** group calls in the browser; **C7** the Calls tab; **C8** the optional
TURN server.

Proof: **P1** `tools/qa/media-pass.mjs`, `call-pass.mjs` and `group-pass.mjs`, and the garbage pass
taught every route; **P2** the notes, the self-hosting guide, the full gates and the report.

## Verification

- Unit and component specs for each part, in both languages where words are drawn.
- Database specs on a disposable Postgres: every refusal and the rank rule against every role; two
  transfers at once and exactly one owner after each; a link's limit raced; a ban against every way in;
  a mute against every send; uploads resumed, refused, swept and fetched only by whoever may; a media
  message's files through deletion, expiry and a report; a call's every transition repeated and raced;
  ringing timed out by the sweep; busy; a group call's moderation surviving a reconnect.
- Passes on the built server between real browsers: photos, an album, a video and a file sent and
  opened, the viewer, the gallery, a stranger's fetch refused, an upload cancelled and resumed; a direct
  call rung, accepted, declined, cancelled, missed, busy and cut, with fake microphones heard both ways;
  a group call of four with a mute, a removal, a raised hand and an end, and a join refused to a
  non-member and a banned member; the group's roles, rights, transfer, links, requests, bans and log over
  the api, with every escalation refused.
- The gates: `npm run check`, both suites and a shuffled run, every database spec, the build in budget,
  and walks at 390 in Persian and 1280 in English.
