import { parentPort } from 'node:worker_threads';

import { decideJob, type Job } from './agents.ts';

/**
 * The thread system players think in, so a search never holds the server's event loop. It answers
 * one message with one message; the pool in `brain.ts` gives it one job at a time and ends it when
 * a job runs past its hard limit.
 */
parentPort?.on('message', (message: { id: number; job: Job }) =>
{
    try
    {
        const decided = decideJob(message.job, () => performance.now());

        parentPort?.postMessage({ id: message.id, play: decided.play, ms: decided.ms });
    }
    catch (error)
    {
        parentPort?.postMessage({ id: message.id, error: error instanceof Error ? error.message : String(error) });
    }
});
