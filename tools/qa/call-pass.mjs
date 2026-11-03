/**
 * Calls in two real browsers on the BUILT server, run by hand:
 *
 *   QA_BASE=http://localhost:5300 node tools/qa/call-pass.mjs
 *
 * `dana.w` is a desk and `sara.k` a phone, each a Chromium with a fake microphone, made friends
 * over the api if they are not. Everything else is pressed on the page, as a person does it:
 *
 * - A call between the two from the head of their thread: the caller shown it at once, the other
 *   rung on whatever page they are on, answered, live for both and counting, hung up, and the line
 *   in the thread said from each side.
 * - A call declined: the caller told so, and it ends as declined.
 * - A group's voice chat: begun from the head of a group's thread, the strip there its bar; the other
 *   joins from the strip, both in it; the one who began it takes the other out from the call's view,
 *   and the strip tells them so and offers no Join; then it is ended for everyone, the strip gone
 *   from both and the room told how long it ran.
 * - The Calls tab of each lists those calls, newest first, each in its own words.
 * - Neither console says anything.
 *
 * It makes a group of its own each run, and leaves it behind: run it against a disposable database.
 */
import { BASE, launch, recorder, seat, waitFor } from './seats.mjs';

const { record, finish } = recorder('call pass');

const browser = await launch(['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required']);

const callsOf = async (who) => (await who.api('GET', '/calls')).body?.calls ?? [];

const openCall = async (who) => (await callsOf(who)).find((one) => one.state !== 'ended') ?? null;

/** Every line the server wrote in a room, newest last, as `{ key, params }`. */
const linesOf = async (who, room) => ((await who.api('GET', `/chat/${ room }/messages`)).body?.messages ?? [])
    .filter((one) => one.kind === 'system')
    .map((one) => one.payload);

const text = async (page, selector) => ((await page.locator(selector).first().textContent({ timeout: 2000 }).catch(() => null)) ?? '').trim();

/** The Calls tab's rows on a page, top first, as what each says. */
const callRows = async (page) => await page.evaluate(() => [...document.querySelectorAll('[data-call-record]')].map((row) => ({
    name: row.querySelector('[data-call-record-name]')?.textContent?.trim() ?? '',
    said: row.querySelector('[data-call-record-said]')?.textContent?.trim() ?? ''
})));

const showCalls = async (who) =>
{
    await who.page.goto(`${ BASE }/app/chats`);
    await who.page.getByRole('tab', { name: 'Calls' }).click();
    await waitFor(async () => (await callRows(who.page)).length > 0, 10_000);

    return await callRows(who.page);
};

