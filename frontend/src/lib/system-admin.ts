import { POOL_LEAST, POOL_MOST, WAIT_LEAST, WAIT_MOST, isSkill, type Skill } from '../../../backend/src/domains/system/rules.ts';
import type { AdminSystem } from '../../../backend/src/schemas.ts';
import { wholeNuraOf } from './nura.ts';

/** The settings form as the owner types it: the numbers stay text until the set is sent. */
export interface TypedSettings
{
    wait: string;
    skill: string;
    most: string;
}

export type SettingsField = 'wait' | 'skill' | 'most';

export interface SettingsRead
{
    settings: { wait: number; skill: Skill; most: number } | null;
    bad: readonly SettingsField[];
}

export const typedSettings = (config: Pick<AdminSystem, 'wait' | 'skill' | 'most'>): TypedSettings => ({
    wait: String(config.wait),
    skill: config.skill,
    most: String(config.most)
});

/** A typed whole number inside its range, Persian and Arabic digits and separators allowed, or null. */
export const wholeIn = (text: string, least: number, most: number) =>
{
    const value = wholeNuraOf(text, most);

    return value !== null && value >= least ? value : null;
};

/** What the typed settings come to: the set when every field reads, and which fields do not. */
export function readSettings(typed: TypedSettings): SettingsRead
{
    const wait = wholeIn(typed.wait, WAIT_LEAST, WAIT_MOST);
    const most = wholeIn(typed.most, POOL_LEAST, POOL_MOST);
    const skill = isSkill(typed.skill) ? typed.skill : null;
    const bad = [
        ...(wait === null ? ['wait' as const] : []),
        ...(skill === null ? ['skill' as const] : []),
        ...(most === null ? ['most' as const] : [])
    ];

    return wait === null || most === null || skill === null ? { settings: null, bad } : { settings: { wait, skill, most }, bad: [] };
}

export const sameSettings = (one: Pick<AdminSystem, 'wait' | 'skill' | 'most'>, other: Pick<AdminSystem, 'wait' | 'skill' | 'most'>) =>
    one.wait === other.wait && one.skill === other.skill && one.most === other.most;

/** The runtime's recent errors, newest first, whatever order its ring keeps them in. */
export const newestFirst = <Row extends { at: string }>(rows: readonly Row[]) =>
    [...rows].sort((one, other) => Date.parse(other.at) - Date.parse(one.at));

/** Every game's figures added up, for the line above the table. */
export const totalsOf = (games: AdminSystem['games']) => games.reduce(
    (sum, game) => ({ seated: sum.seated + game.seated, playing: sum.playing + game.playing, live: sum.live + game.live, today: sum.today + game.today }),
    { seated: 0, playing: 0, live: 0, today: 0 }
);
