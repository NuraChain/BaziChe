import { describe, expect, it } from 'vitest';

import { checked, localOf, NAME_MAX, type CampaignForm } from '../src/lib/campaign-form.ts';

const form = (change: Partial<CampaignForm> = {}): CampaignForm => ({
    name: 'Spring friends',
    inviterItem: 'dice.storm',
    inviteeItem: null,
    steps: [],
    most: '',
    review: false,
    startsAt: '',
    endsAt: '',
    ...change
});

const step = (key: number, count: string, item = 'nameplate.glow') => ({ key, count, item });

describe('a campaign as the form holds it', () =>
{
    it('reads into the campaign the wire takes, a look, a limit and an end left out where none is chosen', () =>
    {
        expect(checked(form())).toEqual({ input: { name: 'Spring friends', inviterItem: 'dice.storm', milestones: [], review: false } });
    });

    it('reads every part that is chosen: both looks, the milestones as typed, the most, every reward waiting and the window', () =>
    {
        const startsAt = localOf('2026-11-01T08:00:00.000Z');
        const endsAt = localOf('2026-11-08T08:00:00.000Z');

        expect(checked(form({
            name: '  Spring friends  ',
            inviteeItem: 'pawns.jade',
            steps: [step(1, ' 10 ', 'decoration.void'), step(2, '3')],
            most: ' 4 ',
            review: true,
            startsAt,
            endsAt
        }))).toEqual({
            input: {
                name: 'Spring friends',
                inviterItem: 'dice.storm',
                inviteeItem: 'pawns.jade',
                milestones: [{ count: 10, item: 'decoration.void' }, { count: 3, item: 'nameplate.glow' }],
                most: 4,
                review: true,
                startsAt: '2026-11-01T08:00:00.000Z',
                endsAt: '2026-11-08T08:00:00.000Z'
            }
        });
    });

    it('takes a milestone alone as something given', () =>
    {
        expect(checked(form({ inviterItem: null, steps: [step(1, '5')] }))).toEqual({ input: { name: 'Spring friends', milestones: [{ count: 5, item: 'nameplate.glow' }], review: false } });
    });

    it('says the first thing wrong, in the order the server asks', () =>
    {
        expect(checked(form({ name: ' ab ' }))).toEqual({ wrong: 'admin.campaign.nameShort' });
        expect(checked(form({ name: 'a'.repeat(NAME_MAX + 1) }))).toEqual({ wrong: 'admin.campaign.nameShort' });
        expect(checked(form({ name: 'a'.repeat(NAME_MAX) }))).toHaveProperty('input');
        expect(checked(form({ name: 'ab', inviterItem: null }))).toEqual({ wrong: 'admin.campaign.nameShort' });
        expect(checked(form({ inviterItem: null }))).toEqual({ wrong: 'admin.campaign.givesNothing' });

        for (const count of ['', '0', '1001', '2.5', '-3', 'ten'])
        {
            expect(checked(form({ steps: [step(1, count)] }))).toEqual({ wrong: 'admin.campaign.countWrong' });
        }

        expect(checked(form({ steps: [step(1, '1000')] }))).toHaveProperty('input');
        expect(checked(form({ steps: [step(1, '5'), step(2, '05')] }))).toEqual({ wrong: 'admin.campaign.sameCount' });

        for (const most of ['0', '1001', '1.5', 'some'])
        {
            expect(checked(form({ most }))).toEqual({ wrong: 'admin.campaign.mostWrong' });
        }

        expect(checked(form({ most: '1000' }))).toHaveProperty('input');
        expect(checked(form({ startsAt: localOf('2026-11-08T08:00:00.000Z'), endsAt: localOf('2026-11-01T08:00:00.000Z') }))).toEqual({ wrong: 'admin.campaign.windowWrong' });
        expect(checked(form({ startsAt: localOf('2026-11-08T08:00:00.000Z'), endsAt: localOf('2026-11-08T08:00:00.000Z') }))).toEqual({ wrong: 'admin.campaign.windowWrong' });
        expect(checked(form({ startsAt: 'soon' }))).toEqual({ wrong: 'admin.campaign.windowWrong' });
    });

    it('takes a start alone and an end alone', () =>
    {
        expect(checked(form({ startsAt: localOf('2026-11-01T08:00:00.000Z') }))).toEqual({ input: { name: 'Spring friends', inviterItem: 'dice.storm', milestones: [], review: false, startsAt: '2026-11-01T08:00:00.000Z' } });
        expect(checked(form({ endsAt: localOf('2026-11-01T08:00:00.000Z') }))).toEqual({ input: { name: 'Spring friends', inviterItem: 'dice.storm', milestones: [], review: false, endsAt: '2026-11-01T08:00:00.000Z' } });
    });
});

describe('a moment as a field holds it', () =>
{
    it('is nothing for no moment, and the minute in this device\'s own time otherwise, read back as the same moment', () =>
    {
        const at = new Date('2026-11-01T08:05:00.000Z');
        const two = (n: number) => String(n).padStart(2, '0');

        expect(localOf(undefined)).toBe('');
        expect(localOf(at.toISOString())).toBe(`${ at.getFullYear() }-${ two(at.getMonth() + 1) }-${ two(at.getDate()) }T${ two(at.getHours()) }:${ two(at.getMinutes()) }`);
        expect(new Date(localOf(at.toISOString())).toISOString()).toBe(at.toISOString());
    });
});
