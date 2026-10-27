import type { Particle, Point } from './presets.ts';

const TAU = Math.PI * 2;

const clear = (hex: string, alpha: number) =>
{
    const value = /^#([0-9a-f]{6})$/i.exec(hex)?.[1];
    if (value === undefined)
    {
        return `rgba(255,255,255,${ alpha })`;
    }
    const number = Number.parseInt(value, 16);
    return `rgba(${ number >> 16 },${ (number >> 8) & 255 },${ number & 255 },${ alpha })`;
};

const sprites = new Map<string, HTMLCanvasElement | null>();

/**
 * A soft light in one colour, drawn once and then stamped wherever a particle of that colour
 * glows, so a glowing particle costs one draw; null where no canvas can be made, and a plain
 * circle is drawn instead.
 */
function sprite(color: string, core: boolean)
{
    const key = `${ color }${ core ? '*' : '' }`;
    if (!sprites.has(key))
    {
        const canvas = typeof document === 'undefined' ? null : document.createElement('canvas');
        const context = canvas?.getContext('2d') ?? null;

        if (canvas === null || context === null)
        {
            sprites.set(key, null);
        }
        else
        {
            canvas.width = 64;
            canvas.height = 64;
            const light = context.createRadialGradient(32, 32, 0, 32, 32, 32);
            if (core)
            {
                light.addColorStop(0, '#FFFFFF');
                light.addColorStop(0.14, color);
                light.addColorStop(0.36, clear(color, 0.5));
            }
            else
            {
                light.addColorStop(0, color);
                light.addColorStop(0.5, clear(color, 0.4));
            }
            light.addColorStop(1, clear(color, 0));
            context.fillStyle = light;
            context.fillRect(0, 0, 64, 64);
            sprites.set(key, canvas);
        }
    }
    return sprites.get(key) ?? null;
}

function soft(context: CanvasRenderingContext2D, particle: Particle, radius: number, core: boolean)
{
    const image = sprite(particle.color, core);
    if (image === null)
    {
        context.beginPath();
        context.arc(particle.x, particle.y, radius / 3, 0, TAU);
        context.fill();
        return;
    }
    context.drawImage(image, particle.x - radius, particle.y - radius, radius * 2, radius * 2);
}

/** A crooked line between two points, each half bent aside by less than the last. */
function jagged(from: Point, to: Point)
{
    let points = [from, to];
    let reach = Math.hypot(to.x - from.x, to.y - from.y) * 0.2;

    for (let depth = 0; depth < 4; depth += 1)
    {
        const next: Point[] = [points[0]!];
        for (let index = 1; index < points.length; index += 1)
        {
            const a = points[index - 1]!;
            const b = points[index]!;
            const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            const aside = (Math.random() - 0.5) * 2 * reach;
            next.push({ x: (a.x + b.x) / 2 - ((b.y - a.y) / length) * aside, y: (a.y + b.y) / 2 + ((b.x - a.x) / length) * aside }, b);
        }
        points = next;
        reach /= 2;
    }
    return points;
}

/**
 * A crooked run the short way round `around`, from one point of its ring to another, wandering in
 * and out of the ring by less at each halving: at most a ninth of the radius either way.
 */
export function crawling(from: Point, to: Point, around: Point)
{
    const radius = Math.hypot(from.x - around.x, from.y - around.y);
    const start = Math.atan2(from.y - around.y, from.x - around.x);
    const turned = Math.atan2(to.y - around.y, to.x - around.x) - start;
    const sweep = turned - TAU * Math.round(turned / TAU);
    let steps = [{ along: 0, out: 0 }, { along: 1, out: 0 }];
    let reach = radius / 18;

    for (let depth = 0; depth < 4; depth += 1)
    {
        const next = [steps[0]!];
        for (let index = 1; index < steps.length; index += 1)
        {
            const a = steps[index - 1]!;
            const b = steps[index]!;
            next.push({ along: (a.along + b.along) / 2, out: (a.out + b.out) / 2 + (Math.random() - 0.5) * 2 * reach }, b);
        }
        steps = next;
        reach /= 2;
    }
    return steps.map(({ along, out }) => ({
        x: around.x + Math.cos(start + sweep * along) * (radius + out),
        y: around.y + Math.sin(start + sweep * along) * (radius + out)
    }));
}

const brightness = (particle: Particle, at: number) =>
{
    if (particle.envelope === 'swell')
    {
        return Math.sin(Math.PI * at);
    }
    if (particle.envelope === 'flicker')
    {
        return (1 - at ** 3) * (0.8 + 0.2 * Math.sin(particle.age * 0.09 + particle.x));
    }
    if (particle.envelope === 'stutter')
    {
        return (Math.floor(particle.age / 55) % 3 === 1 ? 0.25 : 1) * (1 - at);
    }
    return 1 - at;
};

