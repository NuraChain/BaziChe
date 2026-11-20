import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve, sep } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import { makeDevice } from '../../frontend/tests/keys.ts';
import { encodeFile, encodeText } from '../../frontend/src/lib/body.ts';
import { sealFile } from '../../frontend/src/lib/chat-file.ts';
import { commitmentOf, confirmationOf, mintEpochKey, mintFrankingKey, sealText, signRecipients } from '../../frontend/src/lib/crypto.ts';

const database = process.env.QA_NOTIFY_DATABASE;
const port = Number(process.env.QA_NOTIFY_PORT);

if (!database || !Number.isInteger(port) || port < 1 || port > 65535)
{
    throw new Error('Set QA_NOTIFY_DATABASE to an empty disposable PostgreSQL database and QA_NOTIFY_PORT to its loopback port.');
}

const built = pathToFileURL(resolve(process.env.QA_NOTIFY_BUILD ?? '.dist-backend') + sep);
const load = (path) => import(new URL(path, built));
const { entities, Call, ChatFile, Conversation, ConversationEpoch, ConversationMember, Device, Mute, Notification, Session, User } = await load('entities/index.js');
const { syncSchema } = await load('db/schema.js');
const { queueRunners } = await load('lib/one-at-a-time.js');
const { createGroupService } = await load('domains/group/service.js');
const { createSocialService } = await load('domains/social/service.js');
const { createNotifyService } = await load('domains/notify/service.js');
const { buildPorts } = await load('services.js');

const db = queueRunners(new DataSource({
    type: 'postgres',
    host: '127.0.0.1',
    port,
    database,
    entities,
    uuidExtension: 'pgcrypto',
    synchronize: false,
    installExtensions: false,
    extra: { connectionTimeoutMillis: 5000, statement_timeout: 10000 }
}));

const groupCall = 'group-call';
const ordered = (ids) => [...ids].sort();
const held = () =>
{
    let release;
    const ready = new Promise((resolve) => { release = resolve; });

    return { ready, release };
};

async function within(action, reason)
{
    const deadline = new AbortController();

    try
    {
        return await Promise.race([
            action,
            wait(5000, null, { signal: deadline.signal }).then(() => { throw new Error(reason); })
        ]);
    }
    finally
    {
        deadline.abort();
    }
}

async function waitForLock(...prefixes)
{
    const deadline = Date.now() + 5000;

    while (Date.now() < deadline)
    {
        const [row] = await db.query(
            `select exists (
                select 1 from pg_stat_activity
                 where datname = current_database() and cardinality(pg_blocking_pids(pid)) > 0
                   and query like any($1::text[])
            ) as blocked`, [prefixes.map((prefix) => `${ prefix }%`)]
        );

        if (row.blocked)
        {
            return;
        }

        await wait(20);
    }

    throw new Error(`Expected a PostgreSQL lock wait for ${ prefixes.join(' or ') }.`);
}

let beforeDelete = null;
let beforeFanout = null;
let afterFanout = null;
let afterChatRead = null;
let afterEnd = null;
const makeRunner = db.driver.createQueryRunner.bind(db.driver);

db.driver.createQueryRunner = (...args) =>
{
    const runner = makeRunner(...args);
    const query = runner.query.bind(runner);

    runner.query = async (sql, ...parameters) =>
    {
        if (/^delete from "notifications"/i.test(sql) && beforeDelete !== null)
        {
            await beforeDelete();
        }

        const fanout = /^(insert into notifications|with message_times\b)/i.test(sql);
        const chatRead = /^update conversation_members set last_read_at = now/i.test(sql);

        if (fanout || (chatRead && afterChatRead !== null))
        {
            const before = fanout ? beforeFanout : null;
            const after = fanout ? afterFanout : afterChatRead;

            if (fanout)
            {
                beforeFanout = null;
                afterFanout = null;
            }
            else
            {
                afterChatRead = null;
            }

            await before?.();

            if (after !== null)
            {
                await runner.startTransaction();

                try
                {
                    const result = await query(sql, ...parameters);
                    await after();
                    await runner.commitTransaction();

                    return result;
                }
                catch (error)
                {
                    await runner.rollbackTransaction();
                    throw error;
                }
            }
        }

        const result = await query(sql, ...parameters);

        if (/^update "calls"/i.test(sql) && afterEnd !== null)
        {
            const pause = afterEnd;
            afterEnd = null;
            await pause();
        }

        return result;
    };

    return runner;
};

const notices = () => db.getRepository(Notification);
const rowsFor = (dedupeKey, kind = groupCall) => notices().findBy({ dedupeKey, kind });
const put = (userId, dedupeKey, extra = {}) => notices().insert({ userId, dedupeKey, kind: groupCall, ...extra });

