/**
 * A group run over the api of the BUILT server, every person a wallet made for the run:
 *
 *   QA_BASE=http://localhost:5300 node tools/qa/group-pass.mjs
 *
 * An owner makes a private group, puts an admin, a moderator and two members in it, and the pass
 * asks the server, as each of them, what each may do and what each may not:
 *
 * - a private group answers a stranger as a group that was never made;
 * - the owner names an admin with two rights and a moderator; an admin with the members right makes a
 *   moderator and may make no admin; a moderator makes nobody anything; nobody acts on themselves or
 *   on anybody at or above them;
 * - a link with one use brings one person in and nobody after; a link that asks first leaves a
 *   request, which an admin with the right lets in;
 * - a moderator mutes a member, and the member's place says so; a ban keeps somebody out by every
 *   way in, a link included;
 * - the owner hands the group to the admin, and there is one owner after it, the old one an admin
 *   with every right;
 * - the log holds a row for each of those acts.
 *
 * It leaves its group and its people behind: run it against a disposable database.
 */
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import { recorder } from './seats.mjs';
import { signInWallet } from './wallets.mjs';

const BASE = process.env.QA_BASE ?? 'http://localhost:5300';

const { record, finish } = recorder('group pass');

const word = (answer) => `${ answer.status } ${ answer.body?.error?.code ?? '' }`.trim();

const session = () =>
{
    let cookie = '';

    const call = async (method, path, body) =>
    {
        const response = await fetch(`${ BASE }/api${ path }`, {
            method,
            headers: { 'content-type': 'application/json', ...(cookie === '' ? {} : { cookie }) },
            body: body === undefined ? undefined : JSON.stringify(body)
        });

        for (const line of response.headers.getSetCookie?.() ?? [])
        {
            if (line.startsWith('nura.session=') || line.startsWith('__Host-nura.session='))
            {
                cookie = line.split(';')[0];
            }
        }

        const text = await response.text();
        let parsed = null;

        try
        {
            parsed = text === '' ? null : JSON.parse(text);
        }
        catch
        {
            parsed = null;
        }

        return { status: response.status, body: parsed };
    };

    return { get: (path) => call('GET', path), post: (path, body) => call('POST', path, body), handle: '' };
};

const signed = async (name) =>
{
    const who = session();

    who.handle = (await signInWallet(who.post, name, privateKeyToAccount(generatePrivateKey()))).handle;
    return who;
};

/** Where somebody stands in the group, read from its members as the owner sees them. */
const placeOf = async (reader, slug, handle) =>
{
    const answer = await reader.get(`/groups/${ slug }/members?q=${ encodeURIComponent(handle) }`);

    return (answer.body?.members ?? []).find((one) => one.person?.id === handle) ?? null;
};

