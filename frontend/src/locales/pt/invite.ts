import type { Dictionary } from '../en/index.ts';
import type { invite as reference } from '../en/invite.ts';

export const invite: Pick<Dictionary, keyof typeof reference> = {
    'invite.join.tab': 'Entre no Baziche',
    'invite.join.title': '{name} convidou você para o Baziche',
    'invite.join.someone': 'Um amigo convidou você para o Baziche',
    'invite.join.lead': 'Ludo, Hokm, gamão, poker e xadrez com seus amigos, ao vivo ou por turnos.',
    'invite.join.how': 'Conecte uma carteira e sua conta é criada quando ela assinar.',
    'invite.join.member': 'Você já tem uma conta',
    'invite.join.memberLead': 'Um link de convite traz contas novas, e a sua já está aqui.',
    'invite.join.open': 'Abrir o Baziche',
    'invite.join.gone': 'Este link de convite não funciona mais',
    'invite.join.goneLead': 'Talvez quem enviou tenha criado um novo. Você ainda pode entrar.'
};
