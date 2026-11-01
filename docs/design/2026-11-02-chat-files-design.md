# Photos, videos and files in the chat

The owner, 2026-11-01: "ye kari kon to safe chat ha beshe file aks va film ham ferestad vase ham dige,
limit hajm bezar, to chat hajm aks va video ham bezar bedonan cheghadr e ghable inke download shan,
mitonan caption ham dashte bashan" — people send each other files, photos and videos in the sealed
chat, under a size limit; a photo or a video says how large it is before it is downloaded; each can
carry a caption. Asked, the owner took 10 MB for a photo and 50 MB for a video or a file.

Decisions are numbered CF-D1 onward; each is a default taken here that the owner may overturn.

## The constraint

Every line in this chat is sealed end to end (`nura-e2ee/v1`), and so is every voice message
(`2026-10-30-voice-messages-design.md`). A photo the server could look at beside words it cannot
would be the first plaintext in a room that says it is sealed, so a file is sealed too (CF-D1), and
the pipeline voice messages built is the one a file rides:

```
 sender (browser)                              server                           reader (browser)
   pick / paste / drop a file
   photo: re-drawn (no EXIF, no GPS), thumb
   video: poster frame, length, size
   fresh AES-256-GCM key K, iv; seal(file)
   PUT /api/chat/files/:fileId  ------------>  chat_files(id, uploader, bytes)
        (ciphertext, progress, retried)        size, rate, budget checked
   seal {file:{id,key,iv,as,mime,name,bytes,w,h,ms,thumb},caption?}
   POST /api/chat/:room/messages  --------->   kind 'file', file_id            -- ring --> re-read page
                                                                                   draws the thumb, the
                                                                                   size, the caption;
                                                                                   fetches NOTHING
                                                                                   press download:
                                               member of a room with a live <---  GET /api/chat/files/:id
                                               message naming the file             progress, open with K
```

The server sees who uploads, how much, how often and which message names which file. It never sees a
name, a type, a picture, a length or a caption.

## The file

- **One fresh key a file** (CF-D1), AAD `nura-e2ee/v1 ␟ file ␟ fileId` (`chat/envelope.ts`), the
  key, the iv and the id inside the message's sealed document, covered by its signature. The id is
  the browser's uuid, so a retried upload is the same file.
- **Stored in Postgres** (CF-D2): `chat_files (id, uploader_id, bytes, size, created_at)`, a table
  of its own beside `voice_notes`, because its bounds are not a voice message's and nothing about the
  two would be simpler as one table with a kind the server cannot check.
- **The rules are voice's, spelled once for both**: the same upload (raw body, a streaming limit,
  201 / 200 for a retry / 409 for somebody else's id), the same fetch rule (the uploader, or a member
  of a room holding a live message that names the file with no block between them), the same
  lifetime (goes with the last live message naming it, the minute sweep, an hour for an upload
  nobody sent), the same report keep. `HEARD_BY_ME` and `letGo` in `chat/service.ts` take the
  column they ask about rather than being copied.

### Limits (CF-D3)

`backend/src/domains/chat/files.ts`, which imports nothing, read by both halves:

| | |
|---|---|
| A photo | 10 MiB as sent (after it is re-drawn) |
| A video, a file | 50 MiB |
| Largest ciphertext the server keeps | 50 MiB and the GCM tag |
| A day's uploads | 1 GiB an account |
| Uploads waiting to be sent | 10 an account |
| A caption | 1,024 characters |

The server cannot tell a photo from a file, so it holds the 50 MiB it can see and the browser holds
the 10 MiB photo, as voice's duration is held where it can be. One file a message (CF-D9).

Encryption is one AES-GCM call over the whole file, so the file is in memory twice while it is
sealed: 100 MB at the most, which a phone holds. A larger file needs chunked sealing and an upload
in parts; it is not in this work (CF-D10). The proxy has to let a 50 MiB body through: the
self-hosting server block's `client_max_body_size` goes from 8m to 64m.

## What is sent as what (CF-D4)

- **Photo**: JPEG, PNG and WebP (and whatever else the browser can decode except GIF and SVG) are
  **re-drawn on a canvas** and sent as JPEG at quality 0.86, the longest side at most 2560px. That
  is what makes a photo safe to send: the EXIF block, the GPS fix and the camera's serial do not
  survive a canvas. A PNG with transparency stays PNG. A photo that is still over 10 MiB is refused
  in words, with "Send as a file" beside it.
- **Video**: whatever `<video>` in this browser can play (MP4, WebM, QuickTime). Its first frame
  is the poster, its length and its size are measured. It is not re-encoded: a browser cannot do
  that well, so a video's own metadata goes as it is, and the sheet says so (CF-D5).
- **File**: anything else, and anything the sender chooses to "Send as a file", GIF and SVG
  included. It keeps its name and its bytes. It is never opened in the page: it is saved.