try
{
    const [owner, admin, moderator, member, other, late, asker, banned, stranger] = await Promise.all(
        ['Owner', 'Admin', 'Moderator', 'Member', 'Other', 'Late', 'Asker', 'Banned', 'Stranger'].map((name) => signed(`Group ${ name }`))
    );

    const made = await owner.post('/groups', { name: `Group pass ${ Date.now() % 100_000 }`, blurb: '', crest: 'crest-crown', hue: 200, privacy: 'private', game: '' });
    const slug = made.body?.slug;

    record('a private group is made', made.status === 200 && typeof slug === 'string', word(made));

    const unseen = await stranger.get(`/groups/${ slug }`);
    const never = await stranger.get('/groups/no-such-group-at-all');

    record('a stranger is answered as a group never made', unseen.status === 404 && JSON.stringify(unseen.body) === JSON.stringify(never.body), `${ word(unseen) } / ${ word(never) }`);

    for (const person of [admin, moderator, member, other, banned])
    {
        const added = await owner.post(`/groups/${ slug }/members`, { id: person.handle });

        record(`the owner adds ${ person.handle }`, added.status === 200, word(added));
    }

    record('the owner makes an admin with three rights', (await owner.post(`/groups/${ slug }/role`, { id: admin.handle, role: 'admin', rights: ['members', 'approve', 'remove'] })).status === 200);
    record('and a moderator', (await owner.post(`/groups/${ slug }/role`, { id: moderator.handle, role: 'moderator' })).status === 200);

    record('an admin makes no admin', word(await admin.post(`/groups/${ slug }/role`, { id: member.handle, role: 'admin', rights: [] })).startsWith('40'));

    const mod = await admin.post(`/groups/${ slug }/role`, { id: other.handle, role: 'moderator' });

    record('an admin with the members right makes a moderator', mod.status === 200, word(mod));
    const answered = async (label, said, expected) =>
    {
        const got = word(await said);

        record(label, got === expected, got);
    };

    await answered('a moderator makes nobody anything', moderator.post(`/groups/${ slug }/role`, { id: member.handle, role: 'moderator' }), '403 group-right');
    await answered('nobody acts on themselves', owner.post(`/groups/${ slug }/role`, { id: owner.handle, role: 'member' }), '409 group-self');
    await answered('and taking oneself out is leaving, another way', admin.post(`/groups/${ slug }/members/remove`, { id: admin.handle }), '422 validation-failed');
    await answered('nor anybody at or above them', admin.post(`/groups/${ slug }/members/remove`, { id: owner.handle }), '409 group-rank');
    await answered('a member takes nobody out', member.post(`/groups/${ slug }/members/remove`, { id: other.handle }), '403 group-right');
    await answered('a moderator, without the right, takes nobody out', moderator.post(`/groups/${ slug }/members/remove`, { id: member.handle }), '403 group-right');

    const once = await owner.post(`/groups/${ slug }/links`, { uses: 1, approval: false });
    const link = once.body?.links?.find((one) => one.most === 1);
    const token = link?.link?.split('/').pop();

    record('a link with one use', typeof token === 'string', word(once));

    const joined = await late.post(`/group-links/${ token }/join`);

    record('it brings one person in', joined.status === 200 && joined.body?.can === 'member', `${ word(joined) } ${ joined.body?.can ?? '' }`);

    const spent = await stranger.post(`/group-links/${ token }/join`);

    record('and nobody after', word(spent) === '404 group-link', word(spent));

    const asking = await owner.post(`/groups/${ slug }/links`, { approval: true });
    const asks = asking.body?.links?.find((one) => one.approval && one.live)?.link?.split('/').pop();
    const asked = await asker.post(`/group-links/${ asks }/join`);

    record('a link that asks first leaves a request', asked.status === 200 && asked.body?.can === 'requested', `${ word(asked) } ${ asked.body?.can ?? '' }`);

    const requests = await admin.get(`/groups/${ slug }/requests`);

    record('which the staff can read', (requests.body?.requests ?? []).some((one) => one.person?.id === asker.handle && one.byLink === true));

    const approved = await admin.post(`/groups/${ slug }/requests/answer`, { id: asker.handle, approve: true });

    record('an admin with the right lets them in', approved.status === 200 && (await placeOf(owner, slug, asker.handle))?.role === 'member', word(approved));

    const muted = await moderator.post(`/groups/${ slug }/mute`, { id: member.handle, hours: 1 });

    record('a moderator mutes a member', muted.status === 200, word(muted));
    const silenced = await placeOf(owner, slug, member.handle);

    record('and the member\'s place says so, with when it ends', typeof silenced?.muted?.until === 'string', JSON.stringify(silenced?.muted ?? null));

    const out = await owner.post(`/groups/${ slug }/ban`, { id: banned.handle });

    record('the owner bans a member', out.status === 200 && (await placeOf(owner, slug, banned.handle)) === null, word(out));

    const again = await owner.post(`/groups/${ slug }/links`, { approval: false });
    const open = again.body?.links?.find((one) => !one.approval && one.live && one.most === undefined)?.link?.split('/').pop();
    const face = await banned.get(`/group-links/${ open }`);
    const back = await banned.post(`/group-links/${ open }/join`);

    record('a link tells somebody banned so', face.body?.can === 'banned', face.body?.can ?? word(face));
    record('and keeps them out', back.status !== 200 || back.body?.can !== 'member', `${ word(back) } ${ back.body?.can ?? '' }`);
    record('so does being added', word(await owner.post(`/groups/${ slug }/members`, { id: banned.handle })).startsWith('40'));

    const handed = await owner.post(`/groups/${ slug }/owner`, { id: admin.handle });

    record('the owner hands the group over', handed.status === 200, word(handed));

    const owners = (await admin.get(`/groups/${ slug }/members`)).body?.members?.filter((one) => one.role === 'owner') ?? [];
    const before = await placeOf(admin, slug, owner.handle);

    record('one owner after it', owners.length === 1 && owners[0].person?.id === admin.handle, JSON.stringify(owners.map((one) => one.person?.id)));
    record('the old one an admin with every right', before?.role === 'admin' && (before?.rights?.length ?? 0) >= 9, JSON.stringify(before));

    const log = (await admin.get(`/groups/${ slug }/log`)).body?.rows ?? [];
    const kinds = new Set(log.map((one) => one.kind));

    record('the log holds each act', ['created', 'role', 'muted', 'banned', 'owner'].every((kind) => kinds.has(kind)), [...kinds].join(', '));
}
catch (error)
{
    record('the pass ran to its end', false, String(error).split('\n')[0]);
}
finally
{
    finish();
}
