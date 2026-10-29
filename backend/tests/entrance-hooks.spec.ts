import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const GAMES = new URL('../../frontend/src/components/games/', import.meta.url);

const read = (file: string) => readFileSync(new URL(file, GAMES), 'utf8');

/** Each game's board, and what its presenter is handed to play the entrances as a game opens in front of this browser. */
const HOOKED: Record<string, string> = {
    'match-board.component.azeroth': 'opening: () => enter()',
    'hokm-board.component.azeroth': 'opening: enter',
    'poker-board.component.azeroth': 'opening: enter',
    'backgammon-board.component.azeroth': 'opening: () => men?.enter()',
    'chess-board.component.azeroth': 'opening: () => table?.enter()'
};

describe('the entrance at a game’s start', () =>
{
    it('is asked for by every board’s presenter, in the call that makes it', () =>
    {
        for (const [file, hook] of Object.entries(HOOKED))
        {
            const text = read(file);
            const made = text.slice(text.indexOf('createPresenter<'));

            expect(made.slice(0, made.indexOf('});')), file).toContain(hook);
        }
    });

    it('is worked out at chess for each colour from its own player’s looks', () =>
    {
        expect(read('chess-board.component.azeroth')).toContain("entrances: () => untrack(() => ({ w: entranceOf('chess', lookAt(whiteSeat)), b: entranceOf('chess', lookAt(1 - whiteSeat)) }))");
    });

    it('is held for every board a game is drawn by', () =>
    {
        const drawn = [...read('boards.ts').matchAll(/import\('\.\/([\w-]+\.component\.azeroth)'\)/g)].map((found) => found[1]);

        expect(drawn.sort()).toEqual(Object.keys(HOOKED).sort());
    });
});
