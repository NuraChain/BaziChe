import type { GameId } from '../../data/games.ts';

export const GAME_HUE: Record<GameId, number> = {
    hokm: 162,
    poker: 259,
    backgammon: 28,
    ludo: 34,
    chess: 40
};

export function gameArt(game: GameId)
{
    return `/art/games/${ game }.svg`;
}

export function gameIcon(game: GameId)
{
    return `/art/games/${ game }-icon.svg`;
}
