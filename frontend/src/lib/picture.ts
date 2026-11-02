import { redraw } from './redraw.ts';

const SIDE = 256;
const QUALITY = 0.85;

const base64Of = (bytes: Uint8Array) =>
{
    let binary = '';
    for (const byte of bytes)
    {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
};

export async function shrinkPicture(file: Blob): Promise<{ data: string; preview: string }>
{
    const bitmap = await createImageBitmap(file);
    const side = Math.min(bitmap.width, bitmap.height);
    const square = { width: SIDE, height: SIDE, quality: QUALITY, ground: '#111827' };
    const [webp, jpeg] = await redraw(bitmap, [ { ...square, type: 'image/webp' }, { ...square, type: 'image/jpeg' } ], {
        x: (bitmap.width - side) / 2,
        y: (bitmap.height - side) / 2,
        width: side,
        height: side
    });
    const blob = webp !== null && webp.type === 'image/webp' ? webp : jpeg;

    if (blob === null)
    {
        throw new Error('This browser cannot encode a picture.');
    }

    const data = base64Of(new Uint8Array(await blob.arrayBuffer()));
    return { data, preview: `data:${ blob.type };base64,${ data }` };
}
