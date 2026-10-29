import { describe, expect, it } from 'vitest';

import { BORNE, ENTRIES, PAIR } from '../src/game/looks/backgammon.ts';
import { playAt } from '../src/game/looks/cards.ts';
import { cheerAt } from '../src/game/looks/celebrations.ts';
import { CASTLES, CHECKS, FINALES, LANDING, MATE_SQUARES } from '../src/game/looks/chess.ts';
import { enterAt } from '../src/game/looks/entrances.ts';
import { ARRIVAL_CELLS, TRAILS, TRAIL_CELLS, TRAIL_DENSITY } from '../src/game/looks/ludo.ts';
import { momentOf, retune, STAGES, trailOf, type TableMoment } from '../src/game/looks/moments.ts';
import { PALETTES } from '../src/game/looks/palette.ts';
import { burstOf, CAPTURES, CRITICALS, lightOf, type Collection } from '../src/game/looks/table.ts';
import { MOMENTS } from '../src/game/sound-files.ts';

const COLLECTIONS = Object.keys(PALETTES) as Collection[];

const PLACE = { x: 100, y: 40, width: 60, height: 80 };

const MIDDLE = { x: 130, y: 80 };

/** The scale a board draws an effect at for a thing `width` pixels wide, `size` of them across. */
const scaleFor = (width: number, size = 1) => width * size / 40;

