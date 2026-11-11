import type { MessageKey } from '../locales/en.ts';
import type { GameId } from './games.ts';

/** One section of a game's full rules: a title, and its points as one message, a point to a line. */
export interface RuleSection
{
    title: MessageKey;
    points: MessageKey;
}

const sections = (game: GameId, count: number): RuleSection[] =>
    Array.from({ length: count }, (_, index) => ({
        title: `rules.${ game }.${ index + 1 }.title` as MessageKey,
        points: `rules.${ game }.${ index + 1 }.points` as MessageKey
    }));

/** Every game's full rules, in the order a reader learns them (`locales/<lang>/rules.ts`). */
export const GAME_RULES: Readonly<Record<GameId, readonly RuleSection[]>> = {
    hokm: sections('hokm', 6),
    poker: sections('poker', 6),
    backgammon: sections('backgammon', 7),
    ludo: sections('ludo', 8),
    chess: sections('chess', 4)
};
