export interface Point
{
    x: number;
    y: number;
}

/**
 * How a preset is played. Each is optional and every default is 1: `intensity` and `density` scale
 * how many particles there are (intensity their light too), `scale` their size and reach, `speed`
 * how fast they move and how soon they go, and `duration` replaces how long they live, in ms.
 */
export interface Tune
{
    colors?: readonly string[];
    intensity?: number;
    density?: number;
    scale?: number;
    speed?: number;
    duration?: number;

    /** One seed plays an effect the same way every time; none plays it a new way each time. */
    seed?: number;

    /** Which way a throw goes, in radians clockwise from right; with none it goes every way. */
    direction?: number;
}

/** How often a ribbon keeps where it is, in ms of its life, so its length never follows the frame rate. */
export const TRAIL_EVERY = 16;

export type Shape = 'dot' | 'orb' | 'puff' | 'spark' | 'star' | 'flake' | 'confetti' | 'ring' | 'bolt'
    | 'flame' | 'shard' | 'feather' | 'rune' | 'ribbon' | 'nebula' | 'glitch' | 'crack' | 'ray' | 'slit' | 'shade';

export type Envelope = 'fade' | 'swell' | 'flicker' | 'stutter';

export interface Particle
{
    shape: Shape;
    x: number;
    y: number;
    vx: number;
    vy: number;
    gravity: number;
    drag: number;

    /** How long it has lived and will, in ms; an age below nought is a wait before it is seen. */
    age: number;
    life: number;

    size: number;

    /** Its size at the end of its life, as a share of `size`. */
    grow: number;

    alpha: number;
    envelope: Envelope;
    turn: number;
    spin: number;
    color: string;

    /** Drawn by adding light, for anything that glows. */
    glow: boolean;

    width: number;
    to?: Point;

    /** The middle of the ring a bolt runs round, for one that runs along a ring and not across it. */
    around?: Point;

    points?: Point[];
    redraw?: number;

    /** Pulled toward a point (pushed from it below nought), in px/s². */
    well?: { x: number; y: number; pull: number };

    /** Carried round an ellipse about a centre instead of by its velocity, `speed` in radians a second. */
    orbit?: { x: number; y: number; rx: number; ry: number; tilt: number; angle: number; speed: number };

    /** How hard a field of eddies stirs it, in px/s². */
    swirl?: number;

    /** How hard the pointer over the host draws it, in px/s². */
    pointer?: number;

    /** Where it has been, newest last, and how many places to keep: what a ribbon is drawn through. */
    trail?: Point[];
    tail?: number;

    /** Its age when it last kept a place in `trail`. */
    kept?: number;

    /** A shard's outline about its middle, or a crack's run from where it starts. */
    outline?: Point[];

    /** Which rune of the alphabet it is. */
    glyph?: number;
}

export type Preset = 'embers' | 'sparks' | 'smoke' | 'dust' | 'orbs' | 'stars' | 'burst' | 'frost' | 'confetti' | 'pulse' | 'shockwave';

export type Stream = 'trail' | 'aura' | 'flames' | 'arcs' | 'snow';

export type Random = () => number;

let roll: Random = Math.random;

/** Runs `make` drawing every random number from `random`, so a seeded effect plays the same every time. */
export function rolling<T>(random: Random, make: () => T)
{
    const before = roll;
    roll = random;

    try
    {
        return make();
    }
    finally
    {
        roll = before;
    }
}

