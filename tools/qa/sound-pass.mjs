import { sql } from './db.mjs';
import { BASE, clearTables, launch, recorder, seat, waitFor } from './seats.mjs';
import { tableBody } from './tables.mjs';
import { TABLE_PACKS } from '../../frontend/src/game/sound-files.ts';

/**
 * What a page hears, named: every recording a page starts is known by its decoded samples, matched against
 * the takes of the packs the page fetched, so a sound is named by its pack and its cue (`ludo:die-land`); a
 * synthesised voice is `tone`, and a recording no pack holds is `unknown`. Each is kept with when it was started
 * and how far ahead of the audio clock it was asked to begin (`ahead`, in ms), and each pack is decoded once. The
 * media elements a bed plays on are logged as they play, pause and seek.
 */
const PROBE = `(() => {
    const heard = [];
    const media = [];
    const copies = [];
    const now = () => Math.round(performance.now());
    const sumOf = (buffer) => {
        if (!buffer) { return null; }
        const data = buffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) { sum += Math.abs(data[i]); }
        return { len: buffer.length, rate: buffer.sampleRate, sum: Math.round(sum * 1000) / 1000 };
    };
    const take = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) { heard.push({ t: now(), take: sumOf(this.buffer), ahead: Math.round(((args[0] ?? 0) - this.context.currentTime) * 1000) }); return take.apply(this, args); };
    const tone = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...args) {
        const last = heard[heard.length - 1];
        if (!(last && last.tone && now() - last.t < 5)) { heard.push({ t: now(), tone: true }); }
        return tone.apply(this, args);
    };
    const idOf = (element) => { if (!copies.includes(element)) { copies.push(element); } return copies.indexOf(element); };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) { media.push({ t: now(), copy: idOf(this), what: 'play', src: this.src }); return play.apply(this, args); };
    const pause = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.pause = function (...args) { media.push({ t: now(), copy: idOf(this), what: 'pause', src: this.src }); return pause.apply(this, args); };
    window.__sound = { heard, media, copies };
    window.__playing = () => copies.filter((one) => !one.paused).length;
    window.__fetched = (ending) => performance.getEntriesByType('resource').map((one) => one.name).filter((name) => name.split('?')[0].endsWith(ending)).map((name) => name.split('/').pop().split('-')[0]);
    window.__packs = () => [...new Set(performance.getEntriesByType('resource').map((one) => one.name.split('?')[0]).filter((name) => name.endsWith('.cues')).map((name) => name.split('/').pop().replace(/-[\\w-]{8}\\.cues$/, '')))];
    const names = new Map();
    const decoded = new Set();
    window.__timed = async (from = 0) => {
        const urls = [...new Set(performance.getEntriesByType('resource').map((one) => one.name).filter((name) => /\\.cues(\\?|$)/.test(name)))];
        const rates = [...new Set(heard.filter((one) => one.take).map((one) => one.take.rate))];
        for (const url of urls) {
            for (const rate of rates.filter((one) => !decoded.has(url + ' ' + one))) {
                decoded.add(url + ' ' + rate);
                const pack = url.split('/').pop().split('-')[0];
                const bytes = await (await fetch(url)).arrayBuffer();
                const size = new DataView(bytes).getUint32(4, true);
                const index = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 8, size)));
                for (const [cue, takes] of Object.entries(index)) {
                    for (const [offset, length] of takes) {
                        const taken = await new OfflineAudioContext(1, 1, rate).decodeAudioData(bytes.slice(8 + size + offset, 8 + size + offset + length));
                        names.set(JSON.stringify(sumOf(taken)), pack + ':' + cue);
                    }
                }
            }
        }
        return heard.slice(from).map((one) => ({ t: one.t, ahead: one.ahead ?? 0, name: one.tone ? 'tone' : (names.get(JSON.stringify(one.take)) ?? 'unknown') }));
    };
    window.__name = async (from = 0) => (await window.__timed(from)).map((one) => one.name);
})();`;

const { record, finish } = recorder('sound pass');
const browser = await launch(['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']);
const dana = await seat(browser, 'dana.w');
const mina = await seat(browser, 'mina', { width: 390, height: 844 });

await mina.context.addCookies([{ name: 'locale', value: 'fa', url: BASE }]);

for (const player of [dana, mina])
{
    await player.context.addInitScript(PROBE);
    await player.context.grantPermissions(['microphone'], { origin: BASE });
}

