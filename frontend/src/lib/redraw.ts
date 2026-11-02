/** One picture to make: its size, the ground under anything see-through, and how it is encoded. */
export interface Drawing
{
    width: number;
    height: number;
    type: string;
    quality?: number;
    ground?: string;
}

/** The part of the picture drawn, when not all of it. */
export interface Crop
{
    x: number;
    y: number;
    width: number;
    height: number;
}

interface Asked
{
    bitmap: ImageBitmap;
    crop: Crop | null;
    drawings: readonly Drawing[];
}

type Canvas = HTMLCanvasElement | OffscreenCanvas;

/** Its own text is the worker's script, so it names nothing but its arguments and what every page and worker has. */
async function drawEach(asked: Asked, canvasOf: (width: number, height: number) => Canvas, encode: (canvas: Canvas, drawing: Drawing) => Promise<Blob | null>)
{
    const made: (Blob | null)[] = [];
    const crop = asked.crop ?? { x: 0, y: 0, width: asked.bitmap.width, height: asked.bitmap.height };

    for (const drawing of asked.drawings)
    {
        const canvas = canvasOf(drawing.width, drawing.height);
        const context = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;

        if (context === null)
        {
            made.push(null);
            continue;
        }

        if (drawing.ground !== undefined)
        {
            context.fillStyle = drawing.ground;
            context.fillRect(0, 0, drawing.width, drawing.height);
        }

        context.drawImage(asked.bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, drawing.width, drawing.height);
        made.push(await encode(canvas, drawing));
    }

    return made;
}

const WORKER = `
const drawEach = ${ drawEach.toString() };

self.onmessage = async (event) =>
{
    try
    {
        self.postMessage(await drawEach(event.data, (width, height) => new OffscreenCanvas(width, height), (canvas, drawing) => canvas.convertToBlob({ type: drawing.type, quality: drawing.quality })));
    }
    catch
    {
        self.postMessage(null);
    }
    finally
    {
        event.data.bitmap.close();
    }
};
`;

const onPage = async (asked: Asked) =>
{
    try
    {
        return await drawEach(asked, (width, height) =>
        {
            const canvas = document.createElement('canvas');

            canvas.width = width;
            canvas.height = height;
            return canvas;
        }, (canvas, drawing) => new Promise((done) => (canvas as HTMLCanvasElement).toBlob(done, drawing.type, drawing.quality)));
    }
    finally
    {
        asked.bitmap.close();
    }
};

/**
 * A picture drawn again at each size asked, each encoded, in the order asked, and nothing for one
 * that could not be made. The page's own encoder (`toBlob`) works only while the page is idle and
 * waits a second for that before it works anyway, and over an open sheet the page is seldom idle: a
 * photo took two seconds to be ready to send and its thumb one more. So it is done in a worker, on
 * an `OffscreenCanvas`, and on the page only where a browser has neither. Either way the picture is
 * let go of once it is drawn.
 */
export async function redraw(bitmap: ImageBitmap, drawings: readonly Drawing[], crop: Crop | null = null): Promise<(Blob | null)[]>
{
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined')
    {
        return onPage({ bitmap, crop, drawings });
    }

    const url = URL.createObjectURL(new Blob([WORKER], { type: 'text/javascript' }));
    const worker = new Worker(url);

    try
    {
        const made = await new Promise<(Blob | null)[] | null>((done) =>
        {
            worker.onmessage = (event: MessageEvent<(Blob | null)[] | null>) => done(event.data);
            worker.onerror = () => done(null);
            worker.postMessage({ bitmap, crop, drawings }, [bitmap]);
        });

        return made ?? drawings.map(() => null);
    }
    finally
    {
        worker.terminate();
        URL.revokeObjectURL(url);
    }
}
