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
- **Photos, videos and files came with a merge** while this design was being built (see Part 2): one
  sealed file a message, up to 50 MiB, in Postgres beside the voice notes, with a caption.
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

### What the merge brought, and what this work keeps (MS-D17 to MS-D21, MS-D27)

While the groups were being built, `origin/main` brought photos, videos and files to the chat
(`2026-11-02-chat-files-design.md`, CF-D1 to CF-D10, merged as `d3d5d016`), and this design was written
before it. The two agree on everything that matters (each file sealed in the sender's browser under a key
of its own that travels in the sealed document, ciphertext in Postgres beside the voice notes, the
uploader and the people of a room holding a live message naming the file the only ones who may fetch
it, a photo re-drawn on a canvas so its EXIF and its GPS fix do not survive, a video's poster and length
measured where it plays), so what was built stays and this part adds what the brief asks for that it
does not have. What it keeps, and what the decisions below now say:

- **One file a message, sealed whole** (MS-D17): one AES-GCM call over the file, AAD `nura-e2ee/v1 ␟
  file ␟ fileId`, the key, the iv and the id in the message's document; kind `file` with `file_id`.
  The chunked sealing this design first chose (1 MiB pieces, a file resumed by the chunk) would let a
  file pass 50 MiB and an upload resume halfway; it is left for later (MS-D27), because every file the
  limits allow is in memory twice at most, 100 MB, which a phone holds.
- **Postgres** (MS-D18): `chat_files`, a table of its own beside `voice_notes`, the same rules spelled
  once for both. Not object storage, which the brief prefers where it fits: here it would be a second
  service with credentials of its own, to back up and keep in step, for bytes this server cannot read.
- **The limits** (MS-D19) are the owner's: 10 MiB a photo as sent, 50 MiB a video or a file, 1 GiB a
  day, 10 uploads waiting, 1,024 characters a caption; to them this work adds ten items an album.
- **Nothing is fetched until the reader asks** (MS-D21), the owner's own word for the chat files: a
  photo or a video says its size, and a video its length, before it is downloaded; a blurred thumb of
  40 px in the document keeps its place.
- **Uploads** (MS-D27): a raw `PUT` a file with its progress, Cancel, Try again (which sends only what
  the server lacks), the hour's hold and the minute's sweep.

### What this work adds

- **Albums** (MS-D46): up to ten photos and videos sent together, in the order chosen, drawn as one
  bubble.
- **The viewer** (MS-D24): over the conversation, with zoom and pan, the album's next and previous and
  then the room's, the caption, Download, the keyboard and a finger.
- **The player** (MS-D47): ours, in the bubble and in the viewer, in place of the browser's controls.
- **The files that may be sent** (MS-D22): read from their bytes at both ends, never anything that runs
  or renders a page, never a box nobody can look inside.
- **The composer's attachments** (MS-D48): one button that offers photos and videos (several at once,
  and the camera on a phone) or a file; several dropped or pasted at once.
- **The gallery** (MS-D25): a conversation's photos and videos, its files and its voice messages.
- **The staff's report page shows a reported photo, video or file** (MS-D26), which the merge kept for
  them without a way to look at it.

### Albums (MS-D46)

Telegram's own shape: an album is up to ten messages of kind `file`, each naming its own photo or video
as one does now, sent together and grouped by an album id. Every rule the merge spelled for a file (who
may fetch it, when it goes, a report that keeps it, a forward that names it) holds for each item
unchanged, which is why it is this shape and not one message naming ten files.

