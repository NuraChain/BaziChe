import { between, ENERGY, embersAt, ICE, lives, light, make, many, pick, radial, random, ring, sparksAt, TRAIL_EVERY, twinkles, type Emitter, type Particle, type Point, type Tune } from './presets.ts';

const TAU = Math.PI * 2;

const scaled = (tune: Tune) => tune.scale ?? 1;

const paced = (tune: Tune) => tune.speed ?? 1;

const FLAME = ['#FFF1C1', '#FFC14D', '#FF7A1F', '#E2381C'];
const CHARGE = ['#EAF6FF', '#7DF0FF', '#3FA9FF', '#8B5CFF'];
const COSMOS = ['#FFFFFF', '#FFE58A', '#4FE3D8', '#B04BFF'];
const SHADOW = ['#E9D5FF', '#A855F7', '#5B21B6'];
const RUNE = ['#F2C14E', '#BFF2D9', '#2BB67F'];
const SUN = ['#FFF6D6', '#FFC94A', '#FF7A1A', '#D7263D'];
const DIGITAL = ['#20E6FF', '#FF2E4D', '#7C5CFF', '#FFFFFF'];

/** A point on the ring of `radius` round `at`, at `angle` or anywhere. */
const onRing = (at: Point, radius: number, angle = random() * TAU) => ({ x: at.x + Math.cos(angle) * radius, y: at.y + Math.sin(angle) * radius, angle });

/** A crooked run from a point at `angle` for `length`, bending a little at each of its steps. */
const crooked = (angle: number, length: number, steps: number, bend: number) =>
{
    const points: Point[] = [{ x: 0, y: 0 }];
    let heading = angle;
    let x = 0;
    let y = 0;

    for (let step = 1; step <= steps; step += 1)
    {
        heading += between(-bend, bend);
        x += Math.cos(heading) * (length / steps);
        y += Math.sin(heading) * (length / steps);
        points.push({ x, y });
    }
    return points;
};

/** The places a ribbon on `orbit` has just come through, so it is born at its full length. */
const behind = (orbit: NonNullable<Particle['orbit']>, tail: number) => Array.from({ length: tail }, (_, nth) =>
{
    const angle = orbit.angle - orbit.speed * (tail - nth) * TRAIL_EVERY / 1000;
    const x = Math.cos(angle) * orbit.rx;
    const y = Math.sin(angle) * orbit.ry;
    return { x: orbit.x + x * Math.cos(orbit.tilt) - y * Math.sin(orbit.tilt), y: orbit.y + x * Math.sin(orbit.tilt) + y * Math.cos(orbit.tilt) };
});

const delayed = (particles: Particle[], wait: number) =>
{
    for (const particle of particles)
    {
        particle.age -= wait;
    }
    return particles;
};

/** A tongue of flame licking upward from about `at`. */
export const tongue = (at: Point, tune: Tune, spread: number) => make('flame', { x: at.x + between(-spread, spread) * scaled(tune), y: at.y + between(-spread, spread) * 0.3 * scaled(tune) }, {
    vx: between(-14, 14) * paced(tune),
    vy: between(-120, -70) * paced(tune),
    gravity: -60 * paced(tune),
    drag: 1.2,
    swirl: 90,
    life: lives(380, 720, tune),
    size: between(5, 9) * scaled(tune),
    grow: 0.25,
    alpha: light(0.8, tune),
    envelope: 'flicker',
    color: pick(tune.colors ?? FLAME),
    glow: true
});

const smokeAt = (at: Point, tune: Tune, count: number, wait: number) => delayed(Array.from({ length: count }, () => make('puff', { x: at.x + between(-16, 16) * scaled(tune), y: at.y - between(10, 30) * scaled(tune) }, {
    vx: between(-12, 12),
    vy: between(-46, -20) * paced(tune),
    drag: 0.4,
    swirl: 30,
    life: lives(1400, 2200, tune),
    size: between(10, 18) * scaled(tune),
    grow: 2.6,
    alpha: light(0.18, tune),
    envelope: 'swell',
    color: pick(['#5B4A44', '#3D312D', '#2A2220'])
})), wait);