/** A stream of numbers in [0, 1) from a seed: mulberry32. */
export function seeded(seed: number): Random
{
    let state = seed >>> 0;

    return () =>
    {
        state = (state + 0x6D2B79F5) >>> 0;
        let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

export const random = () => roll();

export const between = (from: number, to: number) => from + roll() * (to - from);

export const pick = (list: readonly string[]) => list[Math.floor(roll() * list.length)] ?? '#FFFFFF';

export const many = (base: number, tune: Tune) => Math.max(1, Math.round(base * (tune.density ?? 1) * Math.min(2, Math.max(0, tune.intensity ?? 1))));

export const lives = (from: number, to: number, tune: Tune) => (tune.duration ?? between(from, to)) / Math.max(0.1, tune.speed ?? 1);

export const light = (base: number, tune: Tune) => Math.min(1, base * Math.max(0.2, tune.intensity ?? 1));

export const make = (shape: Shape, at: Point, fields: Partial<Particle>): Particle => ({
    shape,
    x: at.x,
    y: at.y,
    vx: 0,
    vy: 0,
    gravity: 0,
    drag: 0,
    age: 0,
    life: 600,
    size: 2,
    grow: 1,
    alpha: 1,
    envelope: 'fade',
    turn: 0,
    spin: 0,
    color: '#FFFFFF',
    glow: false,
    width: 1,
    ...fields
});

const FIRE = ['#FFE3A3', '#FFB04D', '#FF6A2B', '#E2381B'];
const SPARK = ['#FFFFFF', '#FFE08A', '#FFB347'];
const SMOKE = ['#9AA4B2', '#6B7280', '#4B5563'];
const DUST = ['#FFF5D6', '#FBE7A6', '#9CC2FF'];
export const ENERGY = ['#9CC2FF', '#C7DBFF', '#FFFFFF'];
export const ICE = ['#FFFFFF', '#DFF3FF', '#9FD8FF', '#6FC3F5'];
const PAPER = ['#FF5A4E', '#2FC262', '#FFC72C', '#3F8CFF', '#FFFFFF'];
const BOLT = ['#BFE8FF'];

/** How far either side of a tune's direction a throw may stray, in radians. */
const SPRAY = 0.9;

/** A throw from the point: each particle its own way, or within `SPRAY` of the tune's direction. */
export const radial = (speed: number, tune: Tune) =>
{
    const angle = tune.direction === undefined ? roll() * Math.PI * 2 : tune.direction + (roll() * 2 - 1) * SPRAY;
    const pace = speed * (tune.speed ?? 1) * (tune.scale ?? 1);
    return { vx: Math.cos(angle) * pace, vy: Math.sin(angle) * pace };
};

export const embersAt = (at: Point, tune: Tune, count: number, spread: number) =>
    Array.from({ length: count }, () =>
    {
        const scale = tune.scale ?? 1;
        return make('dot', { x: at.x + between(-spread, spread) * scale, y: at.y + between(-spread * 0.4, spread * 0.4) * scale }, {
            vx: between(-34, 34) * (tune.speed ?? 1),
            vy: between(-150, -80) * (tune.speed ?? 1),
            gravity: -40 * (tune.speed ?? 1),
            drag: 0.9,
            life: lives(900, 1700, tune),
            size: between(1.6, 3.4) * scale,
            grow: 0.2,
            alpha: light(0.95, tune),
            envelope: 'flicker',
            color: pick(tune.colors ?? FIRE),
            glow: true
        });
    });

export const sparksAt = (at: Point, tune: Tune, count: number) =>
    Array.from({ length: count }, () => make('spark', at, {
        ...radial(between(150, 330), tune),
        gravity: 420 * (tune.speed ?? 1),
        drag: 1.4,
        life: lives(260, 520, tune),
        size: between(1, 1.8) * (tune.scale ?? 1),
        alpha: light(1, tune),
        color: pick(tune.colors ?? SPARK),
        glow: true
    }));

export const ring = (at: Point, tune: Tune, from: number, to: number, width: number, life: number, wait = 0) =>
    make('ring', at, {
        age: -wait,
        life: lives(life, life, tune),
        size: from * (tune.scale ?? 1),
        grow: to / from,
        width: width * (tune.scale ?? 1),
        alpha: light(0.85, tune),
        color: pick(tune.colors ?? ENERGY),
        glow: true
    });

export const flakesAt = (at: Point, tune: Tune, count: number, reach: number) =>
    Array.from({ length: count }, () => make('flake', at, {
        ...radial(between(reach * 0.4, reach), tune),
        gravity: 26,
        drag: 1.3,
        spin: between(-3, 3),
        turn: roll() * Math.PI,
        life: lives(900, 1500, tune),
        size: between(2.4, 4.6) * (tune.scale ?? 1),
        alpha: light(0.95, tune),
        color: pick(tune.colors ?? ICE),
        glow: true
    }));

export const twinkles = (at: Point, tune: Tune, count: number, radius: number, colors: readonly string[]) =>
    Array.from({ length: count }, () =>
    {
        const angle = roll() * Math.PI * 2;
        const reach = Math.sqrt(roll()) * radius * (tune.scale ?? 1);
        return make('dot', { x: at.x + Math.cos(angle) * reach, y: at.y + Math.sin(angle) * reach }, {
            vx: between(-14, 14) * (tune.speed ?? 1),
            vy: between(-22, 6) * (tune.speed ?? 1),
            drag: 0.6,
            life: lives(900, 1700, tune),
            size: between(0.8, 1.8) * (tune.scale ?? 1),
            alpha: light(0.9, tune),
            envelope: 'swell',
            color: pick(tune.colors ?? colors),
            glow: true
        });
    });

export const PRESETS: Record<Preset, (at: Point, tune: Tune) => Particle[]> = {
    embers: (at, tune) => embersAt(at, tune, many(22, tune), 12),

    sparks: (at, tune) => sparksAt(at, tune, many(20, tune)),

    smoke: (at, tune) => Array.from({ length: many(10, tune) }, () => make('puff', { x: at.x + between(-14, 14) * (tune.scale ?? 1), y: at.y + between(-4, 4) }, {
        vx: between(-14, 14) * (tune.speed ?? 1),
        vy: between(-60, -28) * (tune.speed ?? 1),
        drag: 0.4,
        life: lives(1300, 2100, tune),
        size: between(10, 18) * (tune.scale ?? 1),
        grow: 3,
        alpha: light(0.3, tune),
        envelope: 'swell',
        color: pick(tune.colors ?? SMOKE)
    })),

    dust: (at, tune) => twinkles(at, tune, many(22, tune), 26, DUST),

    orbs: (at, tune) => Array.from({ length: many(7, tune) }, () => make('orb', at, {
        ...radial(between(40, 110), tune),
        drag: 1.1,
        life: lives(1300, 1900, tune),
        size: between(4, 7) * (tune.scale ?? 1),
        alpha: light(0.8, tune),
        envelope: 'swell',
        color: pick(tune.colors ?? ENERGY),
        glow: true
    })),

    stars: (at, tune) => Array.from({ length: many(14, tune) }, () => make('star', at, {
        ...radial(between(40, 120), tune),
        gravity: -10,
        drag: 1.6,
        spin: between(-1.2, 1.2),
        life: lives(800, 1400, tune),
        size: between(2.6, 5.4) * (tune.scale ?? 1),
        alpha: light(1, tune),
        envelope: 'swell',
        color: pick(tune.colors ?? DUST),
        glow: true
    })),

    burst: (at, tune) => [
        make('orb', at, { life: lives(200, 200, tune), size: 16 * (tune.scale ?? 1), alpha: light(0.75, tune), color: '#FFFFFF', glow: true }),
        ...Array.from({ length: many(18, tune) }, () => make('dot', at, {
            ...radial(between(90, 260), tune),
            drag: 3.2,
            life: lives(420, 760, tune),
            size: between(1.6, 3) * (tune.scale ?? 1),
            grow: 0.3,
            alpha: light(1, tune),
            color: pick(tune.colors ?? SPARK),
            glow: true
        })),
        ...sparksAt(at, tune, many(10, tune)),
        ring(at, tune, 4, 46, 2.4, 520)
    ],

    frost: (at, tune) => [...flakesAt(at, tune, many(14, tune), 90), ...twinkles(at, tune, many(8, tune), 18, ICE)],

    confetti: (at, tune) => Array.from({ length: many(36, tune) }, () =>
    {
        const angle = (-90 + between(-50, 50)) * Math.PI / 180;
        const pace = between(220, 420) * (tune.speed ?? 1) * (tune.scale ?? 1);
        return make('confetti', at, {
            vx: Math.cos(angle) * pace,
            vy: Math.sin(angle) * pace,
            gravity: 520 * (tune.speed ?? 1),
            drag: 0.9,
            spin: between(-9, 9),
            turn: roll() * Math.PI,
            life: lives(1400, 2200, tune),
            size: between(3, 5) * (tune.scale ?? 1),
            alpha: light(1, tune),
            color: pick(tune.colors ?? PAPER)
        });
    }),

    pulse: (at, tune) => [ring(at, tune, 6, 44, 2, 620)],

    shockwave: (at, tune) => [ring(at, tune, 4, 64, 3, 420), ring(at, tune, 4, 40, 1.6, 360, 110)]
};

/** What less motion is shown in place of any burst: one soft light that fades where it was. */
export const flash = (at: Point, tune: Tune) => [make('dot', at, {
    life: 240,
    size: 18 * (tune.scale ?? 1),
    alpha: light(0.45, tune),
    color: pick(tune.colors ?? ENERGY),
    glow: true
})];

export const bolt = (from: Point, to: Point, tune: Tune) => [
    make('bolt', from, {
        to,
        life: lives(380, 380, tune),
        width: 2.2 * (tune.scale ?? 1),
        alpha: light(1, tune),
        envelope: 'flicker',
        color: pick(tune.colors ?? BOLT),
        glow: true
    }),
    ...sparksAt(to, { ...tune, colors: tune.colors ?? ['#FFFFFF', ...BOLT] }, many(8, tune))
];

export interface Emitter
{
    /** How many it emits a second at a density of 1. */
    rate: number;
    spawn: (at: Point, tune: Tune, count: number) => Particle[];
}

export const STREAMS: Record<Stream, Emitter> = {
    trail: {
        rate: 46,
        spawn: (at, tune, count) => Array.from({ length: count }, () => make('dot', { x: at.x + between(-2, 2), y: at.y + between(-2, 2) }, {
            vx: between(-10, 10),
            vy: between(-10, 10),
            drag: 1.5,
            life: lives(380, 620, tune),
            size: between(1.6, 3) * (tune.scale ?? 1),
            grow: 0.2,
            alpha: light(0.85, tune),
            color: pick(tune.colors ?? ENERGY),
            glow: true
        }))
    },

    aura: {
        rate: 18,
        spawn: (at, tune, count) => Array.from({ length: count }, () =>
        {
            const angle = roll() * Math.PI * 2;
            const radius = 30 * (tune.scale ?? 1) * between(0.85, 1.1);
            return make('dot', { x: at.x + Math.cos(angle) * radius, y: at.y + Math.sin(angle) * radius }, {
                vx: -Math.sin(angle) * 18 * (tune.speed ?? 1),
                vy: Math.cos(angle) * 18 * (tune.speed ?? 1) - 14,
                drag: 0.5,
                pointer: 40,
                life: lives(900, 1500, tune),
                size: between(1, 2.2) * (tune.scale ?? 1),
                alpha: light(0.85, tune),
                envelope: 'swell',
                color: pick(tune.colors ?? DUST),
                glow: true
            });
        })
    },

    flames: {
        rate: 22,
        spawn: (at, tune, count) => embersAt(at, tune, count, 26)
    },

    arcs: {
        rate: 3,
        spawn: (at, tune, count) => Array.from({ length: count }, () =>
        {
            const radius = 30 * (tune.scale ?? 1);
            const from = roll() * Math.PI * 2;
            const to = from + between(0.45, 1.05);
            return make('bolt', { x: at.x + Math.cos(from) * radius, y: at.y + Math.sin(from) * radius }, {
                to: { x: at.x + Math.cos(to) * radius, y: at.y + Math.sin(to) * radius },
                around: at,
                life: lives(200, 260, tune),
                width: 1.4 * (tune.scale ?? 1),
                alpha: light(0.95, tune),
                envelope: 'flicker',
                color: pick(tune.colors ?? BOLT),
                glow: true
            });
        })
    },

    snow: {
        rate: 8,
        spawn: (at, tune, count) => Array.from({ length: count }, () =>
        {
            const angle = roll() * Math.PI * 2;
            const radius = 26 * (tune.scale ?? 1) * between(0.7, 1.1);
            return make('flake', { x: at.x + Math.cos(angle) * radius, y: at.y + Math.sin(angle) * radius }, {
                vx: between(-8, 8) * (tune.speed ?? 1),
                vy: between(16, 34) * (tune.speed ?? 1),
                drag: 0.3,
                spin: between(-2, 2),
                turn: roll() * Math.PI,
                life: lives(1200, 2000, tune),
                size: between(2.2, 3.8) * (tune.scale ?? 1),
                alpha: light(0.9, tune),
                envelope: 'swell',
                color: pick(tune.colors ?? ICE),
                glow: true
            });
        })
    }
};