async function retraction(notify, [one, two, three])
{
    await put(one, 'review:matching');
    await put(two, 'review:matching', { readAt: new Date() });
    await put(three, 'review:matching', { kind: 'call-missed' });
    await put(one, 'review:other-key');
    assert.equal(await notify.unread(one), 2);
    assert.equal(await notify.unread(two), 0);
    assert.deepEqual(ordered(await notify.retractAll(groupCall, 'review:matching')), ordered([one, two]));
    assert.deepEqual(await rowsFor('review:matching'), []);
    assert.equal((await rowsFor('review:matching', 'call-missed')).length, 1);
    assert.equal(await notify.unread(one), 1);
    assert.deepEqual(await notify.retractAll(groupCall, 'review:matching'), []);

    await put(one, 'review:insert');
    beforeDelete = async () =>
    {
        beforeDelete = null;
        await put(two, 'review:insert');
    };
    assert.deepEqual(ordered(await notify.retractAll(groupCall, 'review:insert')), ordered([one, two]));
    assert.deepEqual(await rowsFor('review:insert'), []);

    await put(one, 'review:dismiss');
    await put(two, 'review:dismiss');
    const dismissal = await notices().findOneByOrFail({ userId: two, dedupeKey: 'review:dismiss', kind: groupCall });
    beforeDelete = async () =>
    {
        beforeDelete = null;
        await notify.dismiss(two, dismissal.id);
    };
    assert.deepEqual(await notify.retractAll(groupCall, 'review:dismiss'), [one]);
    assert.deepEqual(await rowsFor('review:dismiss'), []);

    await put(one, 'review:overlap');
    await put(two, 'review:overlap');
    const both = held();
    let arrivals = 0;
    beforeDelete = async () =>
    {
        arrivals += 1;

        if (arrivals === 2)
        {
            beforeDelete = null;
            both.release();
        }

        await within(both.ready, 'Both retractions should reach the delete.');
    };
    const recipients = await Promise.all([
        notify.retractAll(groupCall, 'review:overlap'),
        notify.retractAll(groupCall, 'review:overlap')
    ]);
    assert.deepEqual(ordered(recipients.flat()), ordered([one, two]));
    assert.deepEqual(await rowsFor('review:overlap'), []);
}

async function lifecycle(notify, social, [owner, member])
{
    const group = await createGroupService(db, social).create(owner, {
        name: 'Notification regression', blurb: '', crest: 'stars', hue: 11, game: null,
        privacy: 'private', members: [member]
    });
    const { id: room } = await db.getRepository(Conversation).findOneByOrFail({ groupId: group.row.id });
    assert.ok(await db.getRepository(ConversationMember).existsBy({ conversationId: room, userId: member }));
    const refreshes = [];
    const errors = [];
    const config = {
        env: 'test', origin: 'http://127.0.0.1', secret: randomUUID() + randomUUID(),
        adminWallet: '', chainId: '', rpcUrl: '', profileRegistry: '', profileLens: '',
        vaultAddress: '', refereeKey: '', shopAddress: '', tipsAddress: '', marketsAddress: '',
        looksAddress: '', achievementsAddress: '', minterKey: '', sponsorKey: '', rewardsKey: '', explorerApi: ''
    };
    const ports = buildPorts(db, config, {
        callChanged() {},
        voiceChatChanged() {},
        chatChanged() {},
        chatSeen() {},
        selfChanged(userId, topic)
        {
            if (topic === 'notifications')
            {
                refreshes.push(userId);
            }
        }
    }, undefined, (label) => errors.push(label));
    const liveCall = () => db.getRepository(Call).findOneByOrFail({ conversationId: room, state: 'live' });
    const forCall = (id) => rowsFor(`call:${ id }`);

    const aboutToWrite = held();
    const issueInvite = held();
    beforeFanout = async () => { aboutToWrite.release(); await within(issueInvite.ready, 'Invite never released.'); };
    const delayed = ports.calls.ring(owner, room);

    try
    {
        await within(aboutToWrite.ready, 'Start never reached the notification insert.');
        const { id } = await liveCall();
        await ports.calls.end(owner, id);
        issueInvite.release();
        await delayed;
        assert.deepEqual(await forCall(id), []);
        assert.deepEqual(refreshes, []);
    }
    finally
    {
        issueInvite.release();
        await Promise.allSettled([delayed]);
    }

    const starting = await ports.calls.ring(owner, room);
    assert.deepEqual((await forCall(starting.id)).map((notice) => notice.userId), [member]);
    await ports.calls.end(owner, starting.id);
    assert.deepEqual(await forCall(starting.id), []);

    const wroteEnding = held();
    const commitEnding = held();
    const waitingInvite = held();
    const allowInvite = held();
    beforeFanout = async () => { waitingInvite.release(); await within(allowInvite.ready, 'Invite never released.'); };
    const ringingAfterEnd = ports.calls.ring(owner, room);
    let endingFirst;

    try
    {
        await within(waitingInvite.ready, 'Start never reached the notification insert.');
        const { id } = await liveCall();
        afterEnd = async () => { wroteEnding.release(); await within(commitEnding.ready, 'End never released.'); };
        endingFirst = ports.calls.end(owner, id);
        await within(wroteEnding.ready, 'End never updated the call.');
        allowInvite.release();
        await waitForLock('insert into notifications', 'with message_times');
        commitEnding.release();
        await Promise.all([ringingAfterEnd, endingFirst]);
        assert.deepEqual(await forCall(id), []);
    }
    finally
    {
        allowInvite.release();
        commitEnding.release();
        await Promise.allSettled([ringingAfterEnd, endingFirst]);
    }

    const inserted = held();
    const commitInvite = held();
    afterFanout = async () => { inserted.release(); await within(commitInvite.ready, 'Publication never released.'); };
    const ringingFirst = ports.calls.ring(owner, room);
    let endingAfterRing;

    try
    {
        await within(inserted.ready, 'Fan-out never inserted the invite.');
        const { id } = await liveCall();
        endingAfterRing = ports.calls.end(owner, id);
        await waitForLock('UPDATE "calls"');
        commitInvite.release();
        await Promise.all([ringingFirst, endingAfterRing]);
        assert.deepEqual(await forCall(id), []);
    }
    finally
    {
        commitInvite.release();
        await Promise.allSettled([ringingFirst, endingAfterRing]);
    }

    await chatDelivery(ports, owner, member, room, refreshes);
    assert.deepEqual(errors, []);
}

