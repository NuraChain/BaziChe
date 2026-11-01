import { CAMPAIGN_MOST, MILESTONE_MOST } from '../../../backend/src/domains/admin/roles.ts';
import type { AdminCampaignInput } from '../../../backend/src/schemas.ts';
import type { MessageKey } from '../locales/en.ts';

/** A milestone as the form holds it: the number of friends as typed, and its look. */
export interface Step
{
    key: number;
    count: string;
    item: string;
}

/** A campaign as the form holds it, before it is read. */
export interface CampaignForm
{
    name: string;
    inviterItem: string | null;
    inviteeItem: string | null;
    steps: readonly Step[];
    most: string;
    review: boolean;
    startsAt: string;
    endsAt: string;
}

const NAME_MIN = 3;

export const NAME_MAX = 80;

const WHOLE = /^\d+$/;

/** A moment as a `datetime-local` field holds it, in this device's own time. */
export const localOf = (iso: string | undefined) =>
{
    if (iso === undefined)
    {
        return '';
    }

    const at = new Date(iso);
    const two = (n: number) => String(n).padStart(2, '0');

    return `${ at.getFullYear() }-${ two(at.getMonth() + 1) }-${ two(at.getDate()) }T${ two(at.getHours()) }:${ two(at.getMinutes()) }`;
};

const momentOf = (typed: string) => (typed === '' ? null : Date.parse(typed));

const inRange = (typed: string, most: number) => WHOLE.test(typed) && Number(typed) >= 1 && Number(typed) <= most;

/** Where the first thing wrong with a campaign is: one of its fields, or a milestone by its key. */
export type WrongAt = 'name' | 'looks' | 'most' | 'starts' | 'ends' | number;

/** The campaign the form holds, whole as the wire takes it, or the first thing wrong with it and where, in the server's order. */
export function checked(form: CampaignForm): { input: Omit<AdminCampaignInput, 'reason'> } | { wrong: MessageKey; at: WrongAt }
{
    const name = form.name.trim();
    const starts = momentOf(form.startsAt);
    const ends = momentOf(form.endsAt);
    const counts = form.steps.map((one) => one.count.trim());
    const most = form.most.trim();

    if (name.length < NAME_MIN || name.length > NAME_MAX)
    {
        return { wrong: 'admin.campaign.nameShort', at: 'name' };
    }

    if (form.inviterItem === null && form.inviteeItem === null && form.steps.length === 0)
    {
        return { wrong: 'admin.campaign.givesNothing', at: 'looks' };
    }

    const outside = counts.findIndex((one) => !inRange(one, MILESTONE_MOST));

    if (outside >= 0)
    {
        return { wrong: 'admin.campaign.countWrong', at: form.steps[outside].key };
    }

    const again = counts.findIndex((one, index) => counts.slice(0, index).some((before) => Number(before) === Number(one)));

    if (again >= 0)
    {
        return { wrong: 'admin.campaign.sameCount', at: form.steps[again].key };
    }

    if (most !== '' && !inRange(most, CAMPAIGN_MOST))
    {
        return { wrong: 'admin.campaign.mostWrong', at: 'most' };
    }

    if (Number.isNaN(starts) || Number.isNaN(ends) || (starts !== null && ends !== null && ends <= starts))
    {
        return { wrong: 'admin.campaign.windowWrong', at: Number.isNaN(starts) ? 'starts' : 'ends' };
    }

    return {
        input: {
            name,
            ...(form.inviterItem === null ? {} : { inviterItem: form.inviterItem }),
            ...(form.inviteeItem === null ? {} : { inviteeItem: form.inviteeItem }),
            milestones: form.steps.map((one) => ({ count: Number(one.count.trim()), item: one.item })),
            ...(most === '' ? {} : { most: Number(most) }),
            review: form.review,
            ...(starts === null ? {} : { startsAt: new Date(starts).toISOString() }),
            ...(ends === null ? {} : { endsAt: new Date(ends).toISOString() })
        }
    };
}
