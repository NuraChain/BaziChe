import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const GAMES = new URL('../../frontend/src/components/games/', import.meta.url);

const read = (file: string) => readFileSync(new URL(file, GAMES), 'utf8');

/** Each component that draws a plate, and how it hands the plate its seat's look; each seat component's board, and how it hands the seat that look. */
const HANDED: Record<string, string> = {
    'yard-badge.component.azeroth': 'look={ props.player.look }',
    'hokm-seat.component.azeroth': 'look={ props.look }',
    'poker-seat.component.azeroth': 'look={ props.look }',
    'chess-rail.component.azeroth': 'look={ props.look }',
    'backgammon-board.component.azeroth': 'look={ lookAt(plate.seat) }',
    'hokm-board.component.azeroth': 'look={ lookAt(seat) }',
    'poker-board.component.azeroth': 'look={ lookAt(seat) }',
    'chess-board.component.azeroth': 'look={ lookAt(seat) }'
};

describe('a plate at every table', () =>
{
    it('is handed its seat\'s look, so the sheet about the player can name what they wear there', () =>
    {
        for (const [file, handed] of Object.entries(HANDED))
        {
            expect(read(file), file).toContain(handed);
        }
    });

    it('is drawn only by the components that hand it that look', () =>
    {
        const drawing = readdirSync(GAMES).filter((file) => file.endsWith('.azeroth') && read(file).includes('<TablePlate'));

        expect(drawing.sort()).toEqual(['backgammon-board.component.azeroth', 'chess-rail.component.azeroth', 'hokm-seat.component.azeroth', 'poker-seat.component.azeroth', 'yard-badge.component.azeroth']);
    });
});