describe('the moments a fitting room plays at its tables', () =>
{
    it('are every moment a board plays a look at, each on the stage of its game', () =>
    {
        expect(STAGES.ludo).toEqual(['die', 'six', 'walk', 'spawn', 'capture', 'entrance', 'set', 'win']);
        expect(STAGES.cards).toEqual(['card', 'entrance', 'set', 'win']);
        expect(STAGES.backgammon).toEqual(['die', 'doubles', 'hit', 'entry', 'borne', 'entrance', 'set', 'win']);
        expect(STAGES.chess).toEqual(['piece', 'castle', 'check', 'capture', 'promotion', 'mate', 'entrance', 'set', 'win']);
    });

    it('say each one in a voice a collection has at a table or for its win, and say a check in none, as a chess table does', () =>
    {
        const heard: readonly string[] = [...MOMENTS.table, ...MOMENTS.celebration];

        for (const collection of COLLECTIONS)
        {
            for (const moment of new Set(Object.values(STAGES).flat()) as Set<TableMoment>)
            {
                const { voice } = momentOf(moment, collection, PLACE);

                if (moment === 'check')
                {
                    expect(voice, 'a check was said in a look’s voice, which no table does').toBeNull();
                    continue;
                }

                expect(heard, `${ collection } ${ moment } said a voice no pack holds`).toContain(voice);
            }
        }
    });

    it('play a die, a six and doubles as Ludo and backgammon do, sized to the die and over the pair', () =>
    {
        for (const collection of COLLECTIONS)
        {
            const landed = momentOf('die', collection, PLACE);
            const six = momentOf('six', collection, PLACE);
            const doubles = momentOf('doubles', collection, PLACE);

            expect(landed.steps).toEqual([{ effect: burstOf(collection).effect }]);
            expect(landed.tune).toEqual({ colors: lightOf(collection), scale: scaleFor(PLACE.width) });
            expect(landed.at).toEqual(MIDDLE);
            expect(landed.voice).toBe('die');
            expect(six.steps).toBe(CRITICALS[collection]);
            expect(six.tune.scale).toBe(scaleFor(PLACE.width));
            expect(doubles.steps).toBe(CRITICALS[collection]);
            expect(doubles.tune.scale, 'doubles were not revealed as wide as the pair').toBe(scaleFor(PLACE.width, PAIR));
            expect([six.voice, doubles.voice]).toEqual(['die', 'die']);
        }
    });

    it('land a Ludo pawn with its puff, leave a yard with its ring, and take a pawn with its capture, each as wide as the board draws it', () =>
    {
        const walked = momentOf('walk', 'jade', PLACE);
        const left = momentOf('spawn', 'jade', PLACE);
        const taken = momentOf('capture', 'jade', PLACE);

        expect(walked.steps).toEqual([{ effect: 'dust' }]);
        expect(walked.voice).toBe('pawn');
        expect(walked.tune.scale).toBe(scaleFor(PLACE.width, ARRIVAL_CELLS));
        expect(left.steps).toEqual([{ effect: 'shockwave' }]);
        expect(left.voice).toBe('spawn');
        expect(left.tune.scale).toBe(scaleFor(PLACE.width, ARRIVAL_CELLS));
        expect(taken.steps).toBe(CAPTURES.jade);
        expect(taken.voice).toBe('capture');
        expect(taken.tune.scale).toBe(scaleFor(PLACE.width));
    });

    it('trail a walking pawn in its collection’s streams and light, as wide and as dense as a board’s', () =>
    {
        for (const collection of COLLECTIONS)
        {
            expect(trailOf(collection, 30)).toEqual({ flows: TRAILS[collection], tune: { colors: lightOf(collection), scale: 30 * TRAIL_CELLS / 40, density: TRAIL_DENSITY } });
        }
    });

    it('hit a blot, bring a checker in from the bar and bear one off as a backgammon table does', () =>
    {
        expect(momentOf('hit', 'void', PLACE)).toMatchObject({ steps: CAPTURES.void, voice: 'capture' });
        expect(momentOf('entry', 'void', PLACE)).toMatchObject({ steps: ENTRIES.void, voice: 'spawn' });
        expect(momentOf('borne', 'void', PLACE)).toMatchObject({ steps: BORNE.void, voice: 'pawn' });
        expect(momentOf('borne', 'void', PLACE).tune.scale).toBe(scaleFor(PLACE.width));
    });

    it('set a chess piece down lightly, castle, check, promote and mate as a chess table does', () =>
    {
        expect(momentOf('piece', 'oni', PLACE)).toMatchObject({ steps: [{ effect: burstOf('oni').effect, tune: LANDING }], voice: 'pawn' });
        expect(momentOf('castle', 'oni', PLACE)).toMatchObject({ steps: CASTLES.oni, voice: 'pawn' });
        expect(momentOf('check', 'oni', PLACE)).toMatchObject({ steps: CHECKS.oni, voice: null });
        expect(momentOf('capture', 'oni', PLACE)).toMatchObject({ steps: CAPTURES.oni, voice: 'capture' });
        expect(momentOf('promotion', 'oni', PLACE)).toMatchObject({ steps: CRITICALS.oni, voice: 'spawn' });

        const mated = momentOf('mate', 'oni', PLACE);

        expect(mated.steps).toEqual([...CRITICALS.oni, FINALES.oni]);
        expect(mated.voice).toBe('capture');
        expect(mated.tune.scale, 'a mate was not as wide as the board reveals it').toBe(scaleFor(PLACE.width, MATE_SQUARES));
    });

    it('play a card where it lies, and an entrance, a whole set and a win from the corner, as the tables do', () =>
    {
        expect(momentOf('card', 'phoenix', PLACE)).toEqual({ ...playAt('phoenix', PLACE), voice: 'card' });
        expect(momentOf('entrance', 'phoenix', PLACE)).toEqual({ ...enterAt({ collection: 'phoenix', full: false }, MIDDLE, PLACE.width), voice: 'spawn' });
        expect(momentOf('set', 'phoenix', PLACE)).toEqual({ ...enterAt({ collection: 'phoenix', full: true }, MIDDLE, PLACE.width), voice: 'spawn' });
        expect(momentOf('win', 'phoenix', PLACE)).toEqual({ ...cheerAt('phoenix', MIDDLE, PLACE.width), voice: 'victory' });
    });

    it('take the playground’s knobs as factors over every layer, so that at one a moment plays as its table plays it', () =>
    {
        const six = momentOf('six', 'storm', PLACE);
        const even = retune(six, { intensity: 1, speed: 1, density: 1, size: 1 });

        expect(even.steps.map((step) => step.effect)).toEqual(six.steps.map((step) => step.effect));
        expect(even.steps.map((step) => step.after)).toEqual(six.steps.map((step) => step.after));
        expect(even.tune).toEqual({ ...six.tune, intensity: 1, speed: 1, density: 1 });
        expect('seed' in even.tune, 'a seed was laid on a moment nobody asked to repeat').toBe(false);
        expect(even.voice).toBe(six.voice);

        const castle = momentOf('castle', 'jade', PLACE);
        const strong = retune(castle, { intensity: 2, speed: 0.5, density: 3, size: 1.5, seed: 7 });

        expect(strong.tune).toMatchObject({ intensity: 2, speed: 0.5, density: 3, scale: castle.tune.scale! * 1.5, seed: 7, colors: castle.tune.colors });
        expect(strong.steps[0], 'a layer of its own strength lost it beside the others').toEqual({ effect: 'sigil', tune: { intensity: 1.6, speed: 0.5, density: 3 } });
        expect(strong.steps[1]).toEqual({ effect: 'orbs', after: 200, tune: { intensity: 1.4, speed: 0.5, density: 3 } });
        expect(retune(momentOf('die', 'gold', PLACE), { intensity: 2, speed: 1, density: 1, size: 1 }).steps, 'a layer with nothing of its own was given numbers it should take from the moment').toEqual([{ effect: 'burst' }]);

        const rift = retune(momentOf('six', 'astral', PLACE), { intensity: 1, speed: 2, density: 0.5, size: 1 });

        expect(rift.steps[0], 'a layer’s own speed was thrown away').toEqual({ effect: 'rift', tune: { intensity: 1, speed: 3, density: 0.5 } });
        expect(retune(momentOf('six', 'glow', PLACE), { intensity: 1, speed: 1, density: 0.5, size: 1 }).steps[1], 'a layer’s own density was thrown away').toEqual({ effect: 'stars', after: 60, tune: { intensity: 1, speed: 1, density: 0.9 } });
    });

});
