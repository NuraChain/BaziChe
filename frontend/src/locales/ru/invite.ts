import type { Dictionary } from '../en/index.ts';
import type { invite as reference } from '../en/invite.ts';

export const invite: Pick<Dictionary, keyof typeof reference> = {
    'invite.join.tab': 'Присоединиться к Baziche',
    'invite.join.title': '{name} приглашает вас в Baziche',
    'invite.join.someone': 'Друг приглашает вас в Baziche',
    'invite.join.lead': 'Лудо, хокм, нарды, покер и шахматы с друзьями — вживую или по ходам.',
    'invite.join.how': 'Подключите кошелёк, и аккаунт будет создан при подписи.',
    'invite.join.member': 'У вас уже есть аккаунт',
    'invite.join.memberLead': 'Ссылка-приглашение приводит новые аккаунты, а ваш уже здесь.',
    'invite.join.open': 'Открыть Baziche',
    'invite.join.gone': 'Эта ссылка-приглашение больше не работает',
    'invite.join.goneLead': 'Возможно, отправитель создал новую. Присоединиться всё равно можно.'
};