try
{
    const dana = await seat(browser, 'dana.w', { width: 1280, height: 860 });
    const sara = await seat(browser, 'sara.k', { width: 390, height: 844 });

    await dana.api('POST', '/social/requests', { id: 'sara.k' });
    await sara.api('POST', '/social/requests', { id: 'dana.w' });

    const friends = (await dana.api('GET', '/social')).body?.friends ?? [];

    record('dana and sara are friends', friends.some((one) => one.id === 'sara.k'));

    for (const who of [dana, sara])
    {
        for (const call of await callsOf(who))
        {
            if (call.state !== 'ended')
            {
                await who.api('POST', `/calls/${ call.id }/hang-up`);
            }
        }
    }

    const direct = (await dana.api('POST', '/chat/direct', { id: 'sara.k' })).body?.id;

    record('their conversation', typeof direct === 'string');

    // A call answered.
    await sara.page.goto(`${ BASE }/app`);
    await dana.page.goto(`${ BASE }/app/chats/${ direct }`);
    await dana.page.locator('header [data-head-call] button').click();

    record('the caller is shown the call at the press', await waitFor(async () => (await dana.page.locator('[data-call-card]').count()) > 0, 3000));
    record('the other is rung on the page they are on', await waitFor(async () => (await sara.page.locator('[data-call-accept] button').count()) > 0, 15_000));
    record('and the caller told it rings', await waitFor(async () => /Ringing/.test(await text(dana.page, '[data-call-status]')), 10_000), await text(dana.page, '[data-call-status]'));

    await sara.page.locator('[data-call-accept] button').click();

    const answered = await waitFor(async () => (await openCall(dana))?.state === 'live' && (await openCall(sara))?.state === 'live', 15_000);

    record('answered, it is live for both', answered);

    const before = await text(dana.page, '[data-call-status]');

    await new Promise((resolve) => setTimeout(resolve, 2500));

    const after = await text(dana.page, '[data-call-status]');

    record('the call counts its time', /\d:\d\d/.test(after) && after !== before, `${ before } then ${ after }`);

    const talked = (await openCall(dana))?.id;

    await dana.page.locator('[data-call-hang-up] button').first().click();

    record('hung up, it ends for both', await waitFor(async () => (await openCall(dana)) === null && (await openCall(sara)) === null, 10_000));

    const said = await waitFor(async () => (await linesOf(dana, direct)).some((line) => line?.key === 'chat.line.call' && line.params?.ending === 'answered'), 10_000);

    record('the thread is told how it went', said);
    record('the caller reads an outgoing call in the thread', await waitFor(async () => /Outgoing call · \d+:\d\d/.test(await dana.page.locator('main').textContent() ?? ''), 10_000));

    // A call declined.
    await dana.page.locator('header [data-head-call] button').click();
    await sara.page.locator('[data-call-decline] button').waitFor({ timeout: 15_000 });
    await sara.page.locator('[data-call-decline] button').click();

    record('declined, the caller is told so', await waitFor(async () => /declined/.test(await text(dana.page, '[data-call-status]')), 10_000), await text(dana.page, '[data-call-status]'));

    const declined = (await callsOf(dana)).find((one) => one.id !== talked);

    record('and it ended as declined', declined?.ending === 'declined', declined?.ending ?? 'none');

    // A group's voice chat.
    const made = await dana.api('POST', '/groups', { name: `Call pass ${ Date.now() % 100_000 }`, blurb: '', crest: 'crest-crown', hue: 40, game: '', privacy: 'public' });
    const slug = made.body?.slug;
    const room = made.body?.conversationId;

    await sara.api('POST', `/groups/${ slug }/join`);
    record('a group of the two', typeof room === 'string');

    await dana.page.goto(`${ BASE }/app/chats/${ room }`);
    await dana.page.locator('header [data-head-voice] button').click();

    record('begun from the head, the strip is its bar', await waitFor(async () => (await dana.page.locator('[data-voice-chat-open] button').count()) > 0, 10_000));

    await sara.page.goto(`${ BASE }/app/chats/${ room }`);

    record('the other is offered Join on the strip', await waitFor(async () => (await sara.page.locator('[data-voice-chat-join] button').count()) > 0, 10_000));

    await sara.page.locator('[data-voice-chat-join] button').click();

    record('joined, both are in it', await waitFor(async () => /^2 /.test(await text(dana.page, '[data-voice-chat-here]')) && /^2 /.test(await text(sara.page, '[data-voice-chat-here]')), 15_000), `${ await text(dana.page, '[data-voice-chat-here]') } / ${ await text(sara.page, '[data-voice-chat-here]') }`);

    await dana.page.locator('[data-voice-chat-open] button').click();
    await dana.page.getByRole('button', { name: 'Take Sara Kamali out of the voice chat' }).click();
    await dana.page.getByRole('dialog', { name: 'Take Sara Kamali out of the voice chat?' }).getByRole('button', { name: 'Take them out' }).click();

    record('taken out, the strip says so', await waitFor(async () => /taken out/.test(await text(sara.page, '[data-voice-chat-removed]')), 10_000), await text(sara.page, '[data-voice-chat-removed]'));
    record('and offers no Join', (await sara.page.locator('[data-voice-chat-join]').count()) === 0);

    await dana.page.getByRole('button', { name: 'End for everyone' }).click();
    await dana.page.getByRole('dialog', { name: 'End the voice chat for everyone?' }).getByRole('button', { name: 'End it' }).click();

    record('ended for everyone, the strip leaves both', await waitFor(async () => (await dana.page.locator('[data-voice-chat]').count()) === 0 && (await sara.page.locator('[data-voice-chat]').count()) === 0, 15_000));
    record('and the room is told how long it ran', await waitFor(async () => (await linesOf(dana, room)).some((line) => line?.key === 'chat.line.voice.ended'), 10_000));

    // The Calls tab.
    const danas = await showCalls(dana);

    record('the caller\'s Calls tab, newest first', danas.length >= 3 && /Voice chat ended/.test(danas[0].said) && /Declined call/.test(danas[1].said) && /Outgoing call/.test(danas[2].said) && danas[1].name === 'Sara Kamali', JSON.stringify(danas.slice(0, 3)));

    const saras = await showCalls(sara);

    record('the other\'s, from their own side', saras.length >= 3 && /Voice chat ended/.test(saras[0].said) && /Declined call/.test(saras[1].said) && /Incoming call/.test(saras[2].said) && saras[1].name === 'Dana Whitfield', JSON.stringify(saras.slice(0, 3)));

    record('neither console says anything', dana.errors.length === 0 && sara.errors.length === 0, [...dana.errors, ...sara.errors].join(' | '));
}
catch (error)
{
    record('the pass ran to its end', false, String(error).split('\n')[0]);
}
finally
{
    await browser.close();
    finish();
}
