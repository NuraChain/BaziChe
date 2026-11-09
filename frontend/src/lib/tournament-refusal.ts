import { ApiError } from '../api.ts';
import type { MessageKey } from '../locales/en.ts';

const KNOWN: Readonly<Record<string, MessageKey>> = {
    'tournament-closed': 'tournaments.refused.closed',
    'tournament-full': 'tournaments.refused.full',
    'tournament-entered': 'tournaments.refused.entered',
    'tournament-entries-max': 'tournaments.refused.entriesMax',
    'tournament-created-max': 'tournaments.refused.createdMax',
    'tournament-time': 'tournaments.refused.time',
    'tournament-format': 'tournaments.refused.format',
    'tournament-game': 'tournaments.refused.game'
};

export const whyTournament = (error: unknown): MessageKey =>
    error instanceof ApiError && typeof error.code === 'string' && KNOWN[error.code] !== undefined
        ? KNOWN[error.code]
        : 'tournaments.refused.other';
