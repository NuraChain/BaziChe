import type { GameId } from '../data/games.ts';
import type { Frame } from './looks/frames.ts';

/** A pack of recordings, and the cues each one holds: every cue is in exactly one. */
export const CUES = {
    common: ['turn', 'tick', 'tick-hi', 'deny', 'pass', 'chime', 'win', 'lose', 'draw', 'hand-won'],
    cards: ['card-slide', 'card-place', 'card-gather', 'card-shuffle', 'card-fan'],
    hokm: ['trump', 'trick'],
    ludo: ['die-shake', 'die-land', 'pawn-step', 'pawn-hit', 'pawn-yard', 'six', 'home'],
    backgammon: ['cup-shake', 'dice-wood', 'checker', 'checker-hit', 'checker-bar', 'checker-off', 'cube'],
    poker: ['chip-lay', 'chips-stack', 'chips-gather', 'knock'],
    chess: ['piece-move', 'piece-capture', 'check', 'promote', 'horse-step', 'horse-call', 'elephant-step', 'elephant-call', 'king-fall']
} as const;

export type Pack = keyof typeof CUES;

export type Sampled = (typeof CUES)[Pack][number];

export const SAMPLED: readonly Sampled[] = Object.values(CUES).flat();

/** The packs a table of each game plays from; anything that is not a table plays from `common` alone. */
export const TABLE_PACKS: Record<GameId, readonly Pack[]> = {
    ludo: ['common', 'ludo'],
    hokm: ['common', 'cards', 'hokm'],
    poker: ['common', 'cards', 'poker'],
    backgammon: ['common', 'backgammon'],
    chess: ['common', 'chess']
};

export const PACKS: Record<Pack, string> = {
    common: new URL('./sound/common.cues', import.meta.url).href,
    cards: new URL('./sound/cards.cues', import.meta.url).href,
    hokm: new URL('./sound/hokm.cues', import.meta.url).href,
    ludo: new URL('./sound/ludo.cues', import.meta.url).href,
    backgammon: new URL('./sound/backgammon.cues', import.meta.url).href,
    poker: new URL('./sound/poker.cues', import.meta.url).href,
    chess: new URL('./sound/chess.cues', import.meta.url).href
};

/** What a look's voice is heard at, by where it is heard: a profile, or a table. */
export const MOMENTS = {
    profile: ['equip', 'reveal', 'strike'],
    table: ['die', 'card', 'pawn', 'spawn', 'capture']
} as const;

export type Place = keyof typeof MOMENTS;

export type Moment = (typeof MOMENTS)[Place][number];

/** The place each moment is heard at, whose pack holds its voices. */
export const PLACE_OF = Object.fromEntries(Object.entries(MOMENTS).flatMap(([place, moments]) => moments.map((moment) => [moment, place]))) as Record<Moment, Place>;

/** A collection's voice at a moment, as its pack names it: `inferno.reveal`. */
export type Voiced = `${ Frame }.${ Moment }`;

/** Each collection's voices, a pack for a profile and one for a table, each fetched only where one of its looks is heard there. */
export const VOICE_PACKS = {
    glow: { profile: new URL('./sound/looks/glow-profile.cues', import.meta.url).href, table: new URL('./sound/looks/glow-table.cues', import.meta.url).href },
    shiraz: { profile: new URL('./sound/looks/shiraz-profile.cues', import.meta.url).href, table: new URL('./sound/looks/shiraz-table.cues', import.meta.url).href },
    neon: { profile: new URL('./sound/looks/neon-profile.cues', import.meta.url).href, table: new URL('./sound/looks/neon-table.cues', import.meta.url).href },
    gold: { profile: new URL('./sound/looks/gold-profile.cues', import.meta.url).href, table: new URL('./sound/looks/gold-table.cues', import.meta.url).href },
    inferno: { profile: new URL('./sound/looks/inferno-profile.cues', import.meta.url).href, table: new URL('./sound/looks/inferno-table.cues', import.meta.url).href },
    storm: { profile: new URL('./sound/looks/storm-profile.cues', import.meta.url).href, table: new URL('./sound/looks/storm-table.cues', import.meta.url).href },
    astral: { profile: new URL('./sound/looks/astral-profile.cues', import.meta.url).href, table: new URL('./sound/looks/astral-table.cues', import.meta.url).href },
    void: { profile: new URL('./sound/looks/void-profile.cues', import.meta.url).href, table: new URL('./sound/looks/void-table.cues', import.meta.url).href },
    jade: { profile: new URL('./sound/looks/jade-profile.cues', import.meta.url).href, table: new URL('./sound/looks/jade-table.cues', import.meta.url).href },
    frost: { profile: new URL('./sound/looks/frost-profile.cues', import.meta.url).href, table: new URL('./sound/looks/frost-table.cues', import.meta.url).href },
    phoenix: { profile: new URL('./sound/looks/phoenix-profile.cues', import.meta.url).href, table: new URL('./sound/looks/phoenix-table.cues', import.meta.url).href },
    oni: { profile: new URL('./sound/looks/oni-profile.cues', import.meta.url).href, table: new URL('./sound/looks/oni-table.cues', import.meta.url).href }
} as const satisfies Record<Frame, Record<Place, string>>;

/** The cues a collection's pack for a place holds. */
export const voicesOf = (collection: Frame, place: Place) => MOMENTS[place].map((moment): Voiced => `${ collection }.${ moment }`);

const MAGIC = 'NCUE';

export function unpack<Name extends string>(bytes: ArrayBuffer, cues: readonly Name[])
{
    const found = new Map<Name, ArrayBuffer[]>();

    if (bytes.byteLength < 8 || new TextDecoder().decode(bytes.slice(0, 4)) !== MAGIC)
    {
        return found;
    }

    const length = new DataView(bytes).getUint32(4, true);
    const start = 8 + length;
    const index = JSON.parse(new TextDecoder().decode(bytes.slice(8, start))) as Record<string, [number, number][]>;

    for (const cue of cues)
    {
        const takes = (index[cue] ?? [])
            .filter(([offset, size]) => offset >= 0 && size > 0 && start + offset + size <= bytes.byteLength)
            .map(([offset, size]) => bytes.slice(start + offset, start + offset + size));

        if (takes.length > 0)
        {
            found.set(cue, takes);
        }
    }

    return found;
}