const crack = (at: Point, tune: Tune, angle: number, length: number, colors: readonly string[], wait = 0) => make('crack', at, {
    age: -wait,
    outline: crooked(angle, length * scaled(tune), 7, 0.5),
    life: lives(900, 1300, tune),
    width: between(1.2, 2.2) * scaled(tune),
    alpha: light(1, tune),
    envelope: 'fade',
    color: pick(colors),
    glow: true
});

const shard = (at: Point, tune: Tune, speed: number, colors: readonly string[]) =>
{
    const size = between(3, 7) * scaled(tune);
    const corners = 3 + Math.floor(random() * 3);
    const outline = Array.from({ length: corners }, (_, nth) =>
    {
        const angle = (nth / corners) * TAU + between(-0.3, 0.3);
        const reach = size * between(0.6, 1.2);
        return { x: Math.cos(angle) * reach, y: Math.sin(angle) * reach * 1.6 };
    });

    return make('shard', at, {
        ...radial(between(speed * 0.5, speed), tune),
        gravity: 300 * paced(tune),
        drag: 1,
        spin: between(-6, 6),
        turn: random() * TAU,
        outline,
        life: lives(700, 1200, tune),
        size,
        alpha: light(0.9, tune),
        color: pick(colors),
        glow: false
    });
};

const rune = (at: Point, tune: Tune, colors: readonly string[], fields: Partial<Particle>) => make('rune', at, {
    glyph: Math.floor(random() * 8),
    size: between(5, 8) * scaled(tune),
    life: lives(1100, 1700, tune),
    alpha: light(0.95, tune),
    envelope: 'swell',
    color: pick(colors),
    glow: true,
    ...fields
});

const feather = (at: Point, tune: Tune, colors: readonly string[], fields: Partial<Particle>) => make('feather', at, {
    size: between(6, 10) * scaled(tune),
    turn: random() * TAU,
    spin: between(-1.4, 1.4),
    gravity: 24 * paced(tune),
    drag: 1.4,
    swirl: 40,
    life: lives(1400, 2200, tune),
    alpha: light(0.95, tune),
    envelope: 'swell',
    color: pick(colors),
    glow: true,
    ...fields
});

const glitch = (at: Point, tune: Tune, colors: readonly string[], fields: Partial<Particle>) => make('glitch', { x: at.x + between(-30, 30) * scaled(tune), y: at.y + between(-30, 30) * scaled(tune) }, {
    size: between(2, 5) * scaled(tune),
    width: between(4, 22) * scaled(tune),
    life: lives(300, 700, tune),
    alpha: light(0.85, tune),
    envelope: 'stutter',
    color: pick(colors),
    glow: true,
    ...fields
});

const ray = (at: Point, tune: Tune, angle: number, colors: readonly string[], fields: Partial<Particle>) => make('ray', at, {
    turn: angle,
    size: between(40, 70) * scaled(tune),
    width: between(2, 4) * scaled(tune),
    spin: 0.35,
    life: lives(1200, 1600, tune),
    alpha: light(0.5, tune),
    envelope: 'swell',
    color: pick(colors),
    glow: true,
    ...fields
});

export type Family = 'eruption' | 'cracks' | 'charge' | 'strike' | 'discharge' | 'starburst' | 'nebula' | 'rift' | 'implosion'
    | 'absorb' | 'release' | 'fracture' | 'crystals' | 'shatter' | 'sigil' | 'debris' | 'fireworks' | 'flare' | 'sunburst' | 'wings' | 'glitch' | 'scan';

export type FamilyStream = 'blaze' | 'cinders' | 'static' | 'orbit' | 'tendrils' | 'wisps' | 'mist' | 'glints' | 'runes' | 'coil' | 'feathers' | 'rays' | 'pixels' | 'comet';

