import type { MatchPlay } from '../../schemas.ts';
import type { Format } from '../match/sides.ts';
import type { Skill } from '../system/rules.ts';
import { seededRandom, type Agent } from './agent.ts';
import { backgammonAgent } from './backgammon/agent.ts';
import { chessAgent } from './chess/agent.ts';
import { hokmAgent } from './hokm/agent.ts';
import { ludoAgent } from './ludo/agent.ts';
import { pokerAgent } from './poker/agent.ts';

/** The agent that plays each game, by game id. */
export const AGENTS: Readonly<Record<string, Agent<unknown>>> = {
    chess: chessAgent as Agent<unknown>,
    backgammon: backgammonAgent as Agent<unknown>,
    ludo: ludoAgent as Agent<unknown>,
    hokm: hokmAgent as Agent<unknown>,
    poker: pokerAgent as Agent<unknown>
};

/** One decision as it crosses into the worker: plain data, so it survives a structured clone. */
export interface Job
{
    game: string;
    seat: number;
    format: Format;
    input: unknown;
    skill: Skill;
    style: number;
    seed: number;
    budget: number;
}

export interface Decided
{
    play: MatchPlay | null;
    ms: number;
}

/** Runs one job through its game's agent. `now` is the worker's own clock, in milliseconds. */
export function decideJob(job: Job, now: () => number): Decided
{
    const agent = AGENTS[job.game];

    if (agent === undefined)
    {
        throw new Error(`No agent plays ${ job.game }.`);
    }

    const began = now();
    const play = agent.decide({
        seat: job.seat,
        format: job.format,
        input: job.input,
        skill: job.skill,
        style: job.style,
        random: seededRandom(job.seed),
        spent: () => now() - began,
        budget: job.budget
    });

    return { play, ms: now() - began };
}
