import { describe, expect, it } from 'vitest';
import { createResource, createRoot } from 'azerothjs';

import { newestRead } from '../src/lib/newest-read.ts';

async function settle()
{
    for (let turn = 0; turn < 12; turn += 1)
    {
        await Promise.resolve();
    }
}

/** A resource whose every read waits for the spec to answer it, in whatever order the spec chooses. */
function answeredByHand()
{
    const answers: ((value: string) => void)[] = [];
    let asked = 0;

    const resource = createRoot(() => createResource(() => new Promise<string>((resolve) =>
    {
        asked += 1;
        const read = asked;

        answers.push((value) => resolve(`${ value } (read ${ read })`));
    })));

    return { resource, answer: (index: number, value: string) => answers[index](value), asked: () => asked };
}

describe('the newest read of a resource', () =>
{
    it('settles with the answer of its own read when nothing else asked meanwhile', async () =>
    {
        const { resource, answer } = answeredByHand();
        const read = newestRead(resource);

        await settle();
        answer(0, 'first');
        await settle();

        let settled = false;
        const reading = read().then(() =>
        {
            settled = true;
        });

        await settle();
        expect(settled).toBe(false);

        answer(1, 'after the change');
        await reading;

        expect(resource.data()).toBe('after the change (read 2)');
    });

    it('settles only once a later read that replaced it has answered, never with the answer from before', async () =>
    {
        const { resource, answer, asked } = answeredByHand();
        const read = newestRead(resource);

        await settle();
        answer(0, 'before the change');
        await settle();

        let settled = false;
        const afterTheChange = read().then(() =>
        {
            settled = true;
        });

        await settle();
        const ring = read();

        await settle();
        expect(asked()).toBe(3);

        answer(1, 'replaced');
        await settle();

        expect(settled, 'the read that replaced it is still out').toBe(false);
        expect(resource.data()).toBe('before the change (read 1)');

        answer(2, 'after the change');
        await afterTheChange;
        await ring;

        expect(resource.data()).toBe('after the change (read 3)');
    });

    it('settles when its read fails, as the framework\'s own does', async () =>
    {
        let refused = false;
        const resource = createRoot(() => createResource(async () =>
        {
            if (refused)
            {
                throw new Error('refused');
            }

            return 'held';
        }));
        const read = newestRead(resource);

        await settle();
        refused = true;
        await read();

        expect(resource.error()).toBeInstanceOf(Error);
        expect(resource.data()).toBe('held');
    });
});
