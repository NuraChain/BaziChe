import { describe, expect, it } from 'vitest';

import { GAME_SLOTS, SHOP_SLOTS, tableSlotsOf } from '../../backend/src/domains/shop/catalogue.ts';
import { CELEBRATIONS, cheerAt } from '../src/game/looks/celebrations.ts';
import { ENTER_MOST, enterAt, entranceOf, SET_KINDS } from '../src/game/looks/entrances.ts';
import { LIGHTS } from '../src/game/looks/lights.ts';

describe('an entrance at a game’s start', () =>
{
    it('is in the look that dresses the seat’s own corner, and none for a corner in Classic or a look this build does not draw', () =>
    {
        expect(entranceOf('ludo', { yard: 'yard.inferno', dice: 'dice.jade' })).toEqual({ collection: 'inferno', full: false });
        expect(entranceOf('hokm', { felt: 'felt.storm' })).toEqual({ collection: 'storm', full: false });
        expect(entranceOf('poker', { felt: 'felt.void' })?.collection).toBe('void');
        expect(entranceOf('backgammon', { home: 'home.frost' })?.collection).toBe('frost');
        expect(entranceOf('chess', { pieces: 'pieces.jade' })?.collection).toBe('jade');
        expect(entranceOf('ludo', { dice: 'dice.jade', pawns: 'pawns.jade' }), 'a seat with no yard entered').toBeNull();
        expect(entranceOf('ludo', {}), 'Classic entered').toBeNull();
        expect(entranceOf('ludo', undefined)).toBeNull();
        expect(entranceOf('ludo', { yard: 'yard.nothing' }), 'a look this build does not draw entered').toBeNull();
        expect(entranceOf('hokm', { felt: 'yard.inferno' }), 'a look of another kind in the corner’s place entered').toBeNull();
    });

    it('is in full only when every look of that game is the corner’s collection, the celebration included', () =>
    {
        expect(entranceOf('ludo', { yard: 'yard.oni', dice: 'dice.oni', pawns: 'pawns.oni', celebration: 'celebration.oni' })).toEqual({ collection: 'oni', full: true });
        expect(entranceOf('ludo', { yard: 'yard.oni', dice: 'dice.oni', pawns: 'pawns.oni' })?.full, 'a set with no celebration was taken for whole').toBe(false);
        expect(entranceOf('ludo', { yard: 'yard.oni', dice: 'dice.oni', pawns: 'pawns.jade', celebration: 'celebration.oni' })?.full).toBe(false);
        expect(entranceOf('chess', { pieces: 'pieces.gold', celebration: 'celebration.gold' })?.full).toBe(true);
        expect(entranceOf('poker', { felt: 'felt.glow', back: 'back.glow', face: 'face.glow', celebration: 'celebration.glow' })?.full, 'poker’s set without its chips was taken for whole').toBe(false);
    });

    it('asks of every kind a game copies into its seats, the corner first, and of nothing else', () =>
    {
        expect(Object.keys(SET_KINDS).sort()).toEqual(Object.keys(GAME_SLOTS).sort());

        for (const [game, kinds] of Object.entries(SET_KINDS))
        {
            expect([...kinds].sort(), game).toEqual(tableSlotsOf(game).map((slot) => SHOP_SLOTS[slot]).sort());
        }
    });

    it('plays the first two layers of its collection’s celebration, and all of them for a set, in its light and scaled to its place', () =>
    {
        const short = enterAt({ collection: 'storm', full: false }, { x: 10, y: 20 }, 60);
        const whole = enterAt({ collection: 'storm', full: true }, { x: 10, y: 20 }, 2_000);

        expect(short.steps).toEqual(CELEBRATIONS.storm.slice(0, 2));
        expect(whole.steps).toEqual(CELEBRATIONS.storm);
        expect(short.at).toEqual({ x: 10, y: 20 });
        expect(short.tune.colors).toEqual(LIGHTS.storm);
        expect(short.tune.scale).toBeCloseTo(1.5);
        expect(whole.tune.scale, 'an entrance was drawn past the scale its bolts keep their shape at').toBe(ENTER_MOST);
        expect(ENTER_MOST, 'an entrance was drawn as large as the celebration it opens').toBeLessThan(cheerAt('storm', { x: 10, y: 20 }, 2_000).tune.scale);
    });
});