/** The effect families: bursts that play once and say all they have to say, each a composition in time. */
export const FAMILIES: Record<Family, (at: Point, tune: Tune) => Particle[]> = {
    eruption: (at, tune) => [
        make('orb', at, { life: lives(320, 320, tune), size: 20 * scaled(tune), alpha: light(0.7, tune), color: '#FFF1C1', glow: true }),
        ...Array.from({ length: many(40, tune) }, (_, nth) => ({ ...tongue(at, tune, 10), age: -nth * 14, vy: between(-200, -110) * paced(tune), size: between(7, 12) * scaled(tune), life: lives(380, 640, tune) })),
        ...embersAt(at, { ...tune, speed: paced(tune) * 1.6 }, many(26, tune), 10),
        ...smokeAt(at, tune, many(7, tune), 160),
        ring(at, { ...tune, colors: tune.colors ?? FLAME }, 4, 58, 3, 460)
    ],

    cracks: (at, tune) =>
    {
        const count = many(6, tune);
        return [
            ...Array.from({ length: count }, (_, nth) => crack(at, tune, (nth / count) * TAU + between(-0.3, 0.3), between(34, 60), tune.colors ?? FLAME)),
            ...delayed(embersAt(at, tune, many(16, tune), 24), 260)
        ];
    },

    charge: (at, tune) => [
        ...Array.from({ length: many(26, tune) }, () =>
        {
            const from = onRing(at, between(38, 60) * scaled(tune));
            return make('dot', from, {
                well: { x: at.x, y: at.y, pull: 900 * paced(tune) },
                drag: 2.4,
                life: lives(480, 560, tune),
                size: between(1, 2) * scaled(tune),
                alpha: light(0.95, tune),
                envelope: 'swell',
                color: pick(tune.colors ?? CHARGE),
                glow: true
            });
        }),
        make('orb', at, { life: lives(520, 520, tune), size: 4 * scaled(tune), grow: 3, alpha: light(0.6, tune), envelope: 'swell', color: pick(tune.colors ?? CHARGE), glow: true })
    ],

    strike: (at, tune) =>
    {
        const top = { x: at.x + between(-24, 24) * scaled(tune), y: at.y - 150 * scaled(tune) };
        const colors = tune.colors ?? CHARGE;
        const branches = Array.from({ length: many(3, tune) }, () =>
        {
            const along = between(0.3, 0.75);
            const from = { x: top.x + (at.x - top.x) * along, y: top.y + (at.y - top.y) * along };
            return make('bolt', from, {
                to: { x: from.x + between(-40, 40) * scaled(tune), y: from.y + between(10, 40) * scaled(tune) },
                life: lives(200, 280, tune),
                width: 1.1 * scaled(tune),
                alpha: light(0.85, tune),
                envelope: 'flicker',
                color: pick(colors),
                glow: true
            });
        });

        return [
            make('bolt', top, { to: at, life: lives(360, 360, tune), width: 2.6 * scaled(tune), alpha: light(1, tune), envelope: 'flicker', color: pick(colors), glow: true }),
            ...branches,
            make('orb', at, { life: lives(220, 220, tune), size: 20 * scaled(tune), alpha: light(0.8, tune), color: '#FFFFFF', glow: true }),
            ...sparksAt(at, { ...tune, colors }, many(18, tune)),
            ring(at, { ...tune, colors }, 4, 52, 2.2, 420),
            ...Array.from({ length: many(3, tune) }, (_, nth) =>
            {
                const start = random() * TAU;
                const radius = 24 * scaled(tune);
                return make('bolt', { x: at.x + Math.cos(start) * radius, y: at.y + Math.sin(start) * radius }, {
                    age: -(160 + nth * 90),
                    to: { x: at.x + Math.cos(start + 0.8) * radius, y: at.y + Math.sin(start + 0.8) * radius },
                    around: at,
                    life: lives(200, 260, tune),
                    width: 1.2 * scaled(tune),
                    alpha: light(0.9, tune),
                    envelope: 'flicker',
                    color: pick(colors),
                    glow: true
                });
            })
        ];
    },

    discharge: (at, tune) => [
        ...Array.from({ length: many(7, tune) }, () =>
        {
            const end = onRing(at, between(30, 54) * scaled(tune));
            return make('bolt', at, { to: { x: end.x, y: end.y }, life: lives(180, 260, tune), width: 1.4 * scaled(tune), alpha: light(1, tune), envelope: 'flicker', color: pick(tune.colors ?? CHARGE), glow: true });
        }),
        ...sparksAt(at, { ...tune, colors: tune.colors ?? CHARGE }, many(14, tune))
    ],

    starburst: (at, tune) => [
        make('orb', at, { life: lives(240, 240, tune), size: 14 * scaled(tune), alpha: light(0.7, tune), color: '#FFFFFF', glow: true }),
        ...Array.from({ length: many(12, tune) }, () => make('star', at, {
            ...radial(between(60, 150), tune),
            drag: 1.8,
            spin: between(-1.5, 1.5),
            life: lives(800, 1300, tune),
            size: between(3, 6) * scaled(tune),
            alpha: light(1, tune),
            envelope: 'swell',
            color: pick(tune.colors ?? COSMOS),
            glow: true
        })),
        ...twinkles(at, tune, many(18, tune), 40, tune.colors ?? COSMOS),
        ring(at, { ...tune, colors: tune.colors ?? COSMOS }, 4, 50, 2, 520)
    ],

    nebula: (at, tune) => Array.from({ length: many(7, tune) }, () => make('nebula', { x: at.x + between(-24, 24) * scaled(tune), y: at.y + between(-18, 18) * scaled(tune) }, {
        vx: between(-10, 10),
        vy: between(-10, 10),
        drag: 0.6,
        spin: between(-0.3, 0.3),
        turn: random() * TAU,
        life: lives(2000, 3000, tune),
        size: between(26, 48) * scaled(tune),
        grow: 1.5,
        alpha: light(0.2, tune),
        envelope: 'swell',
        color: pick(tune.colors ?? COSMOS),
        glow: true
    })),

    rift: (at, tune) =>
    {
        const colors = tune.colors ?? COSMOS;
        return [
            make('slit', at, { life: lives(1500, 1500, tune), size: 34 * scaled(tune), width: 5 * scaled(tune), alpha: light(1, tune), envelope: 'swell', color: pick(colors), glow: true }),
            ...Array.from({ length: many(26, tune) }, () => make('star', at, {
                age: -between(180, 820),
                vx: between(-40, 40) * paced(tune),
                vy: between(-150, 150) * paced(tune),
                drag: 1.6,
                spin: between(-1, 1),
                life: lives(900, 1500, tune),
                size: between(1.6, 3.6) * scaled(tune),
                alpha: light(1, tune),
                envelope: 'swell',
                color: pick(colors),
                glow: true
            })),
            ...delayed(FAMILIES.nebula(at, { ...tune, colors }), 260),
            ...delayed([ring(at, { ...tune, colors }, 6, 60, 2, 600)], 1100)
        ];
    },

    implosion: (at, tune) => [
        ...Array.from({ length: many(30, tune) }, () =>
        {
            const from = onRing(at, between(44, 70) * scaled(tune));
            return make('dot', from, {
                well: { x: at.x, y: at.y, pull: 1400 * paced(tune) },
                drag: 3,
                life: lives(420, 460, tune),
                size: between(1.2, 2.2) * scaled(tune),
                alpha: light(0.9, tune),
                color: pick(tune.colors ?? COSMOS),
                glow: true
            });
        }),
        ...delayed(FAMILIES.starburst(at, tune), 440)
    ],

    absorb: (at, tune) => [
        make('shade', at, { life: lives(700, 700, tune), size: 22 * scaled(tune), grow: 1.8, alpha: light(0.7, tune), envelope: 'swell', color: '#030106' }),
        ...Array.from({ length: many(28, tune) }, () =>
        {
            const from = onRing(at, between(50, 80) * scaled(tune));
            return make('dot', from, {
                well: { x: at.x, y: at.y, pull: 1100 * paced(tune) },
                drag: 2.4,
                life: lives(560, 660, tune),
                size: between(1.2, 2.4) * scaled(tune),
                grow: 0.3,
                alpha: light(0.9, tune),
                envelope: 'swell',
                color: pick(tune.colors ?? SHADOW),
                glow: true
            });
        })
    ],

    release: (at, tune) => [
        ring(at, { ...tune, colors: tune.colors ?? SHADOW }, 6, 66, 2.6, 520),
        ...Array.from({ length: many(14, tune) }, () => make('puff', at, {
            ...radial(between(50, 120), tune),
            drag: 1.4,
            swirl: 60,
            life: lives(900, 1400, tune),
            size: between(6, 11) * scaled(tune),
            grow: 2,
            alpha: light(0.35, tune),
            envelope: 'flicker',
            color: pick(tune.colors ?? SHADOW),
            glow: true
        })),
        ...delayed(FAMILIES.fracture(at, tune), 120)
    ],

    fracture: (at, tune) =>
    {
        const count = many(5, tune);
        return Array.from({ length: count }, (_, nth) => crack(at, tune, (nth / count) * TAU + between(-0.4, 0.4), between(30, 56), tune.colors ?? SHADOW));
    },

    crystals: (at, tune) =>
    {
        const colors = tune.colors ?? ICE;
        const arms = Array.from({ length: 6 }, (_, nth) => crack(at, tune, (nth / 6) * TAU, between(30, 44), colors));
        const twigs = Array.from({ length: many(10, tune) }, () =>
        {
            const arm = Math.floor(random() * 6) * (TAU / 6);
            const out = between(10, 28) * scaled(tune);
            return crack({ x: at.x + Math.cos(arm) * out, y: at.y + Math.sin(arm) * out }, { ...tune, scale: scaled(tune) * 0.4 }, arm + (random() < 0.5 ? 1 : -1) * Math.PI / 3, between(14, 22), colors, 160);
        });
        return [...arms, ...twigs, ...delayed(twinkles(at, tune, many(12, tune), 36, colors), 300)];
    },

    shatter: (at, tune) => [
        make('orb', at, { life: lives(200, 200, tune), size: 14 * scaled(tune), alpha: light(0.7, tune), color: '#FFFFFF', glow: true }),
        ...Array.from({ length: many(16, tune) }, () => shard(at, tune, 260, tune.colors ?? ICE)),
        ...twinkles(at, tune, many(14, tune), 34, tune.colors ?? ICE),
        ...delayed(Array.from({ length: many(5, tune) }, () => make('puff', at, {
            ...radial(between(20, 50), tune),
            drag: 1,
            life: lives(1000, 1500, tune),
            size: between(10, 16) * scaled(tune),
            grow: 2.2,
            alpha: light(0.22, tune),
            envelope: 'swell',
            color: '#DFF3FF',
            glow: true
        })), 80)
    ],

    sigil: (at, tune) =>
    {
        const count = 8;
        const radius = 34 * scaled(tune);
        return [
            ...Array.from({ length: count }, (_, nth) => rune(at, tune, tune.colors ?? RUNE, {
                glyph: nth % 8,
                age: -nth * 40,
                orbit: { x: at.x, y: at.y, rx: radius, ry: radius, tilt: 0, angle: (nth / count) * TAU, speed: 1.2 * paced(tune) },
                life: lives(1500, 1500, tune)
            })),
            ring(at, { ...tune, colors: tune.colors ?? RUNE }, 8, 46, 1.6, 700, 300)
        ];
    },

    debris: (at, tune) => [
        ...Array.from({ length: many(12, tune) }, () => shard(at, tune, 200, tune.colors ?? ['#5B4A44', '#8A6E5C', '#2A2220'])),
        ...sparksAt(at, tune, many(8, tune))
    ],

    fireworks: (at, tune) => Array.from({ length: many(3, tune) }, (_, nth) =>
    {
        const burst = { x: at.x + between(-50, 50) * scaled(tune), y: at.y - between(30, 80) * scaled(tune) };
        return delayed(Array.from({ length: many(22, tune) }, () => make('dot', burst, {
            ...radial(between(60, 140), tune),
            gravity: 120 * paced(tune),
            drag: 1.4,
            life: lives(900, 1400, tune),
            size: between(1.2, 2.4) * scaled(tune),
            alpha: light(1, tune),
            envelope: 'flicker',
            color: pick(tune.colors ?? DIGITAL),
            glow: true
        })), nth * 260);
    }).flat(),

    flare: (at, tune) => [
        make('orb', at, { life: lives(320, 320, tune), size: 22 * scaled(tune), alpha: light(0.75, tune), color: '#FFF6D6', glow: true }),
        ring(at, { ...tune, colors: tune.colors ?? SUN }, 6, 70, 3.2, 560),
        ring(at, { ...tune, colors: tune.colors ?? SUN }, 6, 46, 1.6, 480, 120),
        ...Array.from({ length: many(12, tune) }, (_, nth) => ray(at, tune, (nth / 12) * TAU + between(-0.1, 0.1), tune.colors ?? SUN, { life: lives(700, 900, tune) }))
    ],

    sunburst: (at, tune) => [
        ...Array.from({ length: many(14, tune) }, (_, nth) => ray(at, tune, (nth / 14) * TAU, tune.colors ?? SUN, {})),
        make('orb', at, { life: lives(1400, 1400, tune), size: 12 * scaled(tune), alpha: light(0.6, tune), envelope: 'swell', color: pick(tune.colors ?? SUN), glow: true }),
        ...delayed(FAMILIES.flare(at, tune), 200)
    ],

    wings: (at, tune) =>
    {
        const colors = tune.colors ?? SUN;
        const radius = 36 * scaled(tune);
        return [-1, 1].flatMap((side) => Array.from({ length: many(16, tune) }, (_, nth) =>
        {
            const along = nth / 16;
            const angle = Math.PI / 2 + side * (0.4 + along * 1.6);
            const from = onRing(at, radius, angle);
            return feather(from, tune, colors, {
                age: -nth * 30,
                vx: side * Math.cos(angle - Math.PI / 2) * 40,
                vy: -between(60, 120) * paced(tune),
                turn: angle + Math.PI / 2,
                gravity: 30
            });
        }));
    },

    glitch: (at, tune) => [
        ...Array.from({ length: many(18, tune) }, () => glitch(at, tune, tune.colors ?? DIGITAL, {})),
        make('ray', { x: at.x - 60 * scaled(tune), y: at.y - 50 * scaled(tune) }, {
            turn: 0,
            vy: 180 * paced(tune),
            size: 120 * scaled(tune),
            width: 1.4 * scaled(tune),
            life: lives(560, 560, tune),
            alpha: light(0.7, tune),
            envelope: 'stutter',
            color: pick(tune.colors ?? DIGITAL),
            glow: true
        })
    ],

    scan: (at, tune) => [make('ray', { x: at.x - 80 * scaled(tune), y: at.y - 70 * scaled(tune) }, {
        turn: 0,
        vy: 140 * paced(tune),
        size: 160 * scaled(tune),
        width: 2 * scaled(tune),
        life: lives(1000, 1000, tune),
        alpha: light(0.6, tune),
        envelope: 'fade',
        color: pick(tune.colors ?? DIGITAL),
        glow: true
    })]
};