const flames = new Map<string, HTMLCanvasElement | null>();

/** A tongue of flame in one colour, white at its root, drawn once and stamped wherever one burns. */
function flameSprite(color: string)
{
    if (!flames.has(color))
    {
        const canvas = typeof document === 'undefined' ? null : document.createElement('canvas');
        const context = canvas?.getContext('2d') ?? null;

        if (canvas === null || context === null)
        {
            flames.set(color, null);
        }
        else
        {
            canvas.width = 32;
            canvas.height = 64;
            const light = context.createRadialGradient(16, 46, 1, 16, 38, 34);
            light.addColorStop(0, '#FFFFFF');
            light.addColorStop(0.22, color);
            light.addColorStop(0.7, clear(color, 0.35));
            light.addColorStop(1, clear(color, 0));
            context.fillStyle = light;
            context.beginPath();
            context.moveTo(16, 1);
            context.bezierCurveTo(25, 18, 31, 34, 28, 47);
            context.arc(16, 47, 12, 0, Math.PI);
            context.bezierCurveTo(1, 34, 7, 18, 16, 1);
            context.fill();
            flames.set(color, canvas);
        }
    }
    return flames.get(color) ?? null;
}

/** Eight runes, each a few strokes inside a square two units wide. */
const RUNES = [
    [[0, -1, 0, 1], [0, -0.4, 0.6, -0.9], [0, 0.1, 0.6, -0.4]],
    [[0, -1, 0, 1], [0, -1, 0.6, -0.4, 0, 0.2]],
    [[-0.6, -1, 0, 1, 0.6, -1]],
    [[-0.6, 1, 0, -1, 0.6, 1], [-0.35, 0.2, 0.35, 0.2]],
    [[0, -1, 0, 1], [-0.6, -0.5, 0.6, 0.5], [0.6, -0.5, -0.6, 0.5]],
    [[-0.6, -1, 0.6, -1, -0.6, 1, 0.6, 1]],
    [[0, -1, 0.6, 0, 0, 1, -0.6, 0, 0, -1]],
    [[-0.6, -0.8, 0.6, -0.8], [0, -0.8, 0, 1], [-0.4, 0.3, 0.4, 0.3]]
] as const;

/** Strokes a path twice, a wide faint glow and a narrow bright line, the way every lit line here is drawn. */
function lit(context: CanvasRenderingContext2D, trace: () => void, width: number, core = '')
{
    for (const [stroke, alpha] of [[width * 3.4, 0.22], [width, 1]] as const)
    {
        context.globalAlpha *= alpha;
        context.lineWidth = stroke;
        context.beginPath();
        trace();
        context.stroke();
        context.globalAlpha /= alpha;
    }
    if (core !== '')
    {
        context.strokeStyle = core;
        context.lineWidth = width * 0.4;
        context.beginPath();
        trace();
        context.stroke();
    }
}

