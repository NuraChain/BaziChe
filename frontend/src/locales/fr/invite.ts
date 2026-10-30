import type { Dictionary } from '../en/index.ts';
import type { invite as reference } from '../en/invite.ts';

export const invite: Pick<Dictionary, keyof typeof reference> = {
    'invite.join.tab': 'Rejoindre Baziche',
    'invite.join.title': '{name} vous invite sur Baziche',
    'invite.join.someone': 'Un ami vous invite sur Baziche',
    'invite.join.lead': 'Ludo, Hokm, backgammon, poker et échecs avec vos amis, en direct ou au tour par tour.',
    'invite.join.how': 'Connectez un portefeuille : votre compte est créé dès qu’il signe.',
    'invite.join.member': 'Vous avez déjà un compte',
    'invite.join.memberLead': 'Un lien d’invitation amène de nouveaux comptes, et le vôtre est déjà là.',
    'invite.join.open': 'Ouvrir Baziche',
    'invite.join.gone': 'Ce lien d’invitation ne fonctionne plus',
    'invite.join.goneLead': 'La personne qui l’a envoyé en a peut-être créé un nouveau. Vous pouvez quand même nous rejoindre.'
};
