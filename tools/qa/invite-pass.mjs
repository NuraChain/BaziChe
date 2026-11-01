import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import { squareNamed } from '../../backend/src/domains/match/chess/board.ts';
import { databaseName, sql } from './db.mjs';
import { BASE, launch, recorder, waitFor } from './seats.mjs';
import { tableBody } from './tables.mjs';
import { signInWallet } from './wallets.mjs';
import { chainUnreached } from './unreached.mjs';

const OWNER_KEY = process.env.QA_OWNER_KEY ?? '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e';

const REASON = 'Decided by the invite pass';

const LOOKS = { inviter: 'dice.storm', invitee: 'pawns.jade', milestone: 'decoration.void' };

const DESK = { width: 1280, height: 900 };

const PHONE = { width: 390, height: 844 };

const { record, finish } = recorder('invite pass');

const quoted = (text) => `'${ String(text).replaceAll('\'', '\'\'') }'`;

const owned = (handle) => sql(`select o.item_id || ':' || o.via from owned_items o join users u on u.id = o.user_id where u.handle = ${ quoted(handle) } order by o.item_id`)
    .split(/\r?\n/)
    .filter((line) => line !== '');

/** A page that keeps what its console says and every request it was refused, and talks to the api as its own session. */
const watched = (context, page, who) =>
{
    const errors = [];

    page.on('console', (event) =>
    {
        if (chainUnreached(event, who()))
        {
            return;
        }

        if ((event.type() === 'error' || event.type() === 'warning') && !event.text().includes('favicon'))
        {
            errors.push(`${ who() }: ${ event.text().slice(0, 160) }`);
        }
    });
    page.on('pageerror', (error) => errors.push(`${ who() }: ${ String(error).slice(0, 160) }`));

    const api = async (method, path, data) =>
    {
        const response = method === 'GET'
            ? await context.request.get(`${ BASE }/api${ path }`)
            : await context.request.post(`${ BASE }/api${ path }`, data === undefined ? {} : { data });

        return { status: response.status(), body: await response.json().catch(() => null) };
    };

    return { errors, api };
};

/** Somebody signed in by a key the pass holds, through the server's own challenge, with a page of their own. */
const keySeat = async (browser, key, name, viewport) =>
{
    const context = await browser.newContext({ viewport, locale: 'en-US' });

    await context.addCookies([{ name: 'locale', value: 'en', url: BASE }]);

    const post = async (path, data) =>
    {
        const answer = await context.request.post(`${ BASE }/api${ path }`, { data });

        return { status: answer.status(), body: await answer.json().catch(() => null) };
    };

    const handle = (await signInWallet(post, name, privateKeyToAccount(key))).handle;
    const page = await context.newPage();

    return { handle, context, page, ...watched(context, page, () => handle) };
};

/**
 * Somebody nobody has been yet, with a wallet in their page as an extension would put one (announced as EIP-6963 says),
 * signed in by nothing: they sign in through the page itself, which is how an invite link's code reaches the server.
 */
const newcomer = async (browser, language, viewport) =>
{
    const account = privateKeyToAccount(generatePrivateKey());
    const context = await browser.newContext({ viewport, locale: language === 'fa' ? 'fa-IR' : 'en-US' });
    const asked = [];

    await context.addCookies([{ name: 'locale', value: language, url: BASE }]);
    await context.exposeFunction('invitePassWallet', async (method, params) =>
    {
        asked.push(method);

        if (method === 'eth_requestAccounts' || method === 'eth_accounts')
        {
            return [account.address];
        }

        if (method === 'eth_chainId')
        {
            return '0x3fc';
        }

        if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain')
        {
            return null;
        }

        if (method === 'wallet_getPermissions' || method === 'wallet_requestPermissions')
        {
            return [{ parentCapability: 'eth_accounts' }];
        }

        if (method === 'personal_sign')
        {
            return account.signMessage({ message: /^0x[0-9a-f]*$/i.test(params[0]) ? { raw: params[0] } : params[0] });
        }

        throw { code: 4200, message: `${ method } is not answered by the invite pass` };
    });
    await context.addInitScript(() =>
    {
        const provider = {
            request: ({ method, params }) => window.invitePassWallet(method, params ?? []),
            on: () => undefined,
            removeListener: () => undefined
        };
        const info = Object.freeze({ uuid: '0b4c2e7a-6a8f-4f0e-9c8e-1d2f3a4b5c6d', name: 'Invite pass wallet', icon: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 8 8%22%3E%3Crect width=%228%22 height=%228%22 fill=%22%233B82F6%22/%3E%3C/svg%3E', rdns: 'test.invite.pass' });
        const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }));

        window.addEventListener('eip6963:requestProvider', announce);
        announce();
    });

    const page = await context.newPage();
    const seat = { handle: '', account, asked, context, page };

    return Object.assign(seat, watched(context, page, () => seat.handle || 'a newcomer'));
};