const quote = (value) => `'${ value.replaceAll('\'', '\'\'') }'`;

const addressOf = async (player) => String((await player.api('GET', '/auth/me')).body?.account?.address ?? '').toLowerCase();

const addresses = [await addressOf(dana), await addressOf(mina)];

/** Every look both players wear taken off, so a table where nobody wears one is what the first parts hear, whatever a run before left. */
const plain = () => sql(`delete from equipped_items e using wallets w where w.user_id = e.user_id and w.address in (${ addresses.map(quote).join(', ') })`);

plain();

/** A press the page takes as the reader's: the engine is let make its context, and the bed is let play. */
const press = async (page) => await page.evaluate(() => document.body.dispatchEvent(new MouseEvent('click', { bubbles: true })));

const bedSays = async (page) => await page.evaluate(() => document.querySelector('[data-bed]')?.getAttribute('data-bed') ?? null);

const fetched = async (page, ending) => await page.evaluate((what) => window.__fetched(what), ending);

const heardCount = async (page) => await page.evaluate(() => window.__sound.heard.length);

const named = async (page, from) => await page.evaluate((at) => window.__name(at), from);

const timed = async (page, from) => await page.evaluate((at) => window.__timed(at), from);

/** The packs a page has fetched, by name: `common`, `ludo`, a collection's `frost-profile` or `astral-table`. */
const packs = async (page) => await page.evaluate(() => window.__packs());

const idle = async (page) => await waitFor(async () => await page.locator('.table-stage[data-presenting]').count() === 0, 15000);

const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/** A table of two for `game`, both chairs taken and ready, its page open in each browser given. */
const tableOf = async (game, pages, extra = {}) =>
{
    await clearTables(dana, mina);

    const made = await dana.api('POST', '/tables/', tableBody({ game, seats: 2, mode: game === 'poker' ? 'live' : 'turns', ...extra }));

    if (!made.ok)
    {
        throw new Error(`no ${ game } table: ${ made.status } ${ JSON.stringify(made.body).slice(0, 160) }`);
    }

    await mina.api('POST', `/tables/${ made.body.id }/seat`);
    await mina.api('POST', `/tables/${ made.body.id }/ready`, { ready: true });
    await dana.api('POST', `/tables/${ made.body.id }/ready`, { ready: true });

    for (const player of pages)
    {
        await player.page.goto(`${ BASE }/app/play/${ made.body.id }`, { waitUntil: 'networkidle' });
    }

    return made.body.id;
};

/** Plays one thing over the api as whoever is on turn, and answers who played it. */
const act = async (matchId, play, keyed) =>
{
    const read = await dana.api('GET', `/matches/${ matchId }`);
    const match = read.body;
    const mover = match.turn === match.mine ? dana : mina;
    const answer = await mover.api('POST', `/matches/${ matchId }/play`, { key: `sound-${ keyed }-${ Date.now() }`, rev: match.rev, play: typeof play === 'function' ? play(match) : play });

    return { mover, ok: answer.ok, status: answer.status, body: answer.body };
};

/**
 * Plays whatever the seat on turn has to play, chosen from that seat's own view, and waits for both boards to
 * have shown it; false once the game is over.
 */
const step = async (matchId, game, keyed) =>
{
    const seen = (await dana.api('GET', `/matches/${ matchId }`)).body;

    if (seen === null || seen.finishedAt !== undefined)
    {
        return false;
    }

    const mover = (game.who?.(seen.view) ?? seen.turn) === seen.mine ? dana : mina;
    const held = (await mover.api('GET', `/matches/${ matchId }`)).body;
    const play = game.play(held.view);

    if (play === null)
    {
        await new Promise((resolve) => setTimeout(resolve, 300));
    }
    else
    {
        await mover.api('POST', `/matches/${ matchId }/play`, { key: `sound-voice-${ keyed }-${ Date.now() }`, rev: held.rev, play });
    }

    await idle(dana.page);
    await idle(mina.page);

    return true;
};

