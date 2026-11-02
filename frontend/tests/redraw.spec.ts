import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { redraw } from '../src/lib/redraw.ts';

/**
 * A picture drawn again and encoded in a worker, whose script is run here as the worker would run it,
 * with a canvas that writes down what is done to it.
 */

const done: string[] = [];

let refuse = false;

class FakeOffscreen
{
    public width: number;

    public height: number;

    constructor(width: number, height: number)
    {
        this.width = width;
        this.height = height;
    }

    public getContext()
    {
        return {
            set fillStyle(value: string)
            {
                done.push(`ground ${ value }`);
            },
            fillRect: (...at: number[]) => done.push(`fill ${ at.join(' ') }`),
            drawImage: (_picture: unknown, ...at: number[]) => done.push(`draw ${ at.join(' ') }`)
        };
    }

    public convertToBlob(options: { type: string; quality?: number })
    {
        done.push(`encode ${ this.width }x${ this.height } ${ options.type } ${ options.quality }`);

        return refuse ? Promise.reject(new Error('no')) : Promise.resolve(new Blob([ 'x' ], { type: options.type }));
    }
}

const scripts = new Map<string, Blob>();

const workers: FakeWorker[] = [];

class FakeWorker
{
    public onmessage: ((event: { data: unknown }) => void) | null = null;

    public onerror: (() => void) | null = null;

    public terminated = false;

    public handed: unknown[] = [];

    readonly #scope: { onmessage: ((event: { data: unknown }) => Promise<void>) | null; postMessage: (answer: unknown) => void } = {
        onmessage: null,
        postMessage: (answer) => this.onmessage?.({ data: answer })
    };

    readonly #ready: Promise<void>;

    constructor(url: string)
    {
        workers.push(this);
        this.#ready = scripts.get(url)!.text().then((script) =>
        {
            new Function('self', 'OffscreenCanvas', script)(this.#scope, FakeOffscreen);
        });
    }

    public postMessage(data: unknown, transfer: unknown[] = [])
    {
        this.handed = transfer;
        void this.#ready.then(() => this.#scope.onmessage?.({ data }));
    }

    public terminate()
    {
        this.terminated = true;
    }
}

const picture = () => ({ width: 1600, height: 1200, close: vi.fn() }) as unknown as ImageBitmap & { close: ReturnType<typeof vi.fn> };

beforeEach(() =>
{
    done.length = 0;
    workers.length = 0;
    refuse = false;
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('OffscreenCanvas', FakeOffscreen);
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) =>
    {
        const url = `blob:script-${ scripts.size }`;

        scripts.set(url, blob as Blob);
        return url;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});

afterEach(() =>
{
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    scripts.clear();
});

describe('a picture drawn again', () =>
{
    it('is drawn and encoded in a worker at each size asked, in order, on its ground, and let go of there', async () =>
    {
        const bitmap = picture();
        const made = await redraw(bitmap, [
            { width: 1600, height: 1200, type: 'image/jpeg', quality: 0.86, ground: '#fff' },
            { width: 40, height: 30, type: 'image/jpeg', quality: 0.6, ground: '#fff' }
        ]);

        expect(made.map((blob) => blob?.type)).toEqual([ 'image/jpeg', 'image/jpeg' ]);
        expect(done).toEqual([
            'ground #fff', 'fill 0 0 1600 1200', 'draw 0 0 1600 1200 0 0 1600 1200', 'encode 1600x1200 image/jpeg 0.86',
            'ground #fff', 'fill 0 0 40 30', 'draw 0 0 1600 1200 0 0 40 30', 'encode 40x30 image/jpeg 0.6'
        ]);
        expect(workers[0].handed, 'handed over, never copied').toEqual([ bitmap ]);
        expect(bitmap.close).toHaveBeenCalledTimes(1);
        expect(workers[0].terminated).toBe(true);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:script-0');
    });

    it('lays no ground under a picture that is see-through, and draws only the part asked for', async () =>
    {
        await redraw(picture(), [ { width: 256, height: 256, type: 'image/png' } ], { x: 200, y: 0, width: 1200, height: 1200 });

        expect(done).toEqual([ 'draw 200 0 1200 1200 0 0 256 256', 'encode 256x256 image/png undefined' ]);
    });

    it('answers nothing for any of it when the worker could not make it, and still lets go of the picture', async () =>
    {
        refuse = true;

        const bitmap = picture();

        expect(await redraw(bitmap, [ { width: 40, height: 30, type: 'image/jpeg' }, { width: 20, height: 15, type: 'image/jpeg' } ])).toEqual([ null, null ]);
        expect(bitmap.close).toHaveBeenCalledTimes(1);
        expect(workers[0].terminated).toBe(true);
    });

    it('is drawn on the page where the browser has no canvas for a worker', async () =>
    {
        vi.stubGlobal('OffscreenCanvas', undefined);

        const context = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };

        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
        vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, back, type)
        {
            back(new Blob([ `${ this.width }` ], { type }));
        });

        const bitmap = picture();
        const [ made ] = await redraw(bitmap, [ { width: 40, height: 30, type: 'image/jpeg', ground: '#111827' } ]);

        expect(workers).toHaveLength(0);
        expect(made?.type).toBe('image/jpeg');
        expect(await made?.text()).toBe('40');
        expect(context.fillStyle).toBe('#111827');
        expect(context.drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 1600, 1200, 0, 0, 40, 30);
        expect(bitmap.close).toHaveBeenCalledTimes(1);
    });
});