/** A chess game a move a day for the owner and a friend, a move each and then the friend gives up: a game played out by both. */
const playedOut = async (owner, friend) =>
{
    const table = await owner.api('POST', '/tables/', tableBody({ game: 'chess', seats: 2, mode: 'turns', privacy: 'public' }));

    if (table.status !== 200)
    {
        return { ok: false, detail: `the table answered ${ table.status }` };
    }

    await friend.api('POST', `/tables/${ table.body.id }/seat`);

    for (const one of [owner, friend])
    {
        await one.api('POST', `/tables/${ table.body.id }/ready`, { ready: true });
    }

    const started = await owner.api('POST', `/tables/${ table.body.id }/start`);

    if (started.status !== 200)
    {
        return { ok: false, detail: `the start answered ${ started.status } ${ started.body?.error?.code ?? '' }` };
    }

    const id = started.body.id;
    const read = async (who) => (await who.api('GET', `/matches/${ id }`)).body;
    const first = await read(owner);
    const white = first.mine === first.view.white ? owner : friend;
    const black = white === owner ? friend : owner;
    let keys = 0;

    const move = async (who, from, to) =>
    {
        keys += 1;

        return who.api('POST', `/matches/${ id }/play`, { key: `${ id }-${ keys }`, rev: (await read(who)).rev, play: { kind: 'chess', verb: 'move', from: squareNamed(from), to: squareNamed(to) } });
    };

    const opened = await move(white, 'e2', 'e4');
    const answered = await move(black, 'e7', 'e5');

    keys += 1;

    const resigned = await friend.api('POST', `/matches/${ id }/resign`, { key: `${ id }-${ keys }` });
    const end = await read(owner);

    return {
        ok: opened.status === 200 && answered.status === 200 && resigned.status === 200 && end.view.over?.reason === 'resign',
        detail: `moves ${ opened.status } ${ answered.status }, resign ${ resigned.status }, ${ JSON.stringify(end.view.over ?? null) }`
    };
};

/** Presses the page's own Connect wallet, and the wallet in the chooser where the chooser lists it; true once the app is open. */
const signsIn = async (seat, connect) =>
{
    const inApp = () => new URL(seat.page.url()).pathname.startsWith('/app');
    const choice = seat.page.getByRole('button', { name: /Invite pass wallet/ });

    await seat.page.getByRole('button', { name: connect, exact: true }).first().click();
    await waitFor(async () => inApp() || await choice.count() > 0, 8000);

    if (!inApp() && await choice.count() > 0)
    {
        await choice.first().click();
    }

    return await waitFor(async () => inApp(), 15000);
};

const kinds = async (who) => ((await who.api('GET', '/notifications')).body?.items ?? []).map((one) => one.kind);

const counted = (list, kind) => list.filter((one) => one === kind).length;

const browser = await launch();

