import { attempt } from '../../lib/attempt.ts';
import { whyStaffRefused } from '../../lib/staff-words.ts';
import { useAdminRewards } from '../../stores/admin-rewards.store.ts';
import { useLocale } from '../../stores/locale.store.ts';
import { useOverlay } from '../../stores/overlay.store.ts';
import ReasonSheet from './reason-sheet.component.azeroth';

/** Freezes or unfreezes one player's rewards once the staff say why; true when it went through. */
export async function freezeAsked(handle: string, frozen: boolean)
{
    const locale = useLocale();
    const reason = await useOverlay().open(
        ReasonSheet,
        {
            title: locale.t(frozen ? 'admin.rewardsPage.askFreeze' : 'admin.rewardsPage.askThaw', { person: handle }),
            lead: locale.t(frozen ? 'admin.rewardsPage.freezeLead' : 'admin.rewardsPage.thawLead'),
            confirm: locale.t(frozen ? 'admin.rewardsPage.freeze' : 'admin.rewardsPage.thaw'),
            destructive: frozen
        },
        { label: locale.t('admin.section.rewards') }
    ).closed;

    if (typeof reason !== 'string')
    {
        return false;
    }

    return await attempt(useAdminRewards().freeze(handle, frozen, reason), locale.t(frozen ? 'admin.rewardsPage.doneFreeze' : 'admin.rewardsPage.doneThaw'), whyStaffRefused);
}