/** How each game is played to the moment a look's voice is said at it. */
const PLAYED = {
    ludo: { play: (view) => (view.die === undefined ? { kind: 'ludo', verb: 'roll' } : (view.moves.length > 0 ? { kind: 'ludo', verb: 'move', piece: view.moves[0] } : null)) },
    hokm: {
        who: (view) => (view.phase === 'trump' ? view.hakem : view.turn),
        play: (view) => (view.phase === 'trump'
            ? { kind: 'hokm', verb: 'trump', suit: 'spades' }
            : (view.phase === 'discard'
                ? { kind: 'hokm', verb: 'discard', cards: view.hand.slice(0, view.discard) }
                : (view.phase === 'draw' ? { kind: 'hokm', verb: 'keep' } : (view.plays.length > 0 ? { kind: 'hokm', verb: 'card', card: view.plays[0] } : null))))
    },
    poker: { play: (view) => ({ kind: 'poker', verb: (view.toCall ?? 0) > 0 ? 'call' : 'check' }) }
};

/** What dana.w wears in this pass's last part: a look of its own collection in every place a voice is said. */
const WORN = {
    'ludo.dice': 'dice.astral',
    'ludo.pawns': 'pawns.phoenix',
    'hokm.face': 'face.void',
    'poker.face': 'face.void',
    'profile.decoration': 'decoration.frost',
    'profile.effect': 'effect.frost',
    'profile.theme': 'theme.frost',
    'profile.nameplate': 'nameplate.frost'
};

/** What each game is asked to do, and the sound that has to be heard for it in a page that did not do it. */
const STEPS = {
    ludo: { play: { kind: 'ludo', verb: 'roll' }, cue: /^ludo:die-land$/, what: 'a die landing on the board' },
    hokm: { play: { kind: 'hokm', verb: 'trump', suit: 'hearts' }, cue: /^hokm:trump$/, what: 'the trump slapped down' },
    backgammon: { play: { kind: 'backgammon', verb: 'roll' }, cue: /^backgammon:dice-wood$/, what: 'a die on wood' },
    poker: { play: { kind: 'poker', verb: 'call' }, cue: /^poker:(chip-lay|chips-stack)$/, what: 'chips laid on the felt' },
    chess: { play: (match) => ({ kind: 'chess', verb: 'move', from: match.view.turn === 'w' ? 12 : 52, to: match.view.turn === 'w' ? 28 : 36 }), cue: /^chess:piece-move$/, what: 'a piece set down' }
};