/** The shapes the effect families draw, each from where the particle is and how far through its life. */
function drawFamily(context: CanvasRenderingContext2D, particle: Particle, size: number, at: number)
{
    if (particle.shape === 'flame')
    {
        const image = flameSprite(particle.color);
        const tall = size * 4 * (0.85 + 0.3 * Math.sin(particle.age * 0.05 + particle.x));
        context.save();
        context.translate(particle.x, particle.y);
        context.rotate(Math.atan2(particle.vy, particle.vx) + Math.PI / 2);
        if (image === null)
        {
            context.beginPath();
            context.arc(0, 0, size, 0, TAU);
            context.fill();
        }
        else
        {
            context.drawImage(image, -size, -tall * 0.75, size * 2, tall);
        }
        context.restore();
        return;
    }

    if (particle.shape === 'shard')
    {
        context.save();
        context.translate(particle.x, particle.y);
        context.rotate(particle.turn);
        context.beginPath();
        (particle.outline ?? []).forEach((point, index) => (index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y)));
        context.closePath();
        context.globalAlpha *= 0.8;
        context.fill();
        context.globalCompositeOperation = 'lighter';
        context.strokeStyle = '#FFFFFF';
        context.lineWidth = Math.max(0.6, particle.size * 0.14);
        context.stroke();
        context.restore();
        return;
    }

    if (particle.shape === 'feather')
    {
        context.save();
        context.translate(particle.x, particle.y);
        context.rotate(particle.turn);
        context.beginPath();
        context.moveTo(0, -size * 2);
        context.quadraticCurveTo(size * 0.95, -size * 0.5, 0, size * 1.6);
        context.quadraticCurveTo(-size * 0.95, -size * 0.5, 0, -size * 2);
        context.globalAlpha *= 0.85;
        context.fill();
        context.strokeStyle = '#FFFFFF';
        context.lineWidth = Math.max(0.5, size * 0.1);
        context.beginPath();
        context.moveTo(0, size * 2.2);
        context.lineTo(0, -size * 1.9);
        context.stroke();
        context.restore();
        return;
    }

    if (particle.shape === 'rune')
    {
        const glyph = RUNES[(particle.glyph ?? 0) % RUNES.length] ?? RUNES[0];
        context.save();
        context.translate(particle.x, particle.y);
        context.rotate(particle.turn);
        context.lineCap = 'round';
        context.lineJoin = 'round';
        lit(context, () =>
        {
            for (const stroke of glyph)
            {
                for (let index = 0; index < stroke.length; index += 2)
                {
                    const x = (stroke[index] ?? 0) * size;
                    const y = (stroke[index + 1] ?? 0) * size;
                    if (index === 0)
                    {
                        context.moveTo(x, y);
                    }
                    else
                    {
                        context.lineTo(x, y);
                    }
                }
            }
        }, Math.max(0.6, size * 0.16));
        context.restore();
        return;
    }

    if (particle.shape === 'ribbon')
    {
        const trail = particle.trail ?? [];
        context.lineCap = 'round';
        for (let index = 1; index < trail.length; index += 1)
        {
            const from = trail[index - 1]!;
            const to = trail[index]!;
            const share = index / trail.length;
            const alpha = context.globalAlpha;
            if (!particle.glow)
            {
                context.globalCompositeOperation = 'source-over';
                context.strokeStyle = '#0A0612';
                context.globalAlpha = alpha * Math.sqrt(share) * 0.85;
                context.lineWidth = size * share * 2.2;
                context.beginPath();
                context.moveTo(from.x, from.y);
                context.lineTo(to.x, to.y);
                context.stroke();
                context.globalCompositeOperation = 'lighter';
            }
            context.strokeStyle = particle.color;
            context.globalAlpha = alpha * (particle.glow ? 0.3 + 0.7 * share : Math.sqrt(share));
            context.lineWidth = size * (particle.glow ? 0.35 + 0.65 * share : share * 0.7);
            context.beginPath();
            context.moveTo(from.x, from.y);
            context.lineTo(to.x, to.y);
            context.stroke();
            context.globalAlpha = alpha;
        }
        return;
    }

    if (particle.shape === 'nebula')
    {
        context.save();
        context.translate(particle.x, particle.y);
        context.rotate(particle.turn);
        context.scale(1.4, 0.75);
        soft(context, { ...particle, x: 0, y: 0 }, size, false);
        context.restore();
        return;
    }

    if (particle.shape === 'shade')
    {
        soft(context, particle, size, false);
        return;
    }

    if (particle.shape === 'glitch')
    {
        const jump = (Math.floor(particle.age / 60) % 2 === 0 ? 1 : -1) * particle.width * 0.15;
        context.fillRect(particle.x - particle.width / 2 + jump, particle.y - size / 2, particle.width, size);
        return;
    }

    if (particle.shape === 'crack')
    {
        const outline = particle.outline ?? [];
        const reached = Math.max(2, Math.ceil(outline.length * Math.min(1, at / 0.3)));
        context.lineCap = 'round';
        context.lineJoin = 'round';
        lit(context, () => outline.slice(0, reached).forEach((point, index) => (index === 0 ? context.moveTo(particle.x + point.x, particle.y + point.y) : context.lineTo(particle.x + point.x, particle.y + point.y))), particle.width, '#FFFFFF');
        return;
    }

    if (particle.shape === 'ray')
    {
        const reach = size * (0.85 + 0.15 * Math.sin(particle.age * 0.004 + particle.turn * 3));
        const from = { x: particle.x + Math.cos(particle.turn) * reach * 0.12, y: particle.y + Math.sin(particle.turn) * reach * 0.12 };
        const to = { x: particle.x + Math.cos(particle.turn) * reach, y: particle.y + Math.sin(particle.turn) * reach };
        const beam = typeof context.createLinearGradient === 'function' ? context.createLinearGradient(from.x, from.y, to.x, to.y) : null;
        beam?.addColorStop(0, particle.color);
        beam?.addColorStop(1, clear(particle.color, 0));
        context.strokeStyle = beam ?? particle.color;
        context.lineCap = 'round';
        lit(context, () =>
        {
            context.moveTo(from.x, from.y);
            context.lineTo(to.x, to.y);
        }, particle.width);
        return;
    }

    if (particle.shape === 'slit')
    {
        const open = Math.sin(Math.PI * at);
        const wide = particle.width + size * 0.55 * open;
        const tall = size * Math.max(0.08, open);
        context.save();
        context.globalCompositeOperation = 'source-over';
        context.globalAlpha = Math.min(0.85, context.globalAlpha);
        context.fillStyle = '#05030A';
        context.beginPath();
        context.ellipse(particle.x, particle.y, wide, tall, 0, 0, TAU);
        context.fill();
        context.restore();
        lit(context, () => context.ellipse(particle.x, particle.y, wide, tall, 0, 0, TAU), Math.max(1, particle.width * 0.4), '#FFFFFF');
    }
}

