import { REWARD_WITHDRAWAL_MINIMUM } from '../../../backend/src/domains/reward/payout-rules.ts';
import { REWARD_CAP } from '../../../backend/src/domains/reward/rules.ts';
import { GAMES } from '../data/games.ts';
import type { MessageKey } from '../locales/en.ts';
import type { LocaleApi } from '../stores/locale.store.ts';

/** A quest's words when it counts any game, and when it counts one; a metric of one game alone has no any-game form. */
const METRIC_WORDS: Readonly<Record<string, { any: MessageKey; one: MessageKey }>> = {
    played: { any: 'app.rewards.quest.played', one: 'app.rewards.quest.playedIn' },
    won: { any: 'app.rewards.quest.won', one: 'app.rewards.quest.wonIn' },
    'played-with-friend': { any: 'app.rewards.quest.friend', one: 'app.rewards.quest.friendIn' },
    'tournament-played': { any: 'app.rewards.quest.tournament', one: 'app.rewards.quest.tournamentIn' },
    'distinct-games': { any: 'app.rewards.quest.distinct', one: 'app.rewards.quest.distinct' }
};

/** A tally's words by game, since one name counts different things in two games: a poker hand is played, a hokm hand is taken. */
const TALLY_WORDS: Readonly<Record<string, MessageKey>> = {
    'hokm:hands': 'app.rewards.tally.hokm.hands',
    'hokm:tricks': 'app.rewards.tally.hokm.tricks',
    'hokm:kots': 'app.rewards.tally.hokm.kots',
    'hokm:trumps': 'app.rewards.tally.hokm.trumps',
    'backgammon:games': 'app.rewards.tally.backgammon.games',
    'backgammon:gammons': 'app.rewards.tally.backgammon.gammons',
    'backgammon:backgammons': 'app.rewards.tally.backgammon.backgammons',
    'backgammon:hits': 'app.rewards.tally.backgammon.hits',
    'backgammon:borneOff': 'app.rewards.tally.backgammon.borneOff',
    'poker:hands': 'app.rewards.tally.poker.hands',
    'poker:pots': 'app.rewards.tally.poker.pots',
    'poker:showdowns': 'app.rewards.tally.poker.showdowns',
    'poker:knockouts': 'app.rewards.tally.poker.knockouts',
    'ludo:rolls': 'app.rewards.tally.ludo.rolls',
    'ludo:sixes': 'app.rewards.tally.ludo.sixes',
    'ludo:captures': 'app.rewards.tally.ludo.captures',
    'ludo:home': 'app.rewards.tally.ludo.home',
    'ludo:enters': 'app.rewards.tally.ludo.enters',
    'chess:moves': 'app.rewards.tally.chess.moves',
    'chess:captures': 'app.rewards.tally.chess.captures',
    'chess:checks': 'app.rewards.tally.chess.checks',
    'chess:checkmates': 'app.rewards.tally.chess.checkmates',
    'chess:castles': 'app.rewards.tally.chess.castles',
    'chess:promotions': 'app.rewards.tally.chess.promotions',
    'chess:enPassants': 'app.rewards.tally.chess.enPassants',
    'chess:draws': 'app.rewards.tally.chess.draws'
};

/** What a quest asks, in the reader's language, from its metric, game and target. */
export function questWords(quest: { game: string; metric: string; target: number }, locale: LocaleApi)
{
    const game = GAMES.find((one) => one.id === quest.game);

    if (quest.metric.startsWith('tally:'))
    {
        const key = TALLY_WORDS[`${ quest.game }:${ quest.metric.slice('tally:'.length) }`];

        return key === undefined ? locale.t('app.rewards.quest.other') : locale.plural(key, quest.target);
    }

    const words = METRIC_WORDS[quest.metric];

    if (words === undefined)
    {
        return locale.t('app.rewards.quest.other');
    }

    return game === undefined
        ? locale.plural(words.any, quest.target)
        : locale.plural(words.one, quest.target, { game: locale.t(game.nameKey) });
}

/** Why NURA was not earned or paid less, by the server's refusal code. */
const WHY: Readonly<Record<string, MessageKey>> = {
    'not-established': 'app.rewards.why.notEstablished',
    'reward-no-wallet': 'app.rewards.why.noWallet',
    'reward-minor': 'app.rewards.why.minor',
    'reward-suspended': 'app.rewards.why.suspended',
    'reward-frozen': 'app.rewards.why.frozen',
    'reward-wallet': 'app.rewards.why.wallet',
    'reward-off': 'app.rewards.why.off',
    'reward-cap': 'app.rewards.why.cap',
    'reward-budget': 'app.rewards.why.budget',
    'withdraw-least': 'app.rewards.why.least',
    'withdraw-queued': 'app.rewards.why.queued'
};

/** The sentence for a refusal; a code the page has no words for, or none, is said as a press that did not go through. */
export const whyRewards = (reason: string | null, locale: LocaleApi, amount = 0) =>
    locale.t((reason === null ? undefined : WHY[reason]) ?? 'app.rewards.failedPress', { cap: REWARD_CAP, least: REWARD_WITHDRAWAL_MINIMUM, amount });

export const HISTORY_WORDS: Readonly<Record<string, MessageKey>> = {
    'check-in': 'app.rewards.kind.checkIn',
    quest: 'app.rewards.kind.quest',
    withdrawal: 'app.rewards.kind.withdrawal',
    bonus: 'app.rewards.kind.bonus'
};
