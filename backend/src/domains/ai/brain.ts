import { availableParallelism } from 'node:os';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import type { Decided, Job } from './agents.ts';

/**
 * Where decisions are made, behind one small interface so the runtime can be specced with a fake.
 *
 * The real one is a small lazy pool of `worker_threads` workers fed from one bounded queue, one job
 * per worker at a time: it starts with one and adds another only while jobs are waiting, because one
 * worker cannot keep up with the strongest skill at the pool cap. The dev server runs the `.ts`
 * sources and the built server runs `.dist-backend`, so the worker file is named with this file's
 * own extension rather than a fixed one.
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

    /** Workers at most. */
    workersMost?: number;
    spawn?: () => WorkerLike;
}

export const WORKER_URL = new URL(`./worker${ extname(fileURLToPath(import.meta.url)) }`, import.meta.url);

const QUEUE_MOST = 64;

const GRACE_MS = 2_000;

const HEAP_MB = 256;

/** Two cores are left to the main thread and the database. */
export const WORKERS_MOST = Math.min(4, Math.max(1, availableParallelism() - 2));

const spawnWorker = (): WorkerLike => new Worker(WORKER_URL, { resourceLimits: { maxOldGenerationSizeMb: HEAP_MB } });

interface Waiting
{
    id: number;
    job: Job;
    live: () => boolean;
    resolve: (decided: Decided) => void;
    reject: (error: Error) => void;
}

interface Slot
{
    worker: WorkerLike;
    busy: (Waiting & { timer: NodeJS.Timeout }) | null;
}

export function createWorkerBrain(options: BrainOptions = {}): Brain
{
    const queueMost = options.queueMost ?? QUEUE_MOST;
    const graceMs = options.graceMs ?? GRACE_MS;
    const workersMost = Math.max(1, options.workersMost ?? WORKERS_MOST);
    const spawn = options.spawn ?? spawnWorker;
    const queue: Waiting[] = [];
    let slots: Slot[] = [];
    let stopped = false;
    let next = 0;

    const settle = (slot: Slot, outcome: { decided: Decided } | { error: Error }) =>
    {
        const done = slot.busy;

        if (done === null)
        {
            return;
        }

        clearTimeout(done.timer);
        slot.busy = null;

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

    /** A worker that died or ran away is dropped; a waiting job makes a new one. */
    const lose = (slot: Slot, why: Error) =>
    {
        if (!slots.includes(slot))
        {
            return;
        }

        slots = slots.filter((one) => one !== slot);
        void slot.worker.terminate().catch(() => undefined);
        settle(slot, { error: why });
    };

    const made = (): Slot =>
    {
        const one = spawn();
        const slot: Slot = { worker: one, busy: null };

        one.unref?.();
        one.on('message', (reply: Reply) =>
        {
            if (slot.busy === null || reply.id !== slot.busy.id)
            {
                return;
            }

            settle(slot, 'error' in reply ? { error: new Error(reply.error) } : { decided: { play: reply.play, ms: reply.ms } });
        });
        one.on('error', (error: Error) => lose(slot, error));
        one.on('exit', (code: number) => lose(slot, new Error(`The decision worker stopped (${ code }).`)));
        slots.push(slot);

        return slot;
    };

    function pump()
    {
        while (queue.length > 0 && !stopped)
        {
            const idle = slots.find((slot) => slot.busy === null);

            if (idle === undefined && slots.length >= workersMost)
            {
                return;
            }

            const waiting = queue.shift() as Waiting;

            if (!waiting.live())
            {
                waiting.reject(new Dropped('moved on'));
                continue;
            }

            const slot = idle ?? made();

            slot.busy = {
                ...waiting,
                timer: setTimeout(() => lose(slot, new Error('The decision ran past its time.')), waiting.job.budget + graceMs)
            };
            slot.busy.timer.unref();
            slot.worker.postMessage({ id: waiting.id, job: waiting.job });
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

            const gone = slots;

            slots = [];

            for (const slot of gone)
            {
                if (slot.busy !== null)
                {
                    clearTimeout(slot.busy.timer);
                    slot.busy.reject(new Dropped('stopped'));
                    slot.busy = null;
                }
            }

            await Promise.all(gone.map(async (slot) => await slot.worker.terminate().catch(() => undefined)));
        }
    };
}