const FAMILY_SHAPES = new Set(['flame', 'shard', 'feather', 'rune', 'ribbon', 'nebula', 'shade', 'glitch', 'crack', 'ray', 'slit']);

export function drawParticle(context: CanvasRenderingContext2D, particle: Particle)
{
    if (particle.age < 0)
    {
        return;
    }

    const at = Math.min(1, particle.age / particle.life);
    const size = particle.size * (1 + (particle.grow - 1) * at);

    context.globalAlpha = Math.max(0, Math.min(1, particle.alpha * brightness(particle, at)));
    context.globalCompositeOperation = particle.glow ? 'lighter' : 'source-over';
    context.fillStyle = particle.color;
    context.strokeStyle = particle.color;

    if (FAMILY_SHAPES.has(particle.shape))
    {
        drawFamily(context, particle, size, at);
        return;
    }

    if (particle.shape === 'dot' && particle.glow)
    {
        soft(context, particle, size * 3, true);
        return;
    }

    if (particle.shape === 'dot')
    {
        context.beginPath();
        context.arc(particle.x, particle.y, size, 0, TAU);
        context.fill();
        return;
    }

    if (particle.shape === 'orb')
    {
        soft(context, particle, size * 3.4, true);
        return;
    }

    if (particle.shape === 'puff')
    {
        soft(context, particle, size, false);
        return;
    }

    if (particle.shape === 'spark')
    {
        const pace = Math.hypot(particle.vx, particle.vy) || 1;
        const length = size * 3 + pace * 0.03;
        context.lineWidth = size;
        context.lineCap = 'round';
        context.beginPath();
        context.moveTo(particle.x, particle.y);
        context.lineTo(particle.x - (particle.vx / pace) * length, particle.y - (particle.vy / pace) * length);
        context.stroke();
        return;
    }

    if (particle.shape === 'ring')
    {
        const width = particle.width * (1 - at * 0.6);
        for (const [stroke, alpha] of [[width * 3.2, 0.28], [width, 1]] as const)
        {
            context.globalAlpha *= alpha;
            context.lineWidth = stroke;
            context.beginPath();
            context.arc(particle.x, particle.y, size, 0, TAU);
            context.stroke();
            context.globalAlpha /= alpha;
        }
        return;
    }

    if (particle.shape === 'bolt')
    {
        if (particle.points === undefined || particle.age >= (particle.redraw ?? 0))
        {
            const from = { x: particle.x, y: particle.y };
            const to = particle.to ?? from;
            particle.points = particle.around === undefined ? jagged(from, to) : crawling(from, to, particle.around);
            particle.redraw = particle.age + 60;
        }
        context.lineCap = 'round';
        context.lineJoin = 'round';
        for (const [width, alpha, tone] of [[particle.width * 5, 0.16, particle.color], [particle.width * 2.2, 0.5, particle.color], [particle.width * 0.8, 1, '#FFFFFF']] as const)
        {
            context.globalAlpha *= alpha;
            context.lineWidth = width;
            context.strokeStyle = tone;
            context.beginPath();
            particle.points.forEach((point, index) => (index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y)));
            context.stroke();
            context.globalAlpha /= alpha;
        }
        return;
    }

    context.save();
    context.translate(particle.x, particle.y);
    context.rotate(particle.turn);

    if (particle.shape === 'star')
    {
        context.beginPath();
        context.moveTo(0, -size);
        context.quadraticCurveTo(0, 0, size, 0);
        context.quadraticCurveTo(0, 0, 0, size);
        context.quadraticCurveTo(0, 0, -size, 0);
        context.quadraticCurveTo(0, 0, 0, -size);
        context.fill();
    }
    else if (particle.shape === 'flake')
    {
        context.lineWidth = Math.max(0.6, size * 0.2);
        context.lineCap = 'round';
        context.beginPath();
        for (let arm = 0; arm < 6; arm += 1)
        {
            const angle = (arm * TAU) / 6;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            context.moveTo(0, 0);
            context.lineTo(cos * size, sin * size);
            context.moveTo(cos * size * 0.55, sin * size * 0.55);
            context.lineTo(cos * size * 0.55 + Math.cos(angle + 0.7) * size * 0.3, sin * size * 0.55 + Math.sin(angle + 0.7) * size * 0.3);
        }
        context.stroke();
    }
    else
    {
        context.scale(1, Math.cos(particle.age * 0.012));
        context.fillRect(-size / 2, -size * 0.3, size, size * 0.6);
    }

    context.restore();
}
