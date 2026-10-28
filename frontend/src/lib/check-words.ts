import type { CheckFamily, CheckKind, CheckResolution } from '../../../backend/src/domains/reconcile/kinds.ts';
import type { AdminCheck } from '../../../backend/src/schemas.ts';
import type { SaidPart } from '../components/admin/said.component.azeroth';
import { GAMES } from '../data/games.ts';
import type { IconName } from '../icons/all.ts';
import type { MessageKey } from '../locales/en.ts';
import type { LocaleApi } from '../stores/locale.store.ts';
import { nuraOf } from './nura.ts';
import { handleParts } from './staff-words.ts';

export const FAMILY_WORDS: Record<CheckFamily, MessageKey> = {
    escrow: 'admin.checks.family.escrow',
    order: 'admin.checks.family.order',
    donation: 'admin.checks.family.donation',
    market: 'admin.checks.family.market',
    position: 'admin.checks.family.position',
    contract: 'admin.checks.family.contract'
};

export const WATCH_WORDS: Record<CheckFamily, MessageKey> = {
    escrow: 'admin.checks.watch.escrow',
    order: 'admin.checks.watch.order',
    donation: 'admin.checks.watch.donation',
    market: 'admin.checks.watch.market',
    position: 'admin.checks.watch.position',
    contract: 'admin.checks.watch.contract'
};

export const FAMILY_MARKS: Record<CheckFamily, IconName> = {
    escrow: 'coins',
    order: 'bag',
    donation: 'gift',
    market: 'target',
    position: 'target',
    contract: 'wallet'
};

const KIND_WORDS: Record<CheckKind, MessageKey> = {
    'escrow-state': 'admin.checks.kind.escrow-state',
    'escrow-stakes': 'admin.checks.kind.escrow-stakes',
    'escrow-winners': 'admin.checks.kind.escrow-winners',
    'order-state': 'admin.checks.kind.order-state',
    'order-sale': 'admin.checks.kind.order-sale',
    'donation-state': 'admin.checks.kind.donation-state',
    'donation-gift': 'admin.checks.kind.donation-gift',
    'market-state': 'admin.checks.kind.market-state',
    'market-winner': 'admin.checks.kind.market-winner',
    'market-claimable': 'admin.checks.kind.market-claimable',
    'position-state': 'admin.checks.kind.position-state',
    'position-ticket': 'admin.checks.kind.position-ticket',
    'position-claim': 'admin.checks.kind.position-claim',
    solvency: 'admin.checks.kind.solvency'
};

const HOLDER_WORDS: Readonly<Record<string, MessageKey>> = {
    vault: 'admin.checks.holder.vault',
    shop: 'admin.checks.holder.shop',
    markets: 'admin.checks.holder.markets'
};

export const RESOLVED_WORDS: Record<CheckResolution, MessageKey> = {
    agreed: 'admin.checks.resolved.agreed',
    'put-right': 'admin.checks.resolved.put-right',
    staff: 'admin.checks.resolved.staff'
};

/** A paid game's states, here and in the vault, are the vault panel's own words. */
const ESCROW_STATES: Readonly<Record<string, MessageKey>> = {
    locking: 'admin.vault.state.locking',
    open: 'admin.vault.state.open',
    settling: 'admin.vault.state.settling',
    settled: 'admin.vault.state.settled',
    refunding: 'admin.vault.state.refunding',
    refunded: 'admin.vault.state.refunded',
    reclaimed: 'admin.vault.state.reclaimed',
    failed: 'admin.vault.state.failed',
    none: 'admin.checks.word.none'
};

/** Every other family's states, by the word each means in that family: a gift `confirmed` was given, a position `confirmed` was placed. */
const STATES: Record<Exclude<CheckFamily, 'escrow' | 'contract'>, Readonly<Record<string, MessageKey>>> = {
    order: {
        paid: 'admin.checks.word.delivered',
        refunded: 'admin.checks.word.refunded',
        expired: 'admin.checks.word.expired',
        failed: 'admin.checks.word.failed',
        sold: 'admin.checks.word.sold',
        unsold: 'admin.checks.word.unsold'
    },
    donation: {
        confirmed: 'admin.checks.word.given',
        expired: 'admin.checks.word.expired',
        reverted: 'admin.checks.word.reverted',
        failed: 'admin.checks.word.failed',
        held: 'admin.checks.word.held',
        none: 'admin.checks.word.none'
    },
    market: {
        settled: 'admin.checks.word.settled',
        refunded: 'admin.checks.word.refunded',
        cancelled: 'admin.checks.word.cancelled',
        expired: 'admin.checks.word.expired',
        empty: 'admin.checks.word.empty',
        open: 'admin.checks.word.open',
        none: 'admin.checks.word.none'
    },
    position: {
        confirmed: 'admin.checks.word.placed',
        reverted: 'admin.checks.word.reverted',
        expired: 'admin.checks.word.expired',
        placed: 'admin.checks.word.placed',
        none: 'admin.checks.word.none',
        claimed: 'admin.checks.word.claimed',
        unclaimed: 'admin.checks.word.unclaimed'
    }
};

const ADDRESS_WORDS: Partial<Record<CheckKind, MessageKey>> = {
    'order-sale': 'admin.checks.field.from',
    'donation-gift': 'admin.checks.field.to',
    'position-ticket': 'admin.checks.field.by',
    'escrow-stakes': 'admin.checks.field.players'
};