## The message

- **Kind `file`**, sealed as `text` is, `file_id` naming the file; a CHECK keeps
  `kind = 'file'` and `file_id is not null` together.
- **The document** (`lib/body.ts`): `{"file":{"id","key","iv","as","mime","name","bytes","w"?,"h"?,
  "ms"?,"thumb"?},"caption"?,"reply"?,"fwd"?}`. `as` is `photo`, `video` or `file`; `bytes` the
  plaintext size (what the bubble says before anything is fetched); `w`/`h` the picture's size, so
  the bubble keeps its place while it loads; `ms` a video's length; `thumb` a JPEG at most 40px on
  its longest side, about 1 KB, drawn blurred. Anything not exactly that shape opens as tampered.
- **Caption**: the words under it, drawn as a line's words are (links, spoilers); a message with a
  caption can be searched by it, quoted by it and its gist is its caption. A caption cannot be edited
  in this work (CF-D9).
- **Counted as a message** everywhere a line is: unread, the list's last line ("Photo", "Video",
  "File: report.pdf", or the caption), the cue, notifications, push. It can be replied to, reacted
  to, forwarded (the file is referenced, not copied), deleted and reported.

## The bubble (CF-D6)

Nothing is fetched until it is asked for, so a thread of photos costs a reader nothing they did not
choose, and the size is on the bubble before they choose:

- **Photo**: the thumb, blurred, at the picture's own proportions (at most 18rem wide, 22rem tall);
  over it a round download button and the size, "2.4 MB". Pressed: a ring that fills as it downloads
  (and a cancel), then the photo. Pressed again it opens full screen; Escape or a press closes it.
- **Video**: the same, with the length in the corner ("0:42 · 18.6 MB"). Downloaded, it plays in
  the bubble with the browser's controls.
- **File**: an icon, the name (cut in the middle, so the extension shows), the size and the type;
  the download button; once downloaded, Save, which saves it under its name. It is never shown inline.
- **The sender's own** shows what they sent at once, from their own copy, with the upload's ring.
- **Failures in words** on the bubble: could not be downloaded (Try again), no longer there, and a
  file that does not authenticate (an alarm, as a tampered line is).
- Decrypted files are kept as object URLs for the twelve most recent, revoked when they fall out,
  when the message goes, and at sign-out.

## The composer (CF-D7)

- **A paperclip** beside the field opens the picker; a file can also be pasted or dropped on the
  thread.
- **A sheet** shows what is about to go: the photo or the video's poster, or the file's name, its
  size, "Send as a file" for a photo or a video, and the caption field (the composer's own words
  move into it). A file over its limit is said at once ("This video is 72 MB. The most is 50 MB")
  and Send is off.
- **Send** puts the line in the thread at once with its ring; ✓, ✓✓, Not sent with Try again (which
  uploads only what the server does not have) and Delete, as voice messages do.

## Where (CF-D8)

Direct conversations, groups, and a table's chat. Channels (`2026-11-02-channels-design.md`) use the
same upload and fetch with a key that sits in the post.

## Decisions

| | Decision | Default taken |
|---|---|---|
| CF-D1 | Sealing | A file is sealed end to end under a fresh key, which travels in the sealed document |
| CF-D2 | Storage | Ciphertext in Postgres, `chat_files`; the rules shared with `voice_notes`, not copied |
| CF-D3 | Limits | 10 MiB a photo, 50 MiB a video or a file, 1 GiB a day, 10 waiting, 1,024 characters a caption |
| CF-D4 | Photos | Re-drawn on a canvas, which drops EXIF and GPS; GIF and SVG go as files |
| CF-D5 | Videos | Not re-encoded; poster, length and size measured in the browser |
| CF-D6 | Download | Nothing fetched until pressed; the size (and a video's length) on the bubble first |
| CF-D7 | Composer | Paperclip, paste, drop; a sheet with the caption, "Send as a file", the limit said at once |
| CF-D8 | Where | Direct, group and table chats; channels reuse the pipeline |
| CF-D9 | Not in this work | Albums, editing a caption, auto-download settings |
| CF-D10 | Not in this work | Files over 50 MiB (chunked sealing), re-encoding video |

## Phases, each its own commit

- **CF0** `docs(spec)`: this document.
- **CF1** `feat(schema)`: `chat_files`, `messages.file_id`, kind `file`, `reports.file_id`.
- **CF2** `feat(chat)`: the server: upload, fetch, send, delete, sweeps, the limits.
- **CF3** `feat(chat)`: the browser's sealing, the document, the upload and the outbox.
- **CF4** `feat(chat)`: the bubble, the download, the viewer, the list's gist.
- **CF5** `feat(chat)`: the composer's paperclip, paste, drop and sheet.