try
{
    console.log('\n[1] every table fetches its own packs and its own bed, and is heard in its own sounds');

    for (const game of ['ludo', 'hokm', 'backgammon', 'poker', 'chess'])
    {
        const tableId = await tableOf(game, [dana]);

        await press(dana.page);

        const playing = await waitFor(async () => await bedSays(dana.page) === 'playing', 10000);
        const beds = await fetched(dana.page, '.bed');

        record(`${ game }: the bed comes in once the page may play sound`, playing, `the arena says ${ await bedSays(dana.page) }`);
        record(`${ game }: the bed fetched is the game's own music and nothing else`, same(beds, [game]), beds.join(', '));

        const started = await dana.api('POST', `/tables/${ tableId }/start`);

        if (!started.ok)
        {
            throw new Error(`the ${ game } game did not start: ${ started.status }`);
        }

        const matchId = started.body.id;
        const wanted = TABLE_PACKS[game];
        const packed = await waitFor(async () => same(await fetched(dana.page, '.cues'), wanted), 10000);

        record(`${ game }: the table fetches ${ wanted.join(' and ') }, and no other pack`, packed, (await fetched(dana.page, '.cues')).join(', '));

        await idle(dana.page);

        const from = await heardCount(dana.page);
        const step = STEPS[game];
        const done = await act(matchId, step.play, game);

        record(`${ game }: ${ step.what } is taken by the server`, done.ok, `${ done.status }`);

        const heard = await waitFor(async () => (await named(dana.page, from)).some((name) => step.cue.test(name)), 8000);
        const names = await named(dana.page, from);
        const opening = await named(dana.page, 0);
        const foreign = [...opening, ...names].filter((name) => !wanted.includes(name.split(':')[0]));

        record(`${ game }: ${ step.what } is heard as its own recording`, heard, names.join(', ') || 'nothing');
        record(`${ game }: nothing is heard from another game's pack, synthesised or unknown`, foreign.length === 0, foreign.join(', '));

        if (game === 'hokm' || game === 'poker')
        {
            record(`${ game }: the deal is heard in cards`, opening.some((name) => name.startsWith('cards:')), opening.slice(0, 8).join(', '));
        }
    }

    console.log('\n[2] the end of a game is heard as it went, by each of the two');

    {
        const tableId = await tableOf('chess', [dana, mina]);

        await press(dana.page);
        await press(mina.page);

        const started = await dana.api('POST', `/tables/${ tableId }/start`);
        const matchId = started.body.id;

        await waitFor(async () => same(await fetched(mina.page, '.cues'), TABLE_PACKS.chess), 10000);
        await act(matchId, STEPS.chess.play, 'white');
        await act(matchId, STEPS.chess.play, 'black');
        await idle(dana.page);
        await idle(mina.page);

        const fromDana = await heardCount(dana.page);
        const fromMina = await heardCount(mina.page);
        const resigned = await mina.api('POST', `/matches/${ matchId }/resign`, { key: `sound-resign-${ Date.now() }` });

        record('the second player gives up once both have moved', resigned.ok, `${ resigned.status }`);

        const won = await waitFor(async () => (await named(dana.page, fromDana)).includes('common:win'), 10000);
        const lost = await waitFor(async () => (await named(mina.page, fromMina)).includes('common:lose'), 10000);

        record('the one who won hears the win', won, (await named(dana.page, fromDana)).join(', '));
        record('the one who gave up hears the loss, and not the win', lost && !(await named(mina.page, fromMina)).includes('common:win'), (await named(mina.page, fromMina)).join(', '));
    }

    console.log('\n[3] the background follows the reader');

    {
        const ludo = await tableOf('ludo', [dana]);

        await press(dana.page);
        await waitFor(async () => await bedSays(dana.page) === 'playing', 10000);

        await dana.page.evaluate(() =>
        {
            Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
            document.dispatchEvent(new Event('visibilitychange'));
        });

        const held = await waitFor(async () => await bedSays(dana.page) === 'paused' && await dana.page.evaluate(() => window.__playing()) === 0, 4000);

        record('a hidden tab holds the bed, every copy stopped', held, `${ await bedSays(dana.page) }, ${ await dana.page.evaluate(() => window.__playing()) } playing`);

        await dana.page.evaluate(() =>
        {
            Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
            document.dispatchEvent(new Event('visibilitychange'));
        });

        record('it comes back in when the tab is seen', await waitFor(async () => await bedSays(dana.page) === 'playing' && await dana.page.evaluate(() => window.__playing()) === 1, 4000), `${ await bedSays(dana.page) }`);

        const chess = (await dana.api('POST', '/tables/', tableBody({ game: 'chess', seats: 2, mode: 'turns' }))).body.id;

        await dana.page.goto(`${ BASE }/app/play/${ ludo }`, { waitUntil: 'networkidle' });
        await press(dana.page);
        await waitFor(async () => await bedSays(dana.page) === 'playing', 10000);

        const link = dana.page.locator(`a[href="/app/play/${ chess }"]`).first();
        const linked = await link.count() > 0;

        record('the play header leads to the reader\'s other table', linked);

        if (linked)
        {
            const before = await dana.page.evaluate(() => window.__sound.media.length);
            const heard = await dana.page.evaluate(() => window.__sound.copies.find((one) => !one.paused)?.src ?? '');
            const at = await dana.page.evaluate(() => Math.round(performance.now()));

            await link.click();

            const changed = await waitFor(async () => (await fetched(dana.page, '.bed')).includes('chess') && await bedSays(dana.page) === 'playing', 10000);

            await waitFor(async () => await dana.page.evaluate(({ from, src }) => window.__sound.media.slice(from).some((one) => one.what === 'pause' && one.src === src), { from: before, src: heard }), 4000);
            const log = await dana.page.evaluate((from) => window.__sound.media.slice(from), before);
            const gone = log.filter((one) => one.what === 'pause' && one.src === heard).map((one) => one.t - at);
            const came = log.filter((one) => one.what === 'play' && one.src !== heard);

            record('another game\'s table plays its own music', changed, (await fetched(dana.page, '.bed')).join(', '));
            record('the music that was heard fades out over a second as the next comes in', gone.length > 0 && gone.every((ms) => ms >= 700 && ms <= 2500) && came.length > 0, `let go after ${ gone.join(', ') } ms, ${ came.length } plays of the next`);
        }

        const beds = (await fetched(dana.page, '.bed')).length;

        await dana.page.locator('a[href="/app"]:visible').first().click();

        const quiet = await waitFor(async () => await dana.page.evaluate(() => window.__playing()) === 0, 4000);

        record('leaving the tables lets the bed go', quiet && await bedSays(dana.page) === null, `${ await dana.page.evaluate(() => window.__playing()) } playing`);
        record('a page that is no table fetches no bed', (await fetched(dana.page, '.bed')).length === beds);

        await clearTables(dana, mina);

        const voiced = await dana.api('POST', '/tables/', tableBody({ game: 'ludo', seats: 2, mode: 'turns', voice: 'table' }));

        await dana.page.goto(`${ BASE }/app/play/${ voiced.body.id }`, { waitUntil: 'networkidle' });
        await press(dana.page);

        record('a call at the table brings the bed under it', await waitFor(async () => await bedSays(dana.page) === 'ducked', 15000), `${ await bedSays(dana.page) }`);

        const leave = dana.page.getByRole('button', { name: /^Leave voice/ }).first();

        if (await leave.count() > 0)
        {
            await leave.click();
        }

        record('leaving the call brings it back up', await waitFor(async () => await bedSays(dana.page) === 'playing', 6000), `${ await bedSays(dana.page) }`);

        for (const [label, kind] of [['Birds', 'birds'], ['Rain', 'rain']])
        {
            await dana.page.goto(`${ BASE }/app/me/settings`, { waitUntil: 'networkidle' });

            const choice = dana.page.locator('[role="group"][aria-label="What plays"] button', { hasText: label }).first();

            record(`Settings offers ${ label.toLowerCase() } behind a table`, await choice.count() > 0);

            if (await choice.count() === 0)
            {
                continue;
            }

            await choice.click();
            await dana.page.goto(`${ BASE }/app/play/${ voiced.body.id }`, { waitUntil: 'networkidle' });
            await press(dana.page);

            record(`a table plays ${ kind } once it is chosen`, await waitFor(async () => same(await fetched(dana.page, '.bed'), [kind]) && ['playing', 'ducked'].includes(await bedSays(dana.page)), 10000), (await fetched(dana.page, '.bed')).join(', '));
        }
    }

    console.log('\n[4] the looks\' voices, heard where somebody wears them and only there');

    {
        const [address] = addresses;
        const owned = [...new Set([...Object.values(WORN), 'back.glow'])];

        sql(`insert into owned_items (user_id, item_id, via) select w.user_id, item, 'grant' from wallets w, unnest(array[${ owned.map(quote).join(', ') }]::text[]) item where w.address = ${ quote(address) } on conflict do nothing`);
        sql(`insert into equipped_items (user_id, slot, item_id) select w.user_id, chosen.slot, chosen.item from wallets w, (values ${ Object.entries(WORN).map(([slot, item]) => `(${ quote(slot) }, ${ quote(item) })`).join(', ') }) chosen(slot, item) where w.address = ${ quote(address) } on conflict (user_id, slot) do update set item_id = excluded.item_id`);

        const worn = sql(`select coalesce(string_agg(e.slot || '=' || e.item_id, ',' order by e.slot), '') from equipped_items e join wallets w on w.user_id = e.user_id where w.address = ${ quote(address) }`).split(',');

        record('dana.w wears a look in every place this part listens at', Object.entries(WORN).every(([slot, item]) => worn.includes(`${ slot }=${ item }`)), worn.join(', '));

        await dana.page.goto(`${ BASE }/app`, { waitUntil: 'networkidle' });
        await press(dana.page);
        await dana.page.evaluate(() =>
        {
            window.__struck = [];
            new MutationObserver((records) =>
            {
                for (const one of records)
                {
                    if (one.target.hasAttribute('data-struck'))
                    {
                        window.__struck.push({ t: Math.round(performance.now()), at: one.target.style.getPropertyValue('--struck') });
                    }
                }
            }).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['data-struck'] });
        });

        const fromProfile = await heardCount(dana.page);

        await dana.page.locator('a[href="/app/me"]').first().click();
        await waitFor(async () => (await named(dana.page, fromProfile)).includes('frost:frost.strike'), 10000);

        const profile = await timed(dana.page, fromProfile);
        const reveal = profile.find((one) => one.name === 'frost:frost.reveal');
        const strike = profile.find((one) => one.name === 'frost:frost.strike');
        const [struck] = await dana.page.evaluate(() => window.__struck);
        const profiled = await packs(dana.page);

        record('a profile worn whole says its reveal the moment the reveal begins on the page', reveal !== undefined && struck !== undefined && Math.abs(reveal.t - struck.t) <= 50, `heard at ${ reveal?.t } ms, begun at ${ struck?.t } ms`);
        record('and its set\'s strike as far into it as the sigil is struck', strike !== undefined && struck !== undefined && Math.abs(strike.ahead - Number.parseFloat(struck.at)) <= 20, `started ${ strike?.ahead } ms ahead, the sigil struck at ${ struck?.at }`);
        record('a profile fetches its collection\'s profile voices and no table\'s', profiled.includes('frost-profile') && !profiled.some((name) => name.endsWith('-table')), profiled.join(', '));

        await dana.page.goto(`${ BASE }/app/shop/collection`, { waitUntil: 'networkidle' });
        await press(dana.page);
        await waitFor(async () => await dana.page.locator('[data-slot="hokm.back"] .look-choice').count() > 1, 8000);

        const fromEquip = await heardCount(dana.page);
        const pressed = await dana.page.evaluate(() =>
        {
            const choice = document.querySelectorAll('[data-slot="hokm.back"] .look-choice')[1];
            const at = Math.round(performance.now());

            choice?.click();

            return choice === undefined ? null : at;
        });

        await waitFor(async () => (await named(dana.page, fromEquip)).includes('glow:glow.equip'), 6000);

        const equip = (await timed(dana.page, fromEquip)).find((one) => one.name === 'glow:glow.equip');

        record('a look put on is heard in its collection\'s voice with its burst', pressed !== null && equip !== undefined && equip.t - pressed <= 300, `pressed at ${ pressed } ms, heard at ${ equip?.t } ms`);

        const LISTENED = {
            ludo: { voices: ['astral:astral.die', 'phoenix:phoenix.spawn', 'phoenix:phoenix.pawn'], packs: ['common', 'ludo', 'astral-table', 'phoenix-table'], both: true, most: 200 },
            hokm: { voices: ['void:void.card'], packs: ['common', 'cards', 'hokm', 'void-table'], both: true, most: 120 },
            poker: { voices: ['void:void.card'], packs: ['common', 'cards', 'poker', 'void-table'], both: false, most: 120 }
        };

        for (const [game, listened] of Object.entries(LISTENED))
        {
            const tableId = await tableOf(game, [dana, mina]);

            await press(dana.page);
            await press(mina.page);

            const matchId = (await dana.api('POST', `/tables/${ tableId }/start`)).body?.id;
            const fromDana = await heardCount(dana.page);
            const fromMina = await heardCount(mina.page);
            const listeners = listened.both ? [dana, mina] : [mina];

            for (let turn = 0; turn < listened.most; turn += 1)
            {
                if (turn % 4 === 0)
                {
                    const heard = await Promise.all(listeners.map(async (player) => await named(player.page, player === dana ? fromDana : fromMina)));

                    if (heard.every((names) => listened.voices.every((name) => names.includes(name))))
                    {
                        break;
                    }
                }

                if (!(await step(matchId, PLAYED[game], `${ game }-${ turn }`)))
                {
                    break;
                }
            }

            const sides = [[dana, fromDana], [mina, fromMina]];

            for (const [player, from] of sides)
            {
                const names = await named(player.page, from);
                const fetchedThere = await packs(player.page);
                const known = new Set(listened.packs.map((pack) => pack.split('-')[0]));
                const stray = names.filter((name) => !known.has(name.split(':')[0]));

                if (listeners.includes(player))
                {
                    record(`${ game }: ${ player.handle } hears ${ listened.voices.map((name) => name.split(':')[1]).join(', ') } where dana.w's looks play them`, listened.voices.every((name) => names.includes(name)), [...new Set(names.filter((name) => name.includes('.')))].join(', ') || 'no voice');
                }

                record(`${ game }: ${ player.handle }'s table fetches the game's packs and the voices of the looks played there, and nothing else`, same(fetchedThere, listened.packs), fetchedThere.join(', '));
                record(`${ game }: ${ player.handle } hears nothing unknown, synthesised, or of a look nobody there wears`, stray.length === 0, stray.slice(0, 6).join(', '));
            }

            await clearTables(dana, mina);
        }

        plain();
    }

    console.log('\n[5] the consoles');

    record('dana.w\'s console says nothing', dana.errors.length === 0, dana.errors.slice(0, 3).join(' | '));
    record('mina\'s console says nothing', mina.errors.length === 0, mina.errors.slice(0, 3).join(' | '));
}
catch (error)
{
    record('the pass ran to its end', false, String(error).slice(0, 300));
}
finally
{
    await clearTables(dana, mina).catch(() => undefined);
    await browser.close();
    finish();
}
