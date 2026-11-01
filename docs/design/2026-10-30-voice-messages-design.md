# Voice messages

The owner, 2026-10-30, pasted a brief for a complete voice messaging system inside the chat, "similar
in functionality and usability to Telegram's voice messaging experience": record with one press, a
live timer and waveform, pause, preview, re-record and send; a player in every bubble with a real
waveform, seeking by pointer and touch, and 1x, 1.5x and 2x; delivery in real time through the
existing chat; persistence, permissions by conversation membership, upload progress, retries, limits,
backend validation, themes, accessibility, and tests of the whole journey.

This document is the design. Decisions are numbered VM-D1 onward; each is a default taken here that
the owner may overturn.

## What exists, and the one constraint that shapes everything

**Every message in this chat is sealed end to end** (`nura-e2ee/v1`, `.claude/rules/chat-and-keys.md`).
A line is AES-256-GCM under a per-sender key derived from the room's epoch key, signed by the sending
device, with the kind, the time, the expiry and a franking commitment bound into its AAD. The server
stores ciphertext and an envelope; it cannot read a word. The previous chat plan left voice messages
out for exactly this reason (CH-D13: "sealed files need an encrypted store, quotas and a moderation
story of their own").

So a voice message is sealed too. The alternative, audio the server can read beside words it cannot,
would be the first plaintext a person writes in a room that says on its face that it is sealed.

That decides what "validate audio files on the backend" can mean (the brief's §9). The server never
sees the audio, its format, its duration or its waveform, so it cannot check them and does not pretend
to. It checks everything it can see: who uploads, how much, how often, that the bytes are within
bounds, that a message names a file its sender may name, and that only the people in a room holding a
live message that names a file can fetch it. The format, the duration and the waveform are checked
where they can be: in the browser that opens the message, which authenticates the file under the key
its sender signed, sniffs the container from its bytes rather than from the claimed type, and measures
the duration of what it decoded rather than trusting the number it was handed.

What else exists and is reused:

- The send path: the browser picks a message id, seals, posts; the line is in the thread at the press
  with a clock, ✓ once stored, ✓✓ once read; Not sent with Try again and Delete (the outbox in
  `chat.store.ts`). A send rings the room (`chatChanged`), writes message notifications and wakes push.
- The bubble (`MessageBubble`), built once and kept through every re-read; the hover bar, the
  right-click menu, the held press, the swipe to reply, reactions, Forward, Delete.
- Binary in Postgres: pictures are `avatars.bytes` (bytea), served by a raw route in `app.ts`.
- The framework's streaming body reader with a limit (`readRaw`), the cross-site write refusal
  (`sameSiteWrites`), the per-address limiter.
- Settings › Voice: the microphone chosen for calls (`voiceMic`), its echo, noise and gain choices,
  and the speaker (`voiceSpeaker`).
- One theme, Arena Blue, and nothing that could hold a second (`frontend/CLAUDE.md`): every colour is
  a token on `:root`.

## How it works

```
 recorder (browser)                         server                              reader (browser)
   MediaRecorder -> Blob (webm/ogg/mp4)
   decode -> real duration, 64-bar waveform
   fresh AES-256-GCM key K, iv; seal(audio)
   PUT /api/chat/voice/:fileId  -------->  voice_notes(id, uploader, bytes)
        (ciphertext, progress, retried)    size, rate, budget checked
   seal {voice:{id,key,iv,mime,ms,wave,bytes}}
   POST /api/chat/:room/messages  ------->  kind 'voice', voice_id = fileId     -- ring --> re-read page
        kind 'voice', voice: fileId          sender may name that file           open doc (id must match)
                                             notifications, push                  press play:
                                                                                   GET /api/chat/voice/:id
                                             member of a room with a live  <----   (only ciphertext)
                                             message naming the file            open with K, sniff, decode
```

### The file

- **One fresh key a recording** (VM-D1). The browser makes a random AES-256-GCM key and a 96-bit iv,
  encrypts the recording with the AAD `nura-e2ee/v1 ␟ voice ␟ fileId` (composed in `chat/envelope.ts`
  with the separator every other AAD uses), and uploads only the ciphertext. The key, the iv and the
  file's id travel inside the sealed document of the message, so only the room's devices can read
  them, and the message's signature covers them.
- **The id is the browser's** (a uuid chosen before encrypting, bound into the AAD), so a retried
  upload is the same file and a retried send names it again. Nothing about the id authorises anything.
- **Stored in Postgres** (VM-D2): `voice_notes (id, uploader_id, bytes, size, created_at)`, the way
  pictures are. A dump carries it and a restore brings it back; there is no folder to configure, back
  up or keep in step with the database.

### Uploading, then sending (VM-D3)

Two requests, as every messenger with files does it:

1. `PUT /api/chat/voice/:id`, `application/octet-stream`, the ciphertext as the body, read with a
   streaming limit (a lying `Content-Length` cannot push past it). Answered `201 { id, size }`, or
   `200` when the same uploader already stored that id (a retry), or `409 voice-taken` when the id is
   somebody else's. Refused before the body is read: not signed in (401), a wrong type (415), a
   malformed id (404). Refused once it is read: too small or too large (413 `voice-size`), over the
   day's budget (429 `voice-budget`), too many uploads not yet sent (429 `voice-pending`).
2. The ordinary send, `POST /api/chat/:room/messages`, with `kind: 'voice'` and `voice: <file id>`
   beside the envelope. The file id is in the clear, as a reaction's target is, because the server
   has to know which file a message names to decide who may fetch it and when it can go; and the
   sealed document repeats it, so a server that moved a message onto another file produces a document
   whose id disagrees with the row, which the reader refuses as tampered.

A failed send retries without uploading again. An upload nobody sends is let go an hour later.
Nothing large goes through the realtime socket: the socket says what it always says (the room
changed) and the reader reads the page.

### Who may fetch a file (VM-D4)

`GET /api/chat/voice/:id` answers the ciphertext to:

- its uploader, so the sender's own line plays wherever they open it; and
- anybody who is a member of a room holding a LIVE message (not deleted, not run out) that names the
  file, with no block between them and another member of that room, the rule every read of a room
  applies.

Anybody else is answered exactly as a file that does not exist (404), because a private thing
answers as a missing one. The answer is `application/octet-stream`, `private, max-age=31536000,
immutable` with the id as its ETag (the ciphertext never changes), `nosniff` and `default-src
'none'`.

**A sender may name a file they can fetch.** The same rule, asked at the send: their own upload, or a
file a live message in one of their rooms names, which is what a forward is. A forward therefore
references the file rather than copying it.

### How long a file lives

- Deleting a voice message for everybody leaves the usual tombstone, which names no file, and deletes
  the file in the same transaction when no other live message names it.
- A message that runs out is deleted by the minute sweep, and the sweep deletes the files only it
  named in the same transaction.
- Anything else (an upload never sent, a room deleted with everything in it) is let go by the
  minute sweep once no message names it and it is an hour old.

### Limits (VM-D5)

Constants both halves read (`backend/src/domains/chat/voice.ts`, which imports nothing):

| | |
|---|---|
| Longest recording | 10 minutes; the recorder stops itself there |
| Shortest recording | 1 second; anything shorter is discarded, as Telegram does |
| Largest file | 6 MiB of ciphertext (32 kbps Opus is 2.4 MB in ten minutes; the room is for browsers that ignore the bitrate asked for) |
| A day's uploads | 200 MiB an account |
| Uploads waiting to be sent | 10 an account |

The proxy has to let a 6 MiB body through: nginx's default `client_max_body_size` is 1 MB, so the
README's server block sets 8m.

## The message

- **Kind `voice`**, sealed exactly as `text` is (every column of the envelope, the CHECKs that hold
  them), with `voice_id` naming the file; a CHECK keeps `kind = 'voice'` and `voice_id is not null`
  together, so a tombstone names nothing.
- **The document** (`lib/body.ts`, the only thing that writes or reads one):
  `{"voice":{"id","key","iv","mime","ms","wave","bytes"},"reply"?,"fwd"?}`. `ms` is the duration the
  recorder measured, `wave` 64 levels (0 to 63, one base64url character each), `bytes` the plaintext
  size, `mime` what was recorded. A document that is not exactly that shape opens as `tampered`.
- **Counted as a message**: unread, the list's last line, the cue, the notification and push all
  treat it as they treat a line. A voice message cannot be edited (there are no words to change); it
  can be replied to, reacted to, forwarded, deleted and reported.
- **Played** (VM-D10): `voice_plays (message_id, user_id, played_at)`. A reader who starts one marks
  it (`POST /api/chat/:room/messages/:id/played`); the page read says `played` on a voice message
  the reader has played and `heard` on one of the reader's own that somebody else has. A dot beside
  the duration says "not played yet" until then, for the receiver as for the sender, as Telegram's
  does. The first play rings the sender, whose dot goes.

## Recording (VM-D8)

- **The microphone is where Send is** while the field is empty, as in Telegram; a word typed turns it
  back into Send. One press starts recording. The first press asks the browser for the microphone,
  with the device, echo, noise and gain choices of Settings › Voice.
- **While recording the composer's row becomes the recorder's**, the same height and width:
  Delete (discard), a red dot that breathes and the time, the live waveform of what the microphone
  hears, Pause, and Send. Pause stops the recording where it is and shows what was said so far as a
  waveform that plays and seeks; Resume carries on recording into the same message; Send sends.
  Stopping, the recording stays as a preview with the same controls and Record more.
- **What is said is the recording's**: the stored waveform is drawn from the decoded recording (its
  loudness in 64 slices, scaled to its own loudest slice), the duration is the decoded one. If the
  browser cannot decode what it recorded, the waveform comes from the levels the microphone gave
  while recording; nothing is ever invented.
- **States, each in words**: asking for the microphone; recording; paused; the preview; a recording
  too short (said, and dropped); refused ("Microphone access is off for this site: allow it in the
  browser's settings to record"); no microphone; this browser cannot record audio. A screen reader
  hears each change (a polite live region), not every second of the timer.
- **Formats** (VM-D6): the first type the browser's MediaRecorder supports of `audio/webm;codecs=opus`,
  `audio/ogg;codecs=opus`, `audio/mp4;codecs=mp4a.40.2`, `audio/mp4`, at 32 kbps, mono. Nothing is
  assumed.
- **Resources**: the microphone's tracks are stopped and the audio graph closed the moment recording
  stops, is discarded, or the recorder is torn down; a preview's object URL is revoked when it is sent
  or discarded.
- **Leaving the conversation keeps what was recorded** (VM-D9): recording stops and the recording
  waits as that room's preview, for as long as this tab lives, the way a typed draft does. Signing
  out throws every preview away with the rest of the plaintext.

## Sending

Send makes the line at once, in the thread and the list, with its waveform and duration and a clock
that fills as the upload goes; ✓ once the server has stored the message, ✓✓ once it is read. A
failure leaves it marked Not sent with Try again (which uploads again only what the server does not
have) and Delete. The ids are chosen once, so a second press, a retry or a lost answer can never make
two messages. Nothing says it was sent before the server has it.

## The player (VM-D10)

- **A bubble shows the voice message whole without fetching anything**: play, the waveform, the
  duration, the played dot. The audio is fetched on the first press, opened, sniffed and decoded; the
  play button carries a spinner meanwhile, and a file that cannot be fetched or opened says so on the
  bubble with Try again (a file that does not authenticate is an alarm, as a tampered line is).
- **One voice plays at a time**, through one audio element the whole tab shares; playing another
  pauses the first, which keeps its place. When one ends, the next voice message below it that the
  reader has not played starts (Telegram's run of voice messages); the end of a message puts it back
  at its start.
- **Seeking**: press, drag or touch anywhere on the waveform; with the keyboard the waveform is a
  slider (arrows five seconds, Page keys a fifth, Home and End). The played part is drawn in the
  bubble's strong colour and the rest in its quiet one, and the current time replaces the duration
  while it plays.
- **Speed**: a chip on the voice message being played, 1x → 1.5x → 2x → 1x, applied to the audio
  itself (`playbackRate`, pitch kept), remembered on the device (`settings.voiceRate`) for every voice
  message after.
- **Output**: the speaker chosen in Settings › Voice where the browser lets a page choose one.
- **Lifecycle**: decrypted audio is kept for the eight most recent voice messages as object URLs,
  revoked when they fall out, when a message is deleted or runs out, and when the reader signs out;
  playback stops when the reader leaves the conversation.

## Look and feel

- **Tokens only** (VM-D14). The player sits in the bubble and takes its colours: on the reader's own
  line the accent fill with its ink, on another's the field with text and muted ink. The recorder's
  dot is `danger`. The waveform is SVG bars whose fill is CSS, so it follows the tokens; there is one
  theme, and if a second is ever designed nothing here needs to change. No light theme is added (a
  second theme is a feature to design, not part of this one).
- **Compact**: a voice bubble is about 15rem wide (a fixed waveform of 64 bars at a narrow width,
  wider from a medium thread), two text lines tall; the recorder is the composer's own row.
- **Touch**: every control is 44px under a coarse pointer; the waveform takes a drag along it and
  leaves a vertical swipe to the thread.
- **Direction** (VM-D15): the player is a media control and runs left to right in every language
  (play first, time flowing rightward), as the platforms ask of playback controls; the words and the
  digits around it are the reader's language.
- **Less motion**: the red dot does not breathe, the waveform does not ease; the live waveform still
  moves, because it is what the microphone hears.

## Performance

A voice bubble is two SVG paths and a few elements, built once and kept like every bubble; nothing is
fetched until play. The player and the recorder are chunks of their own, fetched only by a thread that
holds a voice message or a press on the microphone, so a thread of words costs nothing more. One audio
element for the tab, a bounded cache of decoded audio, and no animation frame while nothing plays or
records.

## Where

Direct conversations, groups, and a table's chat, which draw the same composer and bubble (VM-D11).

## Reports (VM-D12)

A voice message is reported as a line is: the reporter discloses its document, franking proves it is
what was sent. The report keeps the file for the staff (`reports.voice_id`), so deleting the message
afterwards takes nothing from the person reviewing it, and the staff's report page plays it in the
reader's browser with the disclosed key. A file a report keeps is not swept.

## Not in this work (VM-D16)

Transcription; round video messages; hold to record with a slide to cancel and a lock (one press to
start covers a mouse and a finger alike); "recording a voice message…" in the room's head (a new kind
of realtime frame); playing on after leaving the conversation, with a mini player; raise to listen; a
light theme.

## Decisions

| | Decision | Default taken |
|---|---|---|
| VM-D1 | Sealing | A voice message is sealed end to end; the audio is encrypted in the browser under a fresh key per recording, which travels in the sealed document |
| VM-D2 | Storage | Ciphertext in Postgres (`voice_notes`), as pictures are; no folder to configure |
| VM-D3 | Upload | Upload first (raw body, idempotent by the browser's id), then the ordinary send naming the file; nothing large on the socket |
| VM-D4 | Who fetches | The uploader, and members of a room with a live message naming the file; anybody else 404 |
| VM-D5 | Limits | 10 minutes, 1 second at least, 6 MiB, 200 MiB a day, 10 waiting |
| VM-D6 | Formats | WebM/Opus, Ogg/Opus, then MP4/AAC, whichever MediaRecorder offers, 32 kbps mono; the reader sniffs the container |
| VM-D7 | Waveform | 64 levels from the decoded recording, drawn as SVG from tokens; never invented |
| VM-D8 | Recording | One press on the microphone where Send is; pause, preview, resume, send, delete in the composer's row |
| VM-D9 | Leaving | Recording stops and waits as the room's preview for the tab's life; sign-out discards |
| VM-D10 | Playing | One at a time, the next unplayed one after, speed chip 1x/1.5x/2x kept on the device, played marks on the server |
| VM-D11 | Where | Direct, group and table chats |
| VM-D12 | Reports | Reported like a line; the report keeps the file for the staff |
| VM-D13 | Server checks | Size, rate, budget, ownership, membership and references; format, duration and waveform checked by the browser that opens it |
| VM-D14 | Themes | Tokens only; the one theme; no light theme added |
| VM-D15 | Direction | The player runs left to right in every language |
| VM-D16 | Not in this work | Transcription, video messages, hold-to-record, recording indicator, playback across pages, raise to listen |

## Phases, each its own commit with specs, faults put in one at a time, the gates and a walk

- **VM0** `docs(spec)`: this document.
- **VM1** `feat(schema)`: `voice_notes`, `voice_plays`, `messages.voice_id` and kind `voice`, the
  snapshot re-recorded.
- **VM2** `feat(chat)`: the server: the upload and the fetch, sending and deleting a voice message,
  the sweeps, played marks, the counts, the limits; database specs, the garbage pass, the notes.
- **VM3** `feat(chat)`: the browser's half of the sealing and sending: the file's encryption, the
  document, the upload with its progress, the outbox, the open.
- **VM4** `feat(chat)`: the player in the bubble, the list and the cues.
- **VM5** `feat(chat)`: the recorder.
- **VM6** `feat(admin)`: a reported voice message kept and played for the staff.
- **VM7** `test(qa)`: the voice message pass in two real browsers with a fake microphone; the notes.

## Verification

- Server, against Postgres: the upload's every refusal and its idempotence, the budget and the
  pending cap under concurrent uploads, the fetch for the uploader, a member, a stranger, a blocked
  member, after deletion and after expiry, sending with another's file, a forward, deleting, both
  sweeps, played marks and the rings.
- Browser, in specs: the document's codec, the file's sealing and every way opening can fail, the
  sniffing, the waveform from samples, the outbox (progress, failure, retry without re-upload,
  discard), the player (one at a time, seeking, speeds, the next, the cache's revoking, sign-out),
  the recorder against a fake MediaRecorder and microphone (permission refused, no device, pause,
  resume, preview, too short, the limit, teardown releasing the microphone), both languages.
- The pass on the built server: two browsers with Chromium's fake microphone record, send and
  receive in real time, play at each speed, seek, reload and play again, fail an upload and retry,
  fetch a file as a stranger (404), and a thread of many voice messages that stays light; Firefox for
  its own recording format. Walks at 390 and 1280 in English and Persian.

## As built

Each phase is its own commit, as the owner asked mid-way ("do not forget to commit each part
seperetly"): VM0 `a745817c`, VM1 `3151d553`, VM2 `fdb5d184`, VM3 `a5582f58` (sealing and sending),
VM4 `06393648` (the player), VM5 `3bfb70be` (the recorder), VM7 `93678ba4` (the pass), VM6's schema
`ced7a590` and its feature `32e5ba60`, and `d86804ef`, a fault older than this work that VM6 met.
The pass run with Firefox as the second browser found two more, `2d0bbf84` and `8be7e43e`, and the
pass that holds both browsers is `642c1df2`. VM3 to VM5 were built as one and landed as three: each
part's tree was built and gated in a worktree of its own and `main` moved onto the last, its
`git status` empty after.

What changed on the way, against the design:

- **The sender's dot is drawn from the press**, never on a line that failed (VM4). It took its dot a
  second after the press, once the server's copy replaced the one on its way; the pass's second run
  failed by when it looked.
- **A voice message a browser cannot open says why, as a line of words does.** It was counted as a
  line only once opened, and fell to the cards the server writes: a browser enrolled after it was sent
  drew it as "You opened a table". The MCP walk found it; no pass could, because it needs such a
  browser.
- **The type is sent in the one spelling the document takes** (`typeSaid`): Firefox's recorder says
  `audio/ogg; codecs=opus`, which the document's pattern refuses.
- **A recording's length is found, not trusted**: Chrome's MediaRecorder writes none into its header,
  so the element is asked for a place past the end (`readyAudio`); until then the sender's measure
  stands.
- **The waveform hears its own press**: markup handlers are delegated to the document, and the line's
  held press and swipe to reply heard a press on the waveform before it could be stopped.
- **An unopened voice message in the list is "Voice message"**, with no length it cannot know.
- **VM6 is the report's file and the staff's player** (`reports.voice_id`, `GET
  /api/admin/reports/:id/voice`, `ReportVoice`), and the reporter's sheet says "Voice message (0:04)".
  Building it found the sheet printing every disclosed line as its sealed document (`d86804ef`).
- **A line's hover bar is shown only once it is laid.** After a page loads, Firefox counts a line drawn
  under a pointer that has not moved as hovered, and says the pointer entered only at its next move: a
  voice message that arrived under the listener's resting pointer drew its bar at its resting place,
  over its play button, and the press went to the bar. The first move inside a row lays it now.
- **Chromium would not play what Firefox recorded.** Firefox's WebM marks no block a keyframe, though
  an Opus packet always stands alone, and says its Duration is 0; Chromium seeks only to a keyframe, so
  the search for the length failed ("FFmpegDemuxer: demuxer seek failed") and the voice message was
  called unplayable, and Firefox, told the length was 0, could not move through its own. `seekable`
  marks every block and makes a Duration of 0 a Void, in place, in the recorder and in every player; a
  bare page in each browser held each half apart.

Verification, as run:

- The gates at every part, in its own tree: the three typechecks, the browser suite (5,014 at VM3,
  5,054 at VM4, 5,077 at VM5, 5,085 at VM6, 5,086 with the bar and 5,093 with the recording made
  seekable) and the server's (2,442, then 2,444), and every database spec at VM6 (966). In the
  worktrees one browser spec fails that passes in the owner's tree: `voice-denoise.spec.ts`, whose
  `?url` imports Vite refuses from `node_modules` linked from outside the worktree's root.
- Faults put in one at a time and put back from saved text: VM3 to VM5 80 of 83 at first, the three
  being a fault in dead code (the code was taken out) and two holes in the specs (closed, and both
  then caught); VM6's schema 2 of 2, its server 10 of 10, its browser 12 of 12 (one only once its spec
  played a second time), the sheet's fix 2 of 2, the bar 5 of 5, and the recording made seekable 15
  of 15 (13 at first: a file cut inside its Duration and an ID longer than four bytes were holes in
  the specs, closed and then caught).
- The pass on the built server (`tools/qa/voice-message-pass.mjs`), in a thread, an answer quoting
  the first, a stranger, an upload that fails, a press too short, 390 in Persian, a table's chat on a
  phone said on its plate and its pill on a desktop, and a report played for a moderator: 61 of 61
  with both browsers in Chromium, and 61 of 61 with Firefox as the second, each playing what the
  other recorded.
  Proved red against the built client broken three ways: 9 of 53 lines, each one a fault touches.
- Walked in the Playwright MCP's browser at 1280 in English and 390 in Persian: recording, pausing and
  hearing it, sending, the menu (no Copy), a forward that puts nothing up and plays where it went, a
  reply quoting it, the keyboard on the waveform, deleting it and its file going with its last message,
  and a thread this browser could not open; the console empty throughout.

Not done, stated: no Safari was at hand, and Playwright's WebKit on this machine cannot stand in for
it (it has no MediaRecorder, no Web Audio and no microphone), so MP4/AAC is held by the specs alone;
"a thread of many voice messages that stays light" is held by the specs (nothing is fetched until a
press) and not by a run of many; the staff's player plays at 1× only; a report filed before VM6 keeps
no file.
