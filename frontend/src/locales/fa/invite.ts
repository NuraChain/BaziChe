import type { Dictionary } from '../en/index.ts';
import type { invite as reference } from '../en/invite.ts';

export const invite: Pick<Dictionary, keyof typeof reference> = {
    'invite.join.tab': 'بیا توی بازیچه',
    'invite.join.title': '{name} دعوتت کرده به بازیچه',
    'invite.join.someone': 'یکی از دوستات دعوتت کرده به بازیچه',
    'invite.join.lead': 'منچ، حکم، تخته‌نرد، پوکر و شطرنج با دوستات، زنده یا نوبتی.',
    'invite.join.how': 'کیف پولت رو وصل کن؛ همون موقع که امضا می‌کنه، حسابت ساخته می‌شه.',
    'invite.join.member': 'تو از قبل حساب داری',
    'invite.join.memberLead': 'لینک دعوت واسه حساب‌های تازه‌ست، حساب تو که از قبل اینجاست.',
    'invite.join.open': 'برو توی بازیچه',
    'invite.join.gone': 'این لینک دعوت دیگه کار نمی‌کنه',
    'invite.join.goneLead': 'شاید کسی که فرستاده یه لینک تازه ساخته. تو ولی هنوزم می‌تونی بیای.'
};
