import { GAMES, type GameId } from '../../data/games.ts';
import type { Frame, Vec3 } from './path.ts';

const SUBJECT_HEIGHT = 0.15;

function anchorOf(id: GameId): Vec3
{
    return GAMES.find((game) => game.id === id)!.anchor;
}

function around(id: GameId, azimuth: number, elevation: number, distance: number, fov: number): Frame
{
    const [x, y, z] = anchorOf(id);
    const turn = (azimuth * Math.PI) / 180;
    const lift = (elevation * Math.PI) / 180;
    const target: Vec3 = [x, y + SUBJECT_HEIGHT, z];
    return {
        target,
        position: [
            target[0] + Math.sin(turn) * Math.cos(lift) * distance,
            target[1] + Math.sin(lift) * distance,
            target[2] + Math.cos(turn) * Math.cos(lift) * distance
        ],
        fov
    };
}

export const FOCUS: Record<GameId, Frame> = {
    hokm: around('hokm', -22, 39, 1.83, 32),
    poker: around('poker', 21, 31, 1.87, 32),
    backgammon: around('backgammon', -20, 48, 1.87, 32),
    ludo: around('ludo', 17, 53, 1.89, 32),
    chess: around('chess', -24, 29, 1.8, 32)
};

export const SHOTS: Record<string, Frame> = {
    arrival: { position: [-3.95, 1.76, 2.00], target: [-3.20, 0.16, 0.00], fov: 29 },
    ...FOCUS
};
