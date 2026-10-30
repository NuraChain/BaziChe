import type { Dictionary } from '../en/index.ts';
import type { invite as reference } from '../en/invite.ts';

export const invite: Pick<Dictionary, keyof typeof reference> = {
    'invite.join.tab': 'انضم إلى بازيچه',
    'invite.join.title': '{name} دعاك إلى بازيچه',
    'invite.join.someone': 'صديق دعاك إلى بازيچه',
    'invite.join.lead': 'لودو وحكم وطاولة الزهر والبوكر والشطرنج مع أصدقائك، مباشرة أو بالأدوار.',
    'invite.join.how': 'اربط محفظة، فيُنشأ حسابك لحظة توقيعها.',
    'invite.join.member': 'لديك حساب بالفعل',
    'invite.join.memberLead': 'رابط الدعوة للحسابات الجديدة، وحسابك هنا من قبل.',
    'invite.join.open': 'افتح بازيچه',
    'invite.join.gone': 'رابط الدعوة هذا لم يعد يعمل',
    'invite.join.goneLead': 'ربما أنشأ من أرسله رابطًا جديدًا. ما زال بإمكانك الانضمام.'
};