/** The families' streams: what a ring, a felt or a moving piece gives off for as long as it runs. */
export const FAMILY_STREAMS: Record<FamilyStream, Emitter> = {
    blaze: {
        rate: 46,
        spawn: (at, tune, count) => Array.from({ length: count }, () =>
        {
            const from = onRing(at, 30 * scaled(tune) * between(0.92, 1.04), between(Math.PI * 0.05, Math.PI * 0.95));
            return random() < 0.8 ? tongue(from, tune, 2) : embersAt(from, tune, 1, 3)[0]!;
        })
    },

    cinders: {
        rate: 9,
        spawn: (at, tune, count) => embersAt({ x: at.x, y: at.y + 20 * scaled(tune) }, { ...tune, speed: paced(tune) * 0.45 }, count, 50)
    },

    static: {
        rate: 4,
        spawn: (at, tune, count) => Array.from({ length: count }, () =>
        {
            const from = onRing(at, between(20, 38) * scaled(tune));
            const to = onRing({ x: from.x, y: from.y }, between(8, 16) * scaled(tune));
            return make('bolt', from, { to: { x: to.x, y: to.y }, life: lives(90, 150, tune), width: 0.9 * scaled(tune), alpha: light(0.9, tune), envelope: 'flicker', color: pick(tune.colors ?? CHARGE), glow: true });
        })
    },

    orbit: {
        rate: 7,
        spawn: (at, tune, count) => Array.from({ length: count }, () =>
        {
            const radius = 30 * scaled(tune);
            return make(random() < 0.4 ? 'star' : 'dot', at, {
                orbit: { x: at.x, y: at.y, rx: radius * between(0.95, 1.35), ry: radius * between(0.32, 0.62), tilt: between(-0.7, 0.7), angle: random() * TAU, speed: between(0.5, 1.3) * paced(tune) * (random() < 0.5 ? 1 : -1) },
                life: lives(2200, 3400, tune),
                size: between(1, 2.6) * scaled(tune),
                spin: between(-1, 1),
                alpha: light(0.95, tune),
                envelope: 'swell',
                color: pick(tune.colors ?? COSMOS),
                glow: true
            });
        })
    },

    tendrils: {
        rate: 2.4,
        spawn: (at, tune, count) => Array.from({ length: count }, () =>
        {
            const radius = 30 * scaled(tune) * between(0.95, 1.15);
            const orbit = { x: at.x, y: at.y, rx: radius, ry: radius * between(0.8, 1), tilt: between(-0.4, 0.4), angle: random() * TAU, speed: between(1.6, 2.4) * paced(tune) * (random() < 0.5 ? 1 : -1) };
            return make('ribbon', at, {
                orbit,
                trail: behind(orbit, 40),
                tail: 40,
                life: lives(1800, 2800, tune),
                size: between(3.2, 5) * scaled(tune),
                alpha: light(0.9, tune),
                envelope: 'swell',
                color: pick(tune.colors ?? SHADOW),
                glow: false
            });
        })
    },

    wisps: {
        rate: 8,
        spawn: (at, tune, count) => Array.from({ length: count }, () =>
        {
            const from = onRing(at, 30 * scaled(tune) * between(0.9, 1.2));
            return make('puff', from, {
                vx: between(-10, 10),
                vy: between(-28, -10) * paced(tune),
                swirl: 40,
                drag: 0.6,
                life: lives(1200, 2000, tune),
                size: between(5, 9) * scaled(tune),
                grow: 2,
                alpha: light(0.3, tune),
                envelope: 'flicker',
                color: pick(tune.colors ?? SHADOW),
                glow: true
            });
        })
    },

    mist: {
        rate: 5,
        spawn: (at, tune, count) => Array.from({ length: count }, () => make('puff', { x: at.x + between(-40, 40) * scaled(tune), y: at.y + between(14, 34) * scaled(tune) }, {
            vx: between(-14, 14),
            vy: between(-6, 2),
            drag: 0.3,
            life: lives(2000, 3000, tune),
            size: between(12, 20) * scaled(tune),
            grow: 1.8,
            alpha: light(0.14, tune),
            envelope: 'swell',
            color: pick(tune.colors ?? ICE),
            glow: true
        }))
    },

    glints: {
        rate: 6,
        spawn: (at, tune, count) => Array.from({ length: count }, () => make('star', onRing(at, 30 * scaled(tune) * between(0.8, 1.2)), {
            life: lives(500, 900, tune),
            size: between(2, 4) * scaled(tune),
            spin: between(-2, 2),
            alpha: light(1, tune),
            envelope: 'swell',
            color: pick(tune.colors ?? ICE),
            glow: true
        }))
    },

    runes: {
        rate: 1.6,
        spawn: (at, tune, count) => Array.from({ length: count }, () =>
        {
            const from = onRing(at, 32 * scaled(tune));
            return rune({ x: from.x, y: from.y }, tune, tune.colors ?? RUNE, { vy: -16 * paced(tune), spin: between(-0.4, 0.4) });
        })
    },

    coil: {
        rate: 0.7,
        spawn: (at, tune, count) => Array.from({ length: count }, () =>
        {
            const radius = 31 * scaled(tune);
            const orbit = { x: at.x, y: at.y, rx: radius, ry: radius * 0.92, tilt: 0, angle: random() * TAU, speed: 2.2 * paced(tune) };
            return make('ribbon', at, {
                orbit,
                trail: behind(orbit, 110),
                tail: 110,
                life: lives(3200, 4200, tune),
                size: between(2.8, 3.6) * scaled(tune),
                alpha: light(0.9, tune),
                envelope: 'swell',
                color: pick(tune.colors ?? RUNE),
                glow: true
            });
        })
    },

    feathers: {
        rate: 3,
        spawn: (at, tune, count) => Array.from({ length: count }, () => feather(onRing(at, 32 * scaled(tune) * between(0.9, 1.2), between(Math.PI * 0.2, Math.PI * 0.8)), tune, tune.colors ?? SUN, {
            vy: -between(20, 50) * paced(tune),
            gravity: -10
        }))
    },

    rays: {
        rate: 1.2,
        spawn: (at, tune, count) => Array.from({ length: count }, () => ray(at, tune, random() * TAU, tune.colors ?? SUN, { alpha: light(0.45, tune), width: between(3, 5) * scaled(tune), life: lives(2400, 3200, tune), spin: 0.2 }))
    },

    pixels: {
        rate: 18,
        spawn: (at, tune, count) => Array.from({ length: count }, () =>
        {
            const radius = 30 * scaled(tune) * between(0.95, 1.25);
            return glitch(at, tune, tune.colors ?? DIGITAL, {
                orbit: { x: at.x, y: at.y, rx: radius, ry: radius, tilt: 0, angle: random() * TAU, speed: between(0.6, 1.4) * paced(tune) },
                size: between(2, 3.4) * scaled(tune),
                width: between(2, 3.4) * scaled(tune),
                life: lives(900, 1500, tune)
            });
        })
    },

    comet: {
        rate: 40,
        spawn: (at, tune, count) => Array.from({ length: count }, () => make(random() < 0.15 ? 'star' : 'dot', { x: at.x + between(-2, 2), y: at.y + between(-2, 2) }, {
            vx: between(-8, 8),
            vy: between(-8, 8),
            drag: 1.6,
            life: lives(420, 700, tune),
            size: between(1.4, 2.8) * scaled(tune),
            grow: 0.1,
            spin: between(-2, 2),
            alpha: light(0.9, tune),
            color: pick(tune.colors ?? ENERGY),
            glow: true
        }))
    }
};
