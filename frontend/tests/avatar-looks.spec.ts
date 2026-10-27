import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { createSignal } from 'azerothjs';

import { SHOP_COLLECTIONS } from '../../backend/src/domains/shop/catalogue.ts';
import type { Account } from '../../backend/src/schemas.ts';
import ProfileHeader from '../src/components/social/profile-header.component.azeroth';
import Avatar, { type Facade } from '../src/components/ui/avatar.component.azeroth';
import { AURAS, FRAMES, frameOf, type Frame } from '../src/game/looks/frames.ts';
import { personFor } from '../src/stores/account.store.ts';
import '../src/locales/app-catalogue.ts';

const aura = vi.hoisted(() => ({ started: [] as [HTMLElement, string][], stopped: 0 }));

vi.mock('../src/game/looks/aura.ts', async (original) => ({
    ...(await original<typeof import('../src/game/looks/aura.ts')>()),
    glowAround: (host: HTMLElement, frame: Frame) =>
    {
        aura.started.push([host, frame]);
        return () =>
        {
            aura.stopped += 1;
        };
    }
}));

const settle = async () =>
{
    for (let turn = 0; turn < 12; turn += 1)
    {
        await Promise.resolve();
    }
};

const sara = (deco?: string): Facade & { handle: string } => ({ displayName: 'Sara', hue: 20, handle: 'sara.k', ...(deco === undefined ? {} : { deco }) });

beforeEach(() =>
{
    aura.started = [];
    aura.stopped = 0;
});

afterEach(() => cleanup());

describe('the frames a picture can wear', () =>
{
    it('are one for every collection the shop sells, each with an aura', () =>
    {
        expect([...FRAMES].sort()).toEqual([...SHOP_COLLECTIONS].sort());
        expect(Object.keys(AURAS).sort()).toEqual([...FRAMES].sort());
    });

    it('are named by a worn decoration, and by nothing else', () =>
    {
        expect(frameOf('decoration.neon')).toBe('neon');
        expect(frameOf(undefined)).toBeNull();
        expect(frameOf('')).toBeNull();
        expect(frameOf('decoration.nowhere')).toBeNull();
        expect(frameOf('dice.glow')).toBeNull();
        expect(frameOf('decoration.')).toBeNull();
    });
});

describe('a picture in its frame', () =>
{
    const root = (container: HTMLElement) => container.querySelector('[role="img"]')!;

    it('wears the frame its owner chose, and none for Classic or a look this build does not draw', () =>
    {
        for (const [deco, frame] of [['decoration.shiraz', 'shiraz'], [undefined, null], ['decoration.nowhere', null], ['nameplate.gold', null]] as const)
        {
            const { container } = renderTest(() => Avatar({ person: sara(deco) }) as HTMLElement);

            expect(root(container).getAttribute('data-deco'), String(deco)).toBe(frame);

            cleanup();
        }
    });

    it('keeps its node through a re-read, and changes its frame where it stands', async () =>
    {
        const [person, setPerson] = createSignal(sara('decoration.glow'));
        const { container } = renderTest(() => Avatar({
            get person()
            {
                return person();
            }
        }) as HTMLElement);
        const drawn = root(container);

        setPerson(sara('decoration.glow'));
        await settle();

        expect(root(container)).toBe(drawn);
        expect(drawn.getAttribute('data-deco')).toBe('glow');

        setPerson(sara('decoration.gold'));
        await settle();

        expect(root(container)).toBe(drawn);
        expect(drawn.getAttribute('data-deco')).toBe('gold');

        setPerson(sara());
        await settle();

        expect(drawn.hasAttribute('data-deco')).toBe(false);
    });

    it('is worn by the reader too, wherever their own account is drawn', () =>
    {
        const account: Account = { id: 'u-1', handle: 'dana.w', displayName: 'Dana', bio: '', hue: 12, isMinor: false, deco: 'decoration.neon', nameplate: 'nameplate.gold' };

        expect(personFor(account)).toMatchObject({ deco: 'decoration.neon', nameplate: 'nameplate.gold' });
        expect(personFor({ ...account, deco: undefined, nameplate: undefined })).not.toHaveProperty('deco');
    });
});

describe('an aura round the picture on its owner’s profile', () =>
{
    const header = (person: () => Facade & { handle: string }) => renderTest(() => ProfileHeader({
        get person()
        {
            return person();
        },
        presence: null,
        stats: []
    }) as HTMLElement).container;

    const box = (container: HTMLElement) => container.querySelector('section [role="img"]')!.parentElement!;

    it('plays round the picture’s box in the frame’s collection, and the accent ring steps aside', async () =>
    {
        const container = header(() => sara('decoration.neon'));
        await settle();

        expect(aura.started).toEqual([[box(container), 'neon']]);
        expect(box(container).className).toContain('relative');
        expect(box(container).className).not.toContain('from-accent');
    });

    it('plays nothing for somebody with no frame, who keeps the accent ring', async () =>
    {
        const container = header(() => sara());
        await settle();

        expect(aura.started).toEqual([]);
        expect(box(container).className).toContain('from-accent');
    });

    it('changes with the frame, and lets go as the profile goes', async () =>
    {
        const [person, setPerson] = createSignal(sara('decoration.glow'));
        header(person);
        await settle();

        setPerson(sara('decoration.gold'));
        await settle();

        expect(aura.started.map(([, frame]) => frame)).toEqual(['glow', 'gold']);
        expect(aura.stopped).toBe(1);

        setPerson(sara());
        await settle();

        expect(aura.stopped).toBe(2);
        expect(aura.started).toHaveLength(2);

        setPerson(sara('decoration.shiraz'));
        await settle();
        cleanup();

        expect(aura.stopped).toBe(3);
    });
});

describe('an aura on a page', () =>
{
    it('lays the engine’s canvas in its host once fetched, and takes both away when stopped', async () =>
    {
        const { glowAround } = await vi.importActual<typeof import('../src/game/looks/aura.ts')>('../src/game/looks/aura.ts');
        const picture = document.createElement('span');
        document.body.append(picture);

        const stop = glowAround(picture, 'neon');

        await vi.waitFor(() => expect(picture.querySelector('[data-aura] > canvas')).not.toBeNull());

        stop();

        expect(picture.querySelector('[data-aura]')).toBeNull();

        picture.remove();
    });
});
