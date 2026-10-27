import { TRAIL_EVERY, type Particle, type Point } from './presets.ts';

/**
 * Keeps where a ribbon was at every `TRAIL_EVERY` ms of its life, each place found between where
 * this step began and where it ended, so a slow frame keeps the places it skipped and a ribbon is
 * as long at 25 frames a second as at 120.
 */
function keep(particle: Particle, from: Point, ms: number)
{
    const trail = particle.trail;
    if (trail === undefined)
    {
        return;
    }

    const began = particle.age - ms;
    let kept = particle.kept ?? -TRAIL_EVERY;

    while (particle.age - kept >= TRAIL_EVERY)
    {
        kept += TRAIL_EVERY;
        const share = ms <= 0 ? 1 : Math.min(1, Math.max(0, (kept - began) / ms));
        trail.push({ x: from.x + (particle.x - from.x) * share, y: from.y + (particle.y - from.y) * share });
    }
    particle.kept = kept;

    const over = trail.length - (particle.tail ?? 12);
    if (over > 0)
    {
        trail.splice(0, over);
    }
}

/**
 * Moves a particle on by `ms` of its life, the age already counted: round its orbit, or by its
 * velocity under its well, the pointer, its eddies, drag and gravity.
 */
export function move(particle: Particle, ms: number, pointer: Point | null)
{
    const seconds = ms / 1000;
    const from = { x: particle.x, y: particle.y };
    const orbit = particle.orbit;

    if (orbit !== undefined)
    {
        orbit.angle += orbit.speed * seconds;
        const x = Math.cos(orbit.angle) * orbit.rx;
        const y = Math.sin(orbit.angle) * orbit.ry;
        particle.x = orbit.x + x * Math.cos(orbit.tilt) - y * Math.sin(orbit.tilt);
        particle.y = orbit.y + x * Math.sin(orbit.tilt) + y * Math.cos(orbit.tilt);
    }
    else
    {
        const well = particle.well;
        if (well !== undefined)
        {
            const dx = well.x - particle.x;
            const dy = well.y - particle.y;
            const reach = Math.hypot(dx, dy) || 1;
            particle.vx += (dx / reach) * well.pull * seconds;
            particle.vy += (dy / reach) * well.pull * seconds;
        }
        if (particle.pointer !== undefined && pointer !== null)
        {
            const dx = pointer.x - particle.x;
            const dy = pointer.y - particle.y;
            const reach = Math.hypot(dx, dy) || 1;
            particle.vx += (dx / reach) * particle.pointer * seconds;
            particle.vy += (dy / reach) * particle.pointer * seconds;
        }
        if (particle.swirl !== undefined)
        {
            particle.vx += Math.sin(particle.y * 0.045 + particle.age * 0.0021) * particle.swirl * seconds;
            particle.vy += Math.cos(particle.x * 0.045 + particle.age * 0.0017) * particle.swirl * seconds;
        }
        particle.vx *= 1 - particle.drag * seconds;
        particle.vy = particle.vy * (1 - particle.drag * seconds) + particle.gravity * seconds;
        particle.x += particle.vx * seconds;
        particle.y += particle.vy * seconds;
    }
    particle.turn += particle.spin * seconds;

    keep(particle, from, ms);
}
