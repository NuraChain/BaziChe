import { createSignal, createStore } from 'azerothjs';

import type { GameId } from '../data/games.ts';

export const useFocus = createStore(() =>
{
    const [game, focus] = createSignal<GameId | null>(null);
    const [chapter, setChapter] = createSignal<GameId | null>(null);
    const [inTour, setInTour] = createSignal(false);
    const [orbit, setOrbit] = createSignal(0);

    return {
        game, focus, chapter, inTour, setInTour, orbit, setOrbit,
        setChapter(id: GameId | null)
        {
            if (id !== chapter())
            {
                setChapter(id);
                setOrbit(0);
            }
        }
    };
});
