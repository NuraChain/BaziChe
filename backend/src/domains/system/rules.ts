/**
 * System players: the setting the staff run them with, and the words the rest of the server shares
 * about them. Pure: no clock, no randomness, no database.
 */

/** How well a system player plays, lowest first. It changes real decision quality, never adds blunders. */
export const SKILLS = ['casual', 'intermediate', 'advanced', 'semi-pro'] as const;

export type Skill = (typeof SKILLS)[number];

export const isSkill = (value: unknown): value is Skill => typeof value === 'string' && (SKILLS as readonly string[]).includes(value);

/** Seconds a person waits at a table before the server fills its seats. */
export const WAIT_LEAST = 5;
export const WAIT_MOST = 120;

/** How many system players there may be at most, retired ones not counted. */
export const POOL_LEAST = 1;
export const POOL_MOST = 200;

/** `style` seeds how one system player differs from another: 0 to 999. */
export const STYLE_MOST = 999;

/** The `system-players` setting as the server acts on it. */
export interface SystemConfig
{
    on: boolean;

    /** Per game id; a game absent from the map is on. */
    games: Record<string, boolean>;

    wait: number;

    /** What a new system player is made with. */
    skill: Skill;

    most: number;
}

export const SYSTEM_DEFAULTS: SystemConfig = {
    on: false,
    games: {},
    wait: 20,
    skill: 'intermediate',
    most: 40
};

const GAME_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

const clamped = (value: unknown, least: number, most: number, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.min(most, Math.max(least, Math.round(value))) : fallback;

const gamesOf = (value: unknown) =>
{
    const games: Record<string, boolean> = {};

    if (typeof value !== 'object' || value === null || Array.isArray(value))
    {
        return games;
    }

    for (const [id, on] of Object.entries(value as Record<string, unknown>))
    {
        if (GAME_ID.test(id) && typeof on === 'boolean')
        {
            games[id] = on;
        }
    }

    return games;
};

/**
 * The `system-players` setting, every part read on its own: switched off unless it says on, the
 * wait and the cap pulled into their ranges, and a skill nobody knows read as the default. A value
 * that is not JSON at all is the defaults, which ship off.
 */
export const systemConfigOf = (value: string | null): SystemConfig =>
{
    let config: unknown = null;

    try
    {
        config = value === null ? null : JSON.parse(value);
    }
    catch
    {
        config = null;
    }

    const said = typeof config === 'object' && config !== null && !Array.isArray(config) ? config as Record<string, unknown> : {};

    return {
        on: said.on === true,
        games: gamesOf(said.games),
        wait: clamped(said.wait, WAIT_LEAST, WAIT_MOST, SYSTEM_DEFAULTS.wait),
        skill: isSkill(said.skill) ? said.skill : SYSTEM_DEFAULTS.skill,
        most: clamped(said.most, POOL_LEAST, POOL_MOST, SYSTEM_DEFAULTS.most)
    };
};

/** The setting's text for a config, in the one shape `systemConfigOf` reads back: the games in id order, so two equal configs are equal text. */
export const systemConfigText = (config: SystemConfig) => JSON.stringify({
    on: config.on,
    games: Object.fromEntries(Object.entries(config.games).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    wait: config.wait,
    skill: config.skill,
    most: config.most
});

/** Whether the server seats system players at a table of this game now. */
export const gameOn = (config: SystemConfig, game: string) => config.on && config.games[game] !== false;

/** What the AI runtime has done since the process started, for the admin page. */
export interface AiFigures
{
    decisions: number;
    averageMs: number;
    worstMs: number;
    fallbacks: number;
    errors: { at: string; game: string; matchId: string; message: string }[];
}

/** Until the runtime is wired in, and whenever it has not decided anything yet. */
export const noAiFigures = (): AiFigures => ({ decisions: 0, averageMs: 0, worstMs: 0, fallbacks: 0, errors: [] });
