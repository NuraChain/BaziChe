import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';

import TournamentInvite from '../src/components/games/tournament-invite.component.azeroth';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import '../src/locales/tournament-catalogue.ts';
import { useChat } from '../src/stores/chat.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import { usePresence } from '../src/stores/presence.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSocial } from '../src/stores/social.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

type Rendered = HTMLElement;

beforeEach(async () =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(400_000), seed: 21 });
    server.reset();
    useLocale().setLocale('en');
    useSession().reset();
    useSession().establish({ id: 'alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 210, isMinor: false });
    useRealtime().reset();
    socket.reset();
    useRealtime().start();
    socket.accept();
    usePresence().reset();
    usePeople().reset();
    useSocial().reset();
    useChat().reset();
    useToasts().reset();
    await useSocial().refresh();
    await usePeople().want(useSocial().friends());
});

afterEach(() =>
{
    useChat().reset();
    useRealtime().reset();
    cleanup();
});

const open = (entered: string[] = []) =>
{
    const { container } = renderTest(() => TournamentInvite({ code: 'FRIDAY', name: 'Friday final', entered, overlayId: 'invite', close: () => undefined }) as Rendered);
    const invitees = () => [...container.querySelectorAll<HTMLButtonElement>('[data-invitee]')];

    return { container, invitees };
};

describe('inviting friends to a tournament', () =>
{
    it('offers every friend but the ones who have a place already', async () =>
    {
        const { invitees } = open(['sara.k']);

        await vi.waitFor(() => expect(invitees().length).toBeGreaterThan(0), { timeout: 4000 });

        const offered = invitees().map((button) => button.dataset.invitee);

        expect(offered).not.toContain('sara.k');
        expect(offered).toContain('reza.t');
        expect(offered.length).toBe(useSocial().friends().length - 1);
    });

    it('sends the link to a friend in their chat, and says it went', async () =>
    {
        const said = vi.spyOn(useChat(), 'send');
        const { invitees } = open();

        await vi.waitFor(() => expect(invitees().some((button) => button.dataset.invitee === 'reza.t')).toBe(true), { timeout: 4000 });

        invitees().find((button) => button.dataset.invitee === 'reza.t')!.click();

        await vi.waitFor(() => expect(server.calls).toContain('chat.send'), { timeout: 4000 });
        expect(server.calls).toContain('chat.direct');

        const room = server.conversations.find((row) => row.kind === 'direct' && row.members.includes('reza.t'));

        expect(room, 'no chat with the friend').toBeDefined();
        expect(said).toHaveBeenCalledWith(room!.id, expect.stringContaining(`${ location.origin }/app/tournaments/FRIDAY`));
        expect(said.mock.calls[0][1]).toContain('Friday final');
        await vi.waitFor(() => expect(invitees().find((button) => button.dataset.invitee === 'reza.t')?.disabled).toBe(true), { timeout: 4000 });
    });
});
