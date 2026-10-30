import type { Dictionary } from '../en/index.ts';
import type { invite as reference } from '../en/invite.ts';

export const invite: Pick<Dictionary, keyof typeof reference> = {
    'invite.join.tab': 'Únete a Baziche',
    'invite.join.title': '{name} te ha invitado a Baziche',
    'invite.join.someone': 'Un amigo te ha invitado a Baziche',
    'invite.join.lead': 'Ludo, Hokm, backgammon, póker y ajedrez con tus amigos, en vivo o por turnos.',
    'invite.join.how': 'Conecta una cartera y tu cuenta se crea al firmar.',
    'invite.join.member': 'Ya tienes una cuenta',
    'invite.join.memberLead': 'Un enlace de invitación trae cuentas nuevas, y la tuya ya está aquí.',
    'invite.join.open': 'Abrir Baziche',
    'invite.join.gone': 'Este enlace de invitación ya no funciona',
    'invite.join.goneLead': 'Quizá quien lo envió hizo uno nuevo. Aun así puedes unirte.'
};
