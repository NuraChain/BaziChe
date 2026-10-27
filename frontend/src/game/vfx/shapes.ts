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
    return 1 - at;
};

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
