import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import type { Decided, Job } from './agents.ts';

/**
 * Where decisions are made, behind one small interface so the runtime can be specced with a fake.
 *
 * The real one is a single `worker_threads` worker fed from a bounded queue, one job at a time. The
 * dev server runs the `.ts` sources and the built server runs `.dist-backend`, so the worker file is
 * named with this file's own extension rather than a fixed one.
 */
export interface Brain
{
    /** `live` is asked just before the job is handed over; a job whose match moved on is dropped then. */
    decide(job: Job, live: () => boolean): Promise<Decided>;
    stop(): Promise<void>;
}

export class Dropped extends Error
{
    constructor(why: string)
    {
        super(why);
        this.name = 'Dropped';
    }
}

/** What the pool needs of a worker, so a spec can hand it a fake one. */
export interface WorkerLike
{
    postMessage(message: unknown): void;
    on(event: 'message', listener: (message: Reply) => void): unknown;
    on(event: 'error', listener: (error: Error) => void): unknown;
    on(event: 'exit', listener: (code: number) => void): unknown;
    terminate(): Promise<number>;
    unref?(): void;
}

type Reply = { id: number; play: Decided['play']; ms: number } | { id: number; error: string };

export interface BrainOptions
{
    /** Jobs waiting at most; past it a job is refused at once and the runtime falls back. */
    queueMost?: number;

    /** How far past its own budget a job may run before the worker is ended and made again. */
    graceMs?: number;
    spawn?: () => WorkerLike;
}

export const WORKER_URL = new URL(`./worker${ extname(fileURLToPath(import.meta.url)) }`, import.meta.url);

const QUEUE_MOST = 64;

const GRACE_MS = 2_000;

const HEAP_MB = 256;

const spawnWorker = (): WorkerLike => new Worker(WORKER_URL, { resourceLimits: { maxOldGenerationSizeMb: HEAP_MB } });

interface Waiting
{
    id: number;
    job: Job;
    live: () => boolean;
    resolve: (decided: Decided) => void;
    reject: (error: Error) => void;
}

export function createWorkerBrain(options: BrainOptions = {}): Brain
{
    const queueMost = options.queueMost ?? QUEUE_MOST;
    const graceMs = options.graceMs ?? GRACE_MS;
    const spawn = options.spawn ?? spawnWorker;
    const queue: Waiting[] = [];
    let worker: WorkerLike | null = null;
    let busy: (Waiting & { timer: NodeJS.Timeout }) | null = null;
    let stopped = false;
    let next = 0;

    const settle = (outcome: { decided: Decided } | { error: Error }) =>
    {
        const done = busy;

        if (done === null)
        {
            return;
        }

        clearTimeout(done.timer);
        busy = null;

        if ('decided' in outcome)
        {
            done.resolve(outcome.decided);
        }
        else
        {
            done.reject(outcome.error);
        }

        pump();
    };

    /** A worker that died or ran away is dropped; the next job makes a new one. */
    const lose = (gone: WorkerLike, why: Error) =>
    {
        if (worker !== gone)
        {
            return;
        }

        worker = null;
        void gone.terminate().catch(() => undefined);
        settle({ error: why });
    };

    const made = () =>
    {
        const one = spawn();

        one.unref?.();
        one.on('message', (reply: Reply) =>
        {
            if (busy === null || reply.id !== busy.id)
            {
                return;
            }

            settle('error' in reply ? { error: new Error(reply.error) } : { decided: { play: reply.play, ms: reply.ms } });
        });
        one.on('error', (error: Error) => lose(one, error));
        one.on('exit', (code: number) => lose(one, new Error(`The decision worker stopped (${ code }).`)));

        return one;
    };

    function pump()
    {
        while (busy === null && queue.length > 0 && !stopped)
        {
            const waiting = queue.shift() as Waiting;

            if (!waiting.live())
            {
                waiting.reject(new Dropped('moved on'));
                continue;
            }

            const current = worker ?? made();

            worker = current;
            busy = {
                ...waiting,
                timer: setTimeout(() => lose(current, new Error('The decision ran past its time.')), waiting.job.budget + graceMs)
            };
            busy.timer.unref();
            current.postMessage({ id: waiting.id, job: waiting.job });
        }
    }

    return {
        decide: (job, live) => new Promise<Decided>((resolve, reject) =>
        {
            if (stopped)
            {
                reject(new Dropped('stopped'));

                return;
            }

            if (queue.length >= queueMost)
            {
                reject(new Error('The decision queue is full.'));

                return;
            }

            next += 1;
            queue.push({ id: next, job, live, resolve, reject });
            pump();
        }),

        stop: async () =>
        {
            stopped = true;

            for (const waiting of queue.splice(0))
            {
                waiting.reject(new Dropped('stopped'));
            }

            const gone = worker;

            worker = null;

            if (busy !== null)
            {
                clearTimeout(busy.timer);
                busy.reject(new Dropped('stopped'));
                busy = null;
            }

            await gone?.terminate().catch(() => undefined);
        }
    };
}