async function chatFixture(owner, room)
{
    const account = await makeDevice(privateKeyToAccount(generatePrivateKey()));
    const secret = mintEpochKey();
    const session = randomUUID();
    await db.getRepository(Device).insert({
        id: account.id, userId: owner, exchangeKey: account.exchangeKey, signingKey: account.signingKey,
        attested: account.peer.attested, attestedAddress: account.address, attestedMessage: account.peer.message,
        attestedSignature: account.peer.signature
    });
    await db.getRepository(Session).insert({
        id: session, userId: owner, deviceId: account.id, tokenHash: randomBytes(32).toString('hex'),
        expiresAt: new Date(Date.now() + 3600000)
    });
    const confirmation = await confirmationOf(secret, room, 1);
    await db.getRepository(ConversationEpoch).insert({
        conversationId: room, epoch: 1, mintedBy: account.id, recipients: account.id, confirmation,
        signature: await signRecipients(account.secrets, room, 1, account.id, [account.id], confirmation)
    });

    let seq = 0;
    const message = async (kind, plain, extra) =>
    {
        const key = mintFrankingKey();
        const aad = {
            conversationId: room, epoch: 1, seq: ++seq, messageId: randomUUID(),
            senderAccountId: owner, senderDeviceId: account.id, kind,
            clientAt: Date.now(), commitment: await commitmentOf(key, plain), expiresAt: 0
        };
        return {
            id: aad.messageId, senderDeviceId: account.id, epoch: 1, kind, ...extra,
            seq: aad.seq, commitment: aad.commitment, clientAt: new Date(aad.clientAt).toISOString(), expiresAt: 0,
            ...await sealText(secret, account.secrets, aad, plain, key)
        };
    };

    return {
        session,
        text: () => message('text', encodeText({ text: 'Notification regression' })),
        async album()
        {
            const album = randomUUID();
            const photo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/W/oAAAAASUVORK5CYII=', 'base64');
            const messages = [];

            for (let item = 0; item < 2; item += 1)
            {
                const file = randomUUID();
                const sealed = await sealFile(photo, file);
                await db.getRepository(ChatFile).insert({ id: file, uploaderId: owner, bytes: Buffer.from(sealed.body), size: sealed.body.length });
                const plain = encodeFile({
                    file: { id: file, key: sealed.key, iv: sealed.iv, as: 'photo', mime: 'image/png', name: 'fixture.png', bytes: photo.length, w: 1, h: 1 },
                    album: { id: album, at: item, of: 2 }
                });
                messages.push(await message('file', plain, { file, fileAs: 'photo' }));
            }

            return { album, messages };
        }
    };
}

