const LIST = '/app/notifications';

const KEPT = 'nura-notices';

const WORDS = '/notice-words.json';

const MARK = '/notice-mark.json';

const MOST = 3;

const OFFLINE = '/offline.html';

const SHELF = 'nura-offline';

const PICTURES = { icon: '/apple-touch-icon.png', badge: '/favicon-32.png' };

// An iPhone or an iPad, which says Macintosh with a touch screen when it asks for the desktop site.
const APPLE = /iPhone|iPad|iPod/.test(self.navigator?.userAgent ?? '') || ((self.navigator?.userAgent ?? '').includes('Macintosh') && (self.navigator?.maxTouchPoints ?? 0) > 1);

const PLAIN = { lang: 'en', tag: 'en-US', dir: 'ltr', general: 'Something new in Baziche', says: {}, games: {} };

const HOLE = /\{([a-zA-Z0-9_]+)\}/g;

const nuraOf = (wei) => Number(BigInt(wei) / 10n ** 14n) / 10_000;

const kept = async (url) =>
{
    try
    {
        const found = await (await caches.open(KEPT)).match(url);

        return found === undefined ? null : await found.json();
    }
    catch
    {
        return null;
    }
};

const keep = async (url, value) =>
{
    try
    {
        await (await caches.open(KEPT)).put(url, new Response(JSON.stringify(value)));
    }
    catch
    {
        return;
    }
};

const read = async (url) =>
{
    const answer = await fetch(url, { headers: { accept: 'application/json' } });

    if (!answer.ok)
    {
        throw new Error(`${ url } answered ${ answer.status }`);
    }

    return await answer.json();
};

const fill = (message, vars, tag) =>
{
    const form = typeof message === 'string'
        ? message
        : message[new Intl.PluralRules(tag).select(Number(vars.count ?? 0))] ?? message.other;

    return form.replace(HOLE, (whole, name) =>
    {
        const value = vars[name];

        if (value === undefined)
        {
            return whole;
        }

        return typeof value === 'number' ? new Intl.NumberFormat(tag).format(value) : value;
    });
};

const placeOf = (tab) =>
{
    const at = new URL(tab.url);

    return at.pathname + at.search;
};

const inApp = (tab) => /^\/app(\/|\?|$)/.test(placeOf(tab));

const tagOf = (row) =>
{
    if (row.kind === 'message')
    {
        return `chat:${ row.ref.conversationId ?? '' }`;
    }

    if (row.kind === 'friend-request')
    {
        return 'request';
    }

    return `${ row.kind }:${ row.ref.tableId ?? row.ref.groupId ?? row.ref.channelId ?? row.ref.conversationId ?? row.actor ?? '' }`;
};

const leadOf = (row) =>
{
    if (row.kind === 'friend-request')
    {
        return '/app/friends?tab=requests';
    }

    if (row.kind === 'table-removed')
    {
        return '/app/games';
    }

    if (row.kind === 'gift' || row.kind === 'invite-reward')
    {
        return '/app/shop/collection';
    }

    if (row.kind === 'reward-ready' || row.kind === 'reward-streak')
    {
        return '/app/rewards';
    }

    if (row.kind === 'invite-joined' || row.kind === 'invite-played')
    {
        return '/app/invite';
    }

    if (row.kind === 'donation')
    {
        return '/app/me/wallet';
    }

    if (row.ref.tournament !== undefined && row.kind !== 'tournament-game')
    {
        return `/app/tournaments/${ row.ref.tournament }`;
    }

    if (row.ref.tableId !== undefined)
    {
        return `/app/play/${ row.ref.tableId }`;
    }

    if (row.kind === 'group-request' && row.ref.groupId !== undefined)
    {
        return `/app/groups/${ row.ref.groupId }?tab=requests`;
    }

    if (row.kind === 'group-report' && row.ref.groupId !== undefined)
    {
        return `/app/groups/${ row.ref.groupId }?tab=reports`;
    }

    if (row.ref.groupId !== undefined)
    {
        return `/app/groups/${ row.ref.groupId }`;
    }

    if (row.ref.channelId !== undefined)
    {
        return `/app/channels/${ encodeURIComponent(row.ref.channelId) }`;
    }

    if (row.ref.conversationId !== undefined)
    {
        return `/app/chats/${ row.ref.conversationId }`;
    }

    return row.actor === undefined ? LIST : `/app/people/${ row.actor }`;
};

const namesOf = async (rows) =>
{
    const handles = [...new Set(rows.map((row) => row.actor).filter((handle) => handle !== undefined))];

    if (handles.length === 0)
    {
        return new Map();
    }

    try
    {
        const answer = await read(`/api/social/names?handles=${ handles.map(encodeURIComponent).join(',') }`);

        return new Map(answer.people.map((person) => [person.handle, person.displayName]));
    }
    catch
    {
        return new Map();
    }
};

const show = (title, words, more) =>
    self.registration.showNotification(title, { ...PICTURES, lang: words.lang, dir: words.dir, ...more });

const general = (words, quiet) =>
    show(fill(words.general, {}, words.tag), words, { tag: 'baziche', renotify: !quiet, silent: quiet, data: { target: LIST } });

