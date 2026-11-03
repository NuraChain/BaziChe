import type { MinterState } from '../../../backend/src/domains/admin/roles.ts';
import type { AdminMinters } from '../../../backend/src/schemas.ts';
import type { Tone } from '../components/ui/variants.ts';
import type { MessageKey } from '../locales/en.ts';

export type Board = Extract<AdminMinters, { configured: true }>;

export type MinterCard = Board['contracts'][number];

export type MinterChange = Board['changes'][number];

/** What a contract's card says about the minting wallet there: what NuraChain answered, or the change still on its way. */
export type Standing = 'active' | 'missing' | 'pending' | 'unreachable' | 'wrong-chain' | 'no-contract' | 'no-roles';

export const standingOf = (card: MinterCard): Standing =>
{
    if (card.open?.state === 'pending')
    {
        return 'pending';
    }

    if (card.state !== 'ready')
    {
        return card.state;
    }

    return card.minter === true ? 'active' : 'missing';
};

export const STANDING_WORDS: Record<Standing, MessageKey> = {
    active: 'admin.minters.state.active',
    missing: 'admin.minters.state.missing',
    pending: 'admin.minters.state.pending',
    unreachable: 'admin.minters.state.unreachable',
    'wrong-chain': 'admin.minters.state.wrong-chain',
    'no-contract': 'admin.minters.state.no-contract',
    'no-roles': 'admin.minters.state.no-roles'
};

export const STANDING_SAID: Record<Standing, MessageKey> = {
    active: 'admin.minters.said.active',
    missing: 'admin.minters.said.missing',
    pending: 'admin.minters.said.pending',
    unreachable: 'admin.minters.said.unreachable',
    'wrong-chain': 'admin.minters.said.wrong-chain',
    'no-contract': 'admin.minters.said.no-contract',
    'no-roles': 'admin.minters.said.no-roles'
};

export const STANDING_TONES: Record<Standing, Tone> = {
    active: 'live',
    missing: 'danger',
    pending: 'gold',
    unreachable: 'gold',
    'wrong-chain': 'danger',
    'no-contract': 'danger',
    'no-roles': 'danger'
};

export const CHANGE_WORDS: Record<MinterState, MessageKey> = {
    asked: 'admin.minters.change.asked',
    pending: 'admin.minters.change.pending',
    confirmed: 'admin.minters.change.confirmed',
    failed: 'admin.minters.change.failed',
    lapsed: 'admin.minters.change.lapsed'
};

export const CHANGE_TONES: Record<MinterState, Tone> = {
    asked: 'neutral',
    pending: 'gold',
    confirmed: 'live',
    failed: 'danger',
    lapsed: 'neutral'
};

const FAILURE_WORDS: Readonly<Record<string, MessageKey>> = {
    dropped: 'admin.minters.failure.dropped',
    reverted: 'admin.minters.failure.reverted',
    unknown: 'admin.minters.failure.unknown',
    foreign: 'admin.minters.failure.foreign',
    unchanged: 'admin.minters.failure.unchanged'
};

export const failureWord = (failure: string | undefined) => FAILURE_WORDS[failure ?? ''] ?? 'admin.minters.failure.unknown';

/** The newest change asked of a contract: `changes` come newest first. */
export const lastOf = (board: Board, key: string) => board.changes.find((one) => one.contract === key);