- **The id is the sender's** (a uuid, `messages.album_id`, in the clear, as a reaction's target is), and
  each item's sealed document says it again with the item's place, how many there are and what they
  are (`"album": { "id", "at", "of", "holds" }`, `holds` being `photo`, `video` or `both`, so the one
  item the list's last line is can say "4 photos"), so a server that moved an item into another album,
  or out of its own, makes a document that disagrees with its row, and the reader draws that item alone.
  Each item is sealed with the next number after the one before it, under one read of the epoch, and
  signed a millisecond after it, so the order chosen is the order signed.
- **Sent in one request** (`POST /api/chat/:id/album`, two to ten sealed messages, every upload done
  first): written in one transaction, so nothing comes between its items in the thread and a reader is
  rung once. Each item is the sender's, of kind `file`, a photo or a video, under the room's rules, with
  a file the sender may name; anything else refuses the whole album.
- **The caption is the first item's** and the album's; the others carry none.
- **In the thread** the items are one bubble, a grid that keeps every item whole: one, two side by side,
  three as one and two, and so on to ten, each its thumb and its size until it is asked for. "Download
  all" fetches them one after another; a press opens the viewer there.
- **What is done to an album is done to it whole**: a reply quotes it ("Album, 4 photos"), a reaction
  is the first item's, a forward sends it again as an album, and Delete deletes every item (the sender's,
  or the staff's in a group). A report is the one exception: a disclosure is exactly one message, so an
  album is reported item by item, from the item the reader is looking at.
- **Counted as what it is**: unread counts each item, as Telegram does; the list's last line says "4
  photos", "3 videos" or "5 photos and videos".

### The viewer (MS-D24)

A photo or a video pressed opens over the conversation (`components/chat/media-viewer`, a chunk of its
own): the original, fetched and opened then with its progress; zoom by the wheel, a pinch or a double tap,
up to four times; pan by dragging while zoomed; the album's next and previous by the arrows, a swipe or
the buttons at its sides, and then the room's photos and videos as the gallery lists them; the caption
under it; Download, which saves it under its name; Escape, a press outside or a swipe down to close,
with the keyboard back where it was. A video plays in it with the player. The originals of the item
shown and its neighbours are kept while it is open and let go when it closes.

### The player (MS-D47)

`components/chat/media-player`: the poster, then the video once fetched and opened (whole: a sealed file
cannot be read part by part without a service worker between the page and the server); play and pause,
a timeline to seek with the time and the length, volume and mute, speed (1×, 1.5×, 2×), full screen,
and its states said (loading with progress, buffering, a failure with Try again). It never plays by
itself and never with sound unasked; a finger has the same controls, at a size a finger hits. In the
bubble it is the same player, smaller, and the viewer opens it larger.

### The files that may be sent (MS-D22)

The server cannot see a byte, so this is done where the bytes are, at both ends, from the bytes and
never from a name or a type the picker says (`lib/file-kind.ts`, read by the sender and every reader):

- **Sent as they are**: PDF, plain text, Word, Excel and PowerPoint files without macros, OpenDocument,
  RTF, and pictures, audio and video kept as files.
- **Refused at the sender, and at every reader saved never**: archives (ZIP that is not an Office or
  OpenDocument file, RAR, 7z, tar, gzip), anything that runs (Windows, Linux and macOS programs,
  installers, scripts, shortcuts, disk images, Java, Android and iOS packages) and anything that renders
  a page (HTML, SVG, XML, macro-enabled Office files). A box nobody here can look inside is a box this
  chat does not hand over, and the sheet says why in the reader's words.
- A reader whose browser finds a received file to be one of those says so on its bubble, as an alarm,
  and offers nothing to save.

### The composer's attachments (MS-D48)

The paperclip opens a small menu: **Photo or video** (several at once, the phone's own gallery, and on a
phone **Camera** as well) and **File**. Several dropped on the composer or pasted at once are taken
together. The sheet before sending lists everything chosen in order, each removable and moved by a drag
or by the keyboard, with the caption, "Send as files" for photos and videos, and what cannot go said at
once. Photos and videos chosen together go as an album; files go one message each, the caption on the
last.

### The gallery (MS-D25)

From a conversation's head and from the sheet about a group: **Media** (photos and videos, a grid),
**Files** and **Voice**, each fifty a page newest first (`GET /api/chat/:id/media?kind=&cursor=`, keyset
over the microsecond `(created_at, id)`), drawn as they come on screen from the same sealed rows the
thread reads, so each item is opened here and nothing about it is told to the server. For the server to
page Media apart from Files it keeps what each file was sent as (`messages.file_as`, `photo`, `video` or
`file`, in the clear, MS-D23), which every reader holds to the document's own `as`. Files are searched by
name among what has been read, and the field says so. A press opens the viewer, or the message in the
thread.

### Reports (MS-D26)

A reported photo, video or file is kept for the staff (`reports.file_id`, as the merge built it), and the
staff's report page now shows it: the photo and the video opened in the staff's browser under the
disclosed key from a route of their own (`GET /api/admin/reports/:id/file`, beside the voice route), the
file offered to save once its bytes pass MS-D22. Nothing is fetched until it is asked for: a photo or a
video waits behind its thumb, blurred, so nobody on the staff is shown it by chance (MS-D49).

### What the server learns (MS-D23)

Beside who sent what, when and how large, which it knew: which messages form an album and how many
items it has, and whether each file was sent as a photo, a video or a file.

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
| MS-D17 | Media sealed | as the merge built it: a fresh key a file, the file sealed whole, AAD bound to the file; kind `file` with `file_id` |
| MS-D18 | Storage | Postgres, `chat_files` beside `voice_notes`; no object storage |
| MS-D19 | Limits | the owner's: photo 10 MiB, video and file 50 MiB, 1 GiB a day, 10 unsent, 1,024 characters a caption; ten items an album |
| MS-D20 | Photos | re-drawn on a canvas, which drops EXIF and GPS, 2560 px; GIF and SVG go as files |
| MS-D21 | Videos | not transcoded; poster, length and size measured where it plays; nothing fetched until the reader asks |
| MS-D22 | Files | read from the bytes at both ends: documents, pictures, audio and video go; archives and anything that runs or renders a page never |
| MS-D23 | What the server learns | which messages form an album, and whether each file was sent as a photo, a video or a file |
| MS-D24 | Viewer | over the conversation; zoom, pan, the album and then the room by arrows and swipes; Download; originals fetched there |
| MS-D25 | Gallery | Media, Files, Voice from a conversation's head; fifty a page by the keyset from the server; opened in the browser |
| MS-D26 | Reports | keep a reported file (the merge did); the staff's report page shows it, opened under the disclosed key |
| MS-D27 | Uploads | a raw `PUT` a file with progress, Cancel and Try again; chunked and resumable uploads past 50 MiB not in this work |
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
| MS-D46 | Albums | Telegram's shape: two to ten photo and video messages sent in one request, grouped by the sender's album id (in the clear, and in each document with its place, its count and what it holds); the caption the first item's; one bubble |
| MS-D47 | Player | ours: poster, play and pause, a timeline, the time, volume and mute, speed, full screen, its states; never plays by itself |
| MS-D48 | Attachments | the paperclip's menu: photo or video (several, and the camera on a phone) and file; a sheet that orders, removes and captions |
| MS-D49 | A reported photo or video on the staff's page | behind its thumb, blurred, until a member of the staff asks for it, and fetched only then; judged by its bytes as a reader's browser judges it |

## Not in this work

Video calls and screen sharing; recording a call; files past 50 MiB, sealed and uploaded in chunks; scheduled voice chats; streaming a sealed video while
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

Media, re-planned on top of what the merge built (Part 2): **M0** this plan; **M1** the schema
(`messages.album_id`, `messages.file_as`, the gallery's index); **M2** the server (an album sent in one
request, the gallery read, `file_as` held to a file); **M3** albums in the browser (sealing and sending
them, the bubble's grid, what is done to an album); **M4** the viewer and the player; **M5** the files
that may be sent and the composer's attachments; **M6** the gallery; **M7** a reported file on the
staff's report page.

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
  a mute against every send; an album written whole or not at all, and held to its sender, its room and
  its kind; the gallery's pages across a millisecond; a call's every transition repeated and raced;
  ringing timed out by the sweep; busy; a group call's moderation surviving a reconnect.
- Passes on the built server between real browsers: photos, an album, a video and a file sent and
  opened, the viewer, the gallery, a stranger's fetch refused, an upload cancelled and tried again, a file that runs refused; a direct
  call rung, accepted, declined, cancelled, missed, busy and cut, with fake microphones heard both ways;
  a group call of four with a mute, a removal, a raised hand and an end, and a join refused to a
  non-member and a banned member; the group's roles, rights, transfer, links, requests, bans and log over
  the api, with every escalation refused.
- The gates: `npm run check`, both suites and a shuffled run, every database spec, the build in budget,
  and walks at 390 in Persian and 1280 in English.
