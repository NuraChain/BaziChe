import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve, sep } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

import 'reflect-metadata';
import { DataSource } from 'typeorm';

const database = process.env.QA_NOTIFY_DATABASE;
const port = Number(process.env.QA_NOTIFY_PORT);

if (!database || !Number.isInteger(port) || port < 1 || port > 65535)
{
    throw new Error('Set QA_NOTIFY_DATABASE to an empty disposable PostgreSQL database and QA_NOTIFY_PORT to its loopback port.');
}

const built = pathToFileURL(resolve(process.env.QA_NOTIFY_BUILD ?? '.dist-backend') + sep);
const load = (path) => import(new URL(path, built));
const { entities, Call, Conversation, ConversationMember, Notification, User } = await load('entities/index.js');
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

async function waitForLock(prefix)
{
    const deadline = Date.now() + 5000;

    while (Date.now() < deadline)
    {
        const [row] = await db.query(
            `select exists (
                select 1 from pg_stat_activity
                 where datname = current_database() and cardinality(pg_blocking_pids(pid)) > 0 and query like $1
            ) as blocked`, [`${ prefix }%`]
        );

        if (row.blocked)
        {
            return;
        }

        await wait(20);
    }

    throw new Error(`Expected a PostgreSQL lock wait for ${ prefix }.`);
}

let beforeDelete = null;
let beforeFanout = null;
let afterFanout = null;
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

        if (/^insert into notifications/i.test(sql) && parameters[0]?.[1] === groupCall)
        {
            const before = beforeFanout;
            const after = afterFanout;
            beforeFanout = null;
            afterFanout = null;
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
        await waitForLock('insert into notifications');
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

    const message = { kind: 'message', actorId: owner, ref: { conversationId: room }, dedupeKey: 'review:message' };
    assert.deepEqual(await notify.tellAll([owner, member], message), [member]);
    assert.deepEqual(await notify.tellAll([owner, member], message), [member]);
    assert.equal((await rowsFor(message.dedupeKey, 'message'))[0].count, 2);
    assert.deepEqual(errors, []);
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
    console.log('Notification retraction and group-call lifecycle regressions passed.');
}
finally
{
    if (db.isInitialized)
    {
        await db.destroy();
    }
}