async function chatDelivery(ports, owner, member, room, refreshes)
{
    const fixture = await chatFixture(owner, room);
    const notice = () => notices().findOneBy({ userId: member, kind: 'message', dedupeKey: `chat:${ room }` });
    const read = () => ports.chat.markRead(member, room);
    const send = (input) => ports.chat.send(owner, fixture.session, room, input);
    const album = (input) => ports.chat.sendAlbum(owner, fixture.session, room, input);

    const text = await fixture.text();
    const photos = await fixture.album();

    for (const [publish, input, ids] of [
        [send, text, [text.id]],
        [album, photos, photos.messages.map((item) => item.id)]
    ])
    {
        const entered = held();
        const released = held();
        beforeFanout = async () => { entered.release(); await within(released.ready, 'Chat delivery never released.'); };
        const writing = publish(input);

        try
        {
            await within(entered.ready, 'Chat send never reached notification fan-out.');
            const page = await ports.chat.messages(member, room, undefined, 40);
            assert.ok(ids.every((id) => page.messages.some((message) => message.id === id)));
            await read();
            refreshes.length = 0;
            released.release();
            await writing;
            assert.equal(await notice(), null, 'Already-read content produced a late notification.');
            assert.deepEqual(refreshes, []);
        }
        finally
        {
            released.release();
            await Promise.allSettled([writing]);
        }
    }

    const photosAfterRead = await fixture.album();
    const reachedFanout = held();
    const readyToFanout = held();
    const wroteRead = held();
    const commitRead = held();
    beforeFanout = async () => { reachedFanout.release(); await within(readyToFanout.ready, 'Chat delivery never released.'); };
    const waitingAlbum = album(photosAfterRead);
    let readingFirst;

    try
    {
        await within(reachedFanout.ready, 'Album never reached notification fan-out.');
        afterChatRead = async () => { wroteRead.release(); await within(commitRead.ready, 'Chat read never released.'); };
        readingFirst = read();
        await within(wroteRead.ready, 'Reader never updated its watermark.');
        readyToFanout.release();
        await waitForLock('with message_times');
        commitRead.release();
        await Promise.all([waitingAlbum, readingFirst]);
        assert.equal(await notice(), null);
    }
    finally
    {
        readyToFanout.release();
        commitRead.release();
        await Promise.allSettled([waitingAlbum, readingFirst]);
    }

    const next = await fixture.text();
    const wroteNotice = held();
    const commitNotice = held();
    afterFanout = async () => { wroteNotice.release(); await within(commitNotice.ready, 'Chat delivery never released.'); };
    const writingFirst = send(next);
    let waitingReader;

    try
    {
        await within(wroteNotice.ready, 'Message never inserted the notification.');
        waitingReader = read();
        await waitForLock('update conversation_members set last_read_at = now');
        commitNotice.release();
        await Promise.all([writingFirst, waitingReader]);
        assert.ok((await notice()).readAt);
    }
    finally
    {
        commitNotice.release();
        await Promise.allSettled([writingFirst, waitingReader]);
    }

    refreshes.length = 0;
    const unread = await fixture.album();
    const sent = await album(unread);
    assert.deepEqual(sent.messages.map((item) => item.id), unread.messages.map((item) => item.id));
    const delivered = await notice();
    assert.equal(delivered.count, 3);
    assert.equal(delivered.readAt, null);
    assert.deepEqual(refreshes, [member]);
    await read();
    assert.ok((await notice()).readAt);

    const older = await fixture.text();
    const newer = await fixture.text();
    const reachedOlder = held();
    const releaseOlder = held();
    beforeFanout = async () => { reachedOlder.release(); await within(releaseOlder.ready, 'Older delivery never released.'); };
    const delayedOlder = send(older);
    let complete;

    try
    {
        await within(reachedOlder.ready, 'Older message never reached notification fan-out.');
        await send(newer);
        const latest = await notice();
        releaseOlder.release();
        await delayedOlder;
        complete = await notice();
        assert.equal(complete.count, delivered.count + 2);
        assert.equal(complete.readAt, null);
        assert.deepEqual(complete.createdAt, latest.createdAt);
    }
    finally
    {
        releaseOlder.release();
        await Promise.allSettled([delayedOlder]);
    }

    await db.getRepository(Mute).insert({ userId: member, subjectKind: 'conversation', subjectId: room });
    refreshes.length = 0;
    await album(await fixture.album());
    assert.equal((await notice()).count, complete.count);
    assert.deepEqual(refreshes, []);
}

try
{
    await db.initialize();
    const [catalogue] = await db.query(`select exists (
        select 1 from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where c.relkind in ('r', 'p') and n.nspname !~ '^pg_' and n.nspname <> 'information_schema'
    ) as populated`);
    assert.equal(catalogue.populated, false, 'The notification regression needs an empty disposable database.');
    await syncSchema(db);

    const users = ['reviewOne', 'reviewTwo', 'reviewThree'].map((handle) => ({ id: randomUUID(), handle, displayName: handle, hue: 11 }));
    await db.getRepository(User).insert(users);
    const ids = users.map((user) => user.id);
    const social = createSocialService(db);
    const notify = createNotifyService(db, social);

    await retraction(notify, ids);
    await lifecycle(notify, social, ids);
    console.log('Notification retraction, group-call lifecycle and chat delivery regressions passed.');
}
finally
{
    if (db.isInitialized)
    {
        await db.destroy();
    }
}