const short = (address: string) => (address.length > 12 ? `${ address.slice(0, 6) }…${ address.slice(-4) }` : address);

const nura = (wei: string, locale: LocaleApi) => locale.n(nuraOf(wei), { maximumFractionDigits: 4 });

const gameOf = (id: string | undefined, locale: LocaleApi) =>
{
    const known = GAMES.find((one) => one.id === id);

    return known === undefined ? id ?? '' : locale.t(known.nameKey);
};

/** One fact of a line, as parts: a handle, an address and a code each run left to right whatever the page. */
export interface Fact
{
    key: string;
    parts: SaidPart[];
}

const fact = (key: string, said: string, slots: Readonly<Record<string, string>> = {}): Fact => ({ key, parts: handleParts(said, slots) });

const plain = (key: string, text: string): Fact => ({ key, parts: [{ at: 0, text, handle: false }] });

export const codeOf = (check: AdminCheck) => `#${ check.record.slice(0, 8) }`;

export const headlineOf = (check: AdminCheck, locale: LocaleApi) =>
    locale.t(KIND_WORDS[check.kind], check.kind === 'solvency' ? { holder: locale.t(HOLDER_WORDS[check.record] ?? 'admin.checks.family.contract') } : {});

export const aboutOf = (check: AdminCheck, locale: LocaleApi) =>
{
    const about = check.about;
    const facts: Fact[] = [plain('family', locale.t(FAMILY_WORDS[check.family]))];

    if (about.game !== undefined)
    {
        facts.push(plain('game', gameOf(about.game, locale)));
    }

    if (about.item !== undefined)
    {
        facts.push(fact('item', locale.t('admin.checks.about.look', { item: '{item}' }), { item: about.item }));
    }

    if (about.amount !== undefined)
    {
        facts.push(plain('amount', locale.t(check.family === 'escrow' ? 'admin.checks.field.stake' : 'admin.checks.field.amount', { amount: nura(about.amount, locale) })));
    }

    if (about.who !== undefined && about.to !== undefined)
    {
        facts.push(fact('people', locale.t('admin.checks.about.gift', { who: '{who}', to: '{to}' }), { who: about.who, to: about.to }));
    }
    else if (about.who !== undefined && about.who !== '')
    {
        facts.push(fact('people', '{who}', { who: about.who }));
    }

    if (check.family !== 'contract')
    {
        facts.push(fact('record', '{code}', { code: codeOf(check) }));
    }

    return facts;
};

export const sideOf = (check: AdminCheck, side: 'db' | 'chain', locale: LocaleApi) =>
{
    const words = check[side];
    const facts: Fact[] = [];

    if (words.state !== undefined)
    {
        const key = check.family === 'escrow'
            ? ESCROW_STATES[words.state]
            : (check.family === 'contract' ? undefined : STATES[check.family][words.state]);

        facts.push(plain('state', key === undefined ? words.state : locale.t(key)));
    }

    if (words.draw === 'yes')
    {
        facts.push(plain('outcome', locale.t('admin.checks.field.draw')));
    }
    else if (words.backed !== undefined && words.backed !== '')
    {
        facts.push(fact('outcome', locale.t('admin.checks.field.backed', { who: '{who}' }), { who: words.backed }));
    }
    else if (words.outcome !== undefined)
    {
        facts.push(plain('outcome', locale.t('admin.checks.field.outcome', { n: locale.n(Number(words.outcome) + 1) })));
    }

    if (words.winners !== undefined)
    {
        facts.push(fact('winners', locale.t('admin.checks.field.paid', { who: '{who}' }), { who: words.winners }));
    }

    if (words.amount !== undefined)
    {
        facts.push(plain('amount', locale.t(check.family === 'escrow' ? 'admin.checks.field.stake' : 'admin.checks.field.amount', { amount: nura(words.amount, locale) })));
    }

    if (words.fee !== undefined)
    {
        facts.push(plain('fee', locale.t('admin.checks.field.fee', { fee: locale.n(Number(words.fee) / 10_000, { style: 'percent', maximumFractionDigits: 2 }) })));
    }

    const address = words.address ?? words.players;
    const addressed = ADDRESS_WORDS[check.kind];

    if (address !== undefined && addressed !== undefined)
    {
        facts.push(fact('address', locale.t(addressed, { address: '{address}' }), { address: address.split(',').filter((one) => one !== '').map(short).join(', ') }));
    }

    if (words.at !== undefined)
    {
        facts.push(plain('at', locale.t('admin.checks.field.claims', { at: locale.date(Date.parse(words.at), { dateStyle: 'medium', timeStyle: 'short' }) })));
    }

    if (words.held !== undefined)
    {
        facts.push(plain('held', locale.t('admin.checks.field.held', { amount: nura(words.held, locale) })));
    }

    if (words.owed !== undefined)
    {
        facts.push(plain('owed', locale.t('admin.checks.field.owed', { amount: nura(words.owed, locale) })));
    }

    return facts;
};

export const resolvedOf = (check: AdminCheck, locale: LocaleApi) =>
    (check.resolution === undefined
        ? []
        : handleParts(locale.t(RESOLVED_WORDS[check.resolution], { staff: '{staff}' }), { staff: check.staff ?? '' }));
