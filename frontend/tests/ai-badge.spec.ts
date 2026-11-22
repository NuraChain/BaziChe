import { createMemoryHistory, createRouter, renderToString, RouterProvider } from 'azerothjs';
import { renderWithLocale } from 'azerothjs/internal';
import { expect, it } from 'vitest';

import AiBadge from '../src/components/games/ai-badge.component.azeroth';
import SeatCard from '../src/components/games/seat-card.component.azeroth';
import MatchResult from '../src/components/games/match-result.component.azeroth';
import type { Engine } from '../../backend/src/domains/match/engine.ts';
import { backgammonEngine } from '../../backend/src/domains/match/engines/backgammon.ts';
import { hokmEngine } from '../../backend/src/domains/match/engines/hokm.ts';
import { ludoEngine } from '../../backend/src/domains/match/engines/ludo.ts';
import { pokerEngine } from '../../backend/src/domains/match/engines/poker.ts';
import { BOARDS } from '../src/components/games/boards.ts';
import { NO_EVENTS } from '../src/stores/match.store.ts';
import { chessEngine } from '../../backend/src/domains/match/engines/chess.ts';
import TablePlate from '../src/components/games/table-plate.component.azeroth';
import '../src/locales/app-catalogue.ts';
import { playerName } from '../src/lib/player-name.ts';
import { useLocale } from '../src/stores/locale.store.ts';

it('labels an AI seat visibly in Persian and leaves a human with the same name unmarked', () =>
{
    const plate = (ai?: boolean) => renderWithLocale('fa', () => renderToString(() => TablePlate({ who: 'sam', name: 'Sam', ai })));

    expect(plate(true)).toContain('هوش مصنوعی');
    expect(plate(true)).toContain('data-ai-player');
    expect(plate()).not.toContain('data-ai-player');
    expect(renderToString(() => AiBadge({ ai: false }))).not.toContain('data-ai-player');
});

it('renders the same identity in compact spectator and history lists', () =>
{
    const locale = useLocale();
    locale.setLocale('en');
    expect(playerName('Sam', true, locale)).toBe('Sam (AI)');
    expect(playerName('Robot Fan', undefined, locale)).toBe('Robot Fan');
});

it('marks an occupied AI chair and a finished match for a spectator', () =>
{
    const chair = (ai?: true) => renderToString(() => SeatCard({
        seat: { seat: 1, who: 'sam', ai, ready: true, host: false }, me: 'spectator', canInvite: false, canRemove: false
    }));
    expect(chair(true)).toContain('data-ai-player');
    expect(chair()).not.toContain('data-ai-player');

    const { state } = chessEngine.create([0, 1], { die: () => 1 }, { target: 0, cube: false, blinds: 'low', variant: 'standard' });
    const router = createRouter({ history: createMemoryHistory(), routes: [] });
    const result = renderToString(() => RouterProvider({ router, children: () => MatchResult({ match: {
        id: 'match', tableId: 'table', game: 'chess', rev: 1, seats: 2, view: chessEngine.view(state, null),
        players: [{ seat: 0, who: 'robotFan', result: 'lost' }, { seat: 1, who: 'sam', ai: true, result: 'won' }],
        outcome: 'won', winner: 1, startedAt: '2026-11-22T10:00:00Z', finishedAt: '2026-11-22T10:30:00Z'
    } }) }));
    expect(result.match(/data-ai-player/g)).toHaveLength(1);
});

const engines: readonly Engine[] = [ludoEngine, hokmEngine, backgammonEngine, pokerEngine, chessEngine];

it.each(engines.map((engine) => [engine.id, engine] as const))('identifies the AI on the live %s board for a player and a spectator', async (game, engine) =>
{
    const Board = (await BOARDS[game]()).default;
    const seats = game === 'poker' ? [0, 1, 2, 3, 4, 5] : game === 'hokm' ? [0, 1, 2, 3] : [0, 1];
    const { state } = engine.create(seats, { die: () => 1, shuffle: (items) => [...items] }, { target: 0, cube: false, blinds: 'low', variant: 'standard' });
    const players = seats.map((seat) => seat === 1 ? { seat, who: 'sara', ai: true as const } : { seat, who: 'player' + seat });
    const router = createRouter({ history: createMemoryHistory(), routes: [] });
    for (const mine of [0, undefined])
    {
        const match = {
            id: 'match', tableId: 'table', game, rev: 0, seats: seats.length, players, mine,
            view: engine.view(state, mine ?? null), startedAt: '2026-11-22T10:00:00Z'
        };
        const html = renderToString(() => RouterProvider({ router, children: () => Board({ match, events: NO_EVENTS }) }));
        expect(html.match(/table-plate-identity/g)).toHaveLength(seats.length);
        expect(html.match(/data-ai-player/g)).toHaveLength(1);
    }
});