const pushed = async () =>
{
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const watched = tabs.some((tab) => tab.visibilityState === 'visible' && inApp(tab));
    const words = { ...PLAIN, ...await kept(WORDS) };
    const mark = (await kept(MARK))?.at ?? null;
    const page = await read('/api/notifications/').catch(() => null);

    if (page !== null && page.items.length > 0)
    {
        await keep(MARK, { at: page.items[0].at });
    }

    if (watched)
    {
        // An iPhone or an iPad takes a push that shows nothing as a broken promise and, after a few,
        // ends the subscription: there it is shown quietly and put away at once, so the page that is
        // open stays the only thing that says it.
        if (APPLE)
        {
            await show(fill(words.general, {}, words.tag), words, { tag: 'baziche-seen', silent: true, data: { target: LIST } });
            for (const notice of await self.registration.getNotifications({ tag: 'baziche-seen' }))
            {
                notice.close();
            }
        }

        return;
    }

    if (page === null)
    {
        await general(words, false);

        return;
    }

    const unread = page.items.filter((row) => !row.read);
    const fresh = (mark === null ? unread.slice(0, 1) : unread.filter((row) => row.at > mark).slice(0, MOST)).reverse();
    const sayable = fresh.filter((row) => words.says[row.kind] !== undefined);

    if (sayable.length < fresh.length || fresh.length === 0)
    {
        await general(words, fresh.length === 0);
    }

    const names = await namesOf(sayable);

    for (const row of sayable)
    {
        const vars = {
            who: names.get(row.actor) ?? row.actor ?? '',
            game: words.games[row.ref.game] ?? '',
            amount: row.ref.amount === undefined ? '' : new Intl.NumberFormat(words.tag, { maximumFractionDigits: 4 }).format(nuraOf(row.ref.amount)),
            count: row.count
        };

        await show(fill(words.says[row.kind], vars, words.tag), words, { tag: tagOf(row), renotify: true, data: { target: leadOf(row) } });
    }
};

const targetOf = (notification) =>
{
    const target = notification.data?.target;

    return typeof target === 'string' && target.startsWith('/app/') ? target : LIST;
};

const goTo = async (target) =>
{
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const there = tabs.find((tab) => placeOf(tab) === target);
    const inside = there ?? tabs.find(inApp);
    const front = await inside?.focus().catch(() => null) ?? null;

    if (front === null)
    {
        await self.clients.openWindow(target);

        return;
    }

    if (there === undefined)
    {
        front.postMessage({ type: 'nura.go', to: target });
    }
};

self.addEventListener('push', (event) =>
{
    event.waitUntil(pushed().catch(() => general(PLAIN, false)));
});

self.addEventListener('notificationclick', (event) =>
{
    event.notification.close();
    event.waitUntil(goTo(targetOf(event.notification)));
});

const shelve = async () =>
{
    try
    {
        const page = await fetch(OFFLINE, { cache: 'reload' });

        if (page.ok)
        {
            await (await caches.open(SHELF)).put(OFFLINE, page);
        }
    }
    catch
    {
        return;
    }
};

const offline = async () =>
{
    try
    {
        return await (await caches.open(SHELF)).match(OFFLINE) ?? Response.error();
    }
    catch
    {
        return Response.error();
    }
};

/*
 * Safari, on an iPhone, an iPad or a Mac: every browser on iOS is Safari underneath.
 *
 * Safari opens a page itself when no worker answers for it, and asks again by itself when the first
 * try finds the connection gone, as it often does after the phone slept or the tab sat idle. A page
 * a worker fetched gets no second try: the first open of each page landed on the offline page, and
 * Try again opened it. Safari offers no install prompt that wants a worker answering for pages, so
 * here the worker leaves opening them to Safari, and turns off the preload it once turned on.
 */
const SAFARI = APPLE || (/Safari\//.test(self.navigator?.userAgent ?? '') && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS|Android/.test(self.navigator?.userAgent ?? ''));

// Only a page being opened, and only from the network: a cached page or api answer would outlive the
// deploy that replaced it. The offline page is what a browser's own install prompt asks a worker for,
// and is shown only once the preload and two tries of the network have all failed: a connection that
// went stale fails the first try and not the next.
const opened = async (event) =>
{
    try
    {
        const preloaded = await event.preloadResponse;

        if (preloaded !== undefined)
        {
            return preloaded;
        }
    }
    catch
    {
        // Fetched again below.
    }

    // A form sent as a page open is sent once: its body is spent, and a second send could act twice.
    for (let tries = 0; tries < (event.request.method === 'GET' ? 2 : 1); tries += 1)
    {
        try
        {
            return await fetch(event.request);
        }
        catch
        {
            // Tried once more, then the offline page.
        }
    }

    return await offline();
};

self.addEventListener('install', (event) =>
{
    event.waitUntil(Promise.all([self.skipWaiting(), shelve()]));
});

self.addEventListener('activate', (event) =>
{
    const preload = self.registration.navigationPreload;

    event.waitUntil(Promise.resolve(SAFARI ? preload?.disable() : preload?.enable()).catch(() => undefined));
});

self.addEventListener('fetch', (event) =>
{
    if (event.request.mode === 'navigate' && !SAFARI)
    {
        event.respondWith(opened(event));
    }
});