try
{
    console.log(`invite pass on ${ BASE }, database ${ databaseName() }\n`);

    const owner = await keySeat(browser, OWNER_KEY, 'Owen Owner', DESK);
    const account = (await owner.api('GET', '/auth/me')).body?.account;

    record('the owner is the wallet the server names', account?.staff === 'owner', String(account?.staff ?? 'no role'));

    if (account?.staff !== 'owner')
    {
        throw new Error('start the server with ADMIN_WALLET_ADDRESS set to hardhat\'s #6, or name another owner\'s key in QA_OWNER_KEY');
    }

    const before = (await owner.api('GET', '/admin/invites')).body;

    if (before?.running !== undefined)
    {
        await owner.api('POST', `/admin/invites/campaigns/${ before.running.id }/state`, { to: 'ended', reason: REASON });
    }

    const name = `Invite pass ${ Date.now().toString(36) }`;
    const written = await owner.api('POST', '/admin/invites/campaigns', { name, inviterItem: LOOKS.inviter, inviteeItem: LOOKS.invitee, milestones: [{ count: 2, item: LOOKS.milestone }], review: false, reason: REASON });
    const started = written.status === 200 ? await owner.api('POST', `/admin/invites/campaigns/${ written.body.id }/state`, { to: 'active', reason: REASON }) : written;
    const running = (await owner.api('GET', '/admin/invites')).body?.running;

    record('a campaign is written and runs', started.status === 200 && running?.name === name, `${ written.status } ${ started.status } ${ running?.name ?? 'none running' }`);

    const inviter = await keySeat(browser, generatePrivateKey(), 'Ines Inviter', DESK);

    await inviter.page.goto(`${ BASE }/app/invite`);
    await inviter.page.waitForSelector('[data-invite-url]');

    const link = (await inviter.page.textContent('[data-invite-url]'))?.trim() ?? '';
    const code = (await inviter.page.textContent('[data-invite-code]'))?.trim() ?? '';

    record('the inviter is shown their link with their code in it', link === `${ BASE }/join/${ code }` && /^[A-Z2-9]{8}$/.test(code), link);

    const gives = await waitFor(async () => (await inviter.page.locator('[data-gives]').count()) === 3, 6000);

    record('the invite page says what the running campaign gives',
        gives && (await inviter.page.locator('[data-invite-campaign] h2').textContent())?.includes(name) === true,
        (await inviter.page.locator('[data-gives]').evaluateAll((all) => all.map((one) => one.getAttribute('data-gives')))).join(' '));

    await inviter.page.getByRole('tab', { name: 'Top inviters' }).click();
    await inviter.page.waitForSelector('[data-top-empty], [data-top-rows]');

    record('nobody is among the top inviters yet, and the reader is told they are not', await inviter.page.locator('[data-top-empty]').count() === 1 && await inviter.page.locator('[data-top-absent]').count() === 1);

    const first = await newcomer(browser, 'en', DESK);

    await first.page.goto(link.toLowerCase());

    const titled = await waitFor(async () => ((await first.page.locator('h1').first().textContent()) ?? '').includes('Ines Inviter invited you to Baziche'), 8000);

    record('a link opened lower-cased shows who sent it', titled, (await first.page.locator('h1').first().textContent()) ?? 'no heading');

    const arrived = await signsIn(first, 'Connect wallet');

    first.handle = (await first.api('GET', '/auth/me')).body?.account?.handle ?? '';
    record('the friend signs in from the link\'s page with one signature and lands in the app', arrived && first.handle !== '' && counted(first.asked, 'personal_sign') === 1, `${ first.page.url() }, ${ counted(first.asked, 'personal_sign') } signatures`);
    await first.api('POST', '/auth/profile', { displayName: 'Farah First', bio: '' });

    const joined = await waitFor(async () => (await inviter.api('GET', '/invites')).body?.joined === 1, 6000);
    const summary = (await inviter.api('GET', '/invites')).body;

    record('the friend is credited to the inviter, and the device that opened the link counted', joined && summary.visits >= 1, `joined ${ summary?.joined }, visits ${ summary?.visits }`);
    record('the inviter is told their friend joined', await waitFor(async () => counted(await kinds(inviter), 'invite-joined') === 1, 6000));

    await inviter.page.goto(`${ BASE }/app/invite`);

    record('the inviter\'s page lists the friend as joined',
        await waitFor(async () => (await inviter.page.locator(`[data-invited="${ first.handle }"]`).getAttribute('data-step').catch(() => null)) === 'joined', 6000));

    const backdated = sql(`update referrals set created_at = now() - interval '20 minutes' where invitee_id = (select id from users where handle = ${ quoted(first.handle) }) returning invitee_id`);

    record('the first friend joined twenty minutes ago, so their first game is no quick one (written by hand)', backdated !== '');

    const firstGame = await playedOut(owner, first);

    record('the first friend plays a game out against the owner', firstGame.ok, firstGame.detail);

    const played = await waitFor(async () => (await inviter.api('GET', '/invites')).body?.played === 1, 8000);

    record('the invite counts once the friend has played a game the inviter did not', played);
    record('the inviter is told their friend played', await waitFor(async () => counted(await kinds(inviter), 'invite-played') === 1, 6000));

    const given = await waitFor(async () => owned(inviter.handle).includes(`${ LOOKS.inviter }:reward`) && owned(first.handle).includes(`${ LOOKS.invitee }:reward`), 8000);

    record('the campaign gives both looks at once, the inviter\'s and the friend\'s', given, `${ owned(inviter.handle).join(' ') } / ${ owned(first.handle).join(' ') }`);
    record('both are told what they were given', await waitFor(async () => counted(await kinds(inviter), 'invite-reward') === 1 && counted(await kinds(first), 'invite-reward') === 1, 6000));

    await inviter.page.goto(`${ BASE }/app/invite`);

    record('the inviter\'s page says the friend played, and counts it',
        await waitFor(async () => (await inviter.page.locator(`[data-invited="${ first.handle }"]`).getAttribute('data-step').catch(() => null)) === 'played', 6000)
            && (await inviter.page.textContent('[data-came="played"] dd'))?.trim() === '1');

    await inviter.page.getByRole('tab', { name: 'Top inviters' }).click();
    await inviter.page.waitForSelector('[data-top-rows]', { timeout: 6000 }).catch(() => undefined);

    const row = inviter.page.locator(`[data-inviter="${ inviter.handle }"]`);

    record('the inviter is first among the top inviters, with one friend, marked as the reader',
        await row.count() === 1 && (await row.locator('[data-place]').textContent())?.trim() === '1'
            && (await row.locator('[data-friends]').textContent())?.replace(/\s+/g, ' ').includes('1 friend') === true
            && !(await row.locator('[data-you]').getAttribute('class'))?.split(' ').includes('hidden'),
        (await row.textContent().catch(() => ''))?.replace(/\s+/g, ' ').trim());

    const second = await newcomer(browser, 'fa', PHONE);

    await second.page.goto(link);

    const persian = await waitFor(async () => ((await second.page.locator('h1').first().textContent()) ?? '').includes('Ines Inviter'), 8000);

    record('the link reads in Persian on a phone, right to left, naming who sent it',
        persian && await second.page.evaluate(() => document.documentElement.dir) === 'rtl' && await second.page.evaluate(() => document.documentElement.scrollWidth) <= PHONE.width,
        (await second.page.locator('h1').first().textContent()) ?? 'no heading');

    const secondIn = await signsIn(second, 'وصل کردن کیف پول');

    second.handle = (await second.api('GET', '/auth/me')).body?.account?.handle ?? '';
    record('the second friend signs in from the Persian page and lands in the app', secondIn && second.handle !== '', second.page.url());
    await second.api('POST', '/auth/profile', { displayName: 'Sami Second', bio: '' });

    const secondGame = await playedOut(owner, second);

    record('the second friend plays a game out against the owner at once', secondGame.ok, secondGame.detail);
    record('their invite counts too', await waitFor(async () => (await inviter.api('GET', '/invites')).body?.played === 2, 8000));

    const waiting = async () => (await owner.api('GET', '/admin/invites/rewards?list=review')).body?.rewards ?? [];

    await waitFor(async () => (await waiting()).length === 3, 8000);

    const held = await waiting();
    const heldInviter = held.find((one) => one.kind === 'inviter');
    const heldFriend = held.find((one) => one.kind === 'invitee');
    const heldMilestone = held.find((one) => one.kind === 'milestone');

    record('a first game finished within ten minutes of joining holds both its rewards for the staff, flagged quick',
        heldInviter?.flags?.includes('quick') === true && heldFriend?.person?.handle === second.handle && heldFriend?.flags?.includes('quick') === true,
        held.map((one) => `${ one.kind }:${ (one.flags ?? []).join('+') }`).join(' '));
    record('two friends played is the milestone, and its reward waits for the staff', heldMilestone?.milestone === 2 && heldMilestone?.item === LOOKS.milestone);
    record('nobody is told of a reward that waits', counted(await kinds(second), 'invite-reward') === 0 && counted(await kinds(inviter), 'invite-reward') === 1);
    record('the overview counts the rewards that wait', (await owner.api('GET', '/admin/invites')).body?.waiting === 3);

    const decide = async (reward, to, button, list = '') =>
    {
        await owner.page.goto(`${ BASE }/admin/invites?view=rewards${ list === '' ? '' : `&list=${ list }` }`);
        await owner.page.waitForSelector(`[data-reward="${ reward.id }"]`, { timeout: 8000 });
        await owner.page.locator(`[data-reward="${ reward.id }"] [data-decide="${ to }"] button`).click();
        await owner.page.locator('#admin-reason').fill(REASON);
        await owner.page.getByRole('dialog').getByRole('button', { name: button }).click();

        const pressed = Date.now();
        const shown = await waitFor(async () => await owner.page.locator(`[data-reward="${ reward.id }"] [data-decide="${ to }"]`).count() === 0, 1500);
        const shownIn = Date.now() - pressed;
        const answered = await waitFor(async () =>
        {
            const all = (await owner.api('GET', '/admin/invites/rewards?list=all')).body?.rewards ?? [];

            return all.find((one) => one.id === reward.id)?.state === to;
        }, 8000);

        return { shown, shownIn, answered };
    };

    const gave = heldFriend === undefined ? null : await decide(heldFriend, 'given', 'Give it');

    record('the owner gives the second friend\'s look from Admin › Invites, shown at the press and kept by the server',
        gave?.shown === true && gave.answered && owned(second.handle).includes(`${ LOOKS.invitee }:reward`),
        `${ gave?.shownIn ?? '-' } ms, ${ owned(second.handle).join(' ') }`);
    record('the second friend is told once it is given', await waitFor(async () => counted(await kinds(second), 'invite-reward') === 1, 6000));

    const refused = heldInviter === undefined ? null : await decide(heldInviter, 'refused', 'Refuse it');

    record('the owner refuses the inviter\'s second look, and nobody is told', refused?.shown === true && refused.answered && counted(await kinds(inviter), 'invite-reward') === 1);

    const milestoneGiven = heldMilestone === undefined ? null : await decide(heldMilestone, 'given', 'Give it');

    const ownsMilestone = owned(inviter.handle).includes(`${ LOOKS.milestone }:reward`);
    const toldOfMilestone = await waitFor(async () => counted(await kinds(inviter), 'invite-reward') === 2, 6000);

    record('the owner gives the milestone, and the inviter owns its look and is told',
        milestoneGiven?.answered === true && ownsMilestone && toldOfMilestone,
        `answered ${ milestoneGiven?.answered }, owned ${ ownsMilestone }, told ${ toldOfMilestone }`);

    const takenBack = heldMilestone === undefined ? null : await decide(heldMilestone, 'taken', 'Take it back', 'given');

    record('the owner takes the milestone back, its look leaves the inviter, and nobody is told',
        takenBack?.shown === true && takenBack.answered && !owned(inviter.handle).some((one) => one.startsWith(`${ LOOKS.milestone }:`)) && counted(await kinds(inviter), 'invite-reward') === 2,
        owned(inviter.handle).join(' '));
    const logged = ((await owner.api('GET', '/admin/log?kind=invite-reward')).body?.rows ?? [])
        .filter((one) => one.person === inviter.handle || one.person === second.handle);

    record('the log keeps every decision, each with its reason', logged.length === 4 && logged.every((one) => one.reason === REASON), `${ logged.length } rows`);

    await inviter.page.goto(`${ BASE }/app/me/settings`);

    const toggle = inviter.page.getByRole('switch', { name: /Show me among the top inviters/ });

    await toggle.waitFor({ timeout: 8000 });
    await toggle.click();

    const off = await waitFor(async () => await toggle.getAttribute('aria-checked') === 'false', 1000);
    const board = (await inviter.api('GET', '/invites/top')).body;

    record('the inviter keeps themselves off the top inviters from Settings, shown at the press',
        off && board?.listed === false && !(board?.rows ?? []).some((one) => one.person.handle === inviter.handle));

    await inviter.page.goto(`${ BASE }/app/invite?tab=top`);

    record('the board says the reader chose not to be shown, with the way back to the switch',
        await waitFor(async () => await inviter.page.locator('[data-top-hidden]').count() === 1, 6000)
            && await inviter.page.getByRole('link', { name: 'Change it in Settings' }).getAttribute('href') === '/app/me/settings#settings-safety');

    await inviter.page.getByRole('link', { name: 'Change it in Settings' }).click();
    await inviter.page.waitForURL(/settings/);

    const toggleAgain = inviter.page.getByRole('switch', { name: /Show me among the top inviters/ });

    await toggleAgain.waitFor({ timeout: 8000 });
    await toggleAgain.click();

    record('and shown again once they turn it back on',
        await waitFor(async () => ((await inviter.api('GET', '/invites/top')).body?.rows ?? []).some((one) => one.person.handle === inviter.handle), 6000));

    for (const [label, seat] of [['the owner', owner], ['the inviter', inviter], ['the first friend', first], ['the second friend', second]])
    {
        record(`${ label }'s console says nothing`, seat.errors.length === 0, seat.errors.slice(0, 3).join(' | '));
    }
}
catch (error)
{
    record('the pass ran to its end', false, String(error).slice(0, 300));
}
finally
{
    await browser.close();
    finish();
}
