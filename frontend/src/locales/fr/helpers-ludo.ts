import type { Dictionary } from '../en/index.ts';
import type { helpersLudo as reference } from '../en/helpers-ludo.ts';

export const helpersLudo: Pick<Dictionary, keyof typeof reference> = {
    'helpers.ludo.touch.land': 'Touchez la case marquée ou déposez-y le pion.',
    'helpers.ludo.touch.pick': 'Touchez ou faites glisser un pion pour voir son trajet.',
    'helpers.ludo.tip.yard': 'Aucun pion n’est sur le parcours : seul un six en fait sortir un de l’écurie.',
    'helpers.ludo.tip.six': 'Un six : après ce coup, tu relances.',
    'helpers.ludo.tip.threeSixes': 'Trois six d’affilée terminent le tour, et le troisième n’est pas joué.',
    'helpers.ludo.tip.star': 'Le pion est à l’abri sur cette case. Choisis un autre déplacement si tu peux.',
    'helpers.ludo.tip.blocked': 'Cette case est occupée. Choisis un autre déplacement si tu peux.',
    'helpers.ludo.tip.helping': 'Tes quatre pions sont arrivés : chacun de tes lancers fait désormais avancer les pions de ton partenaire. Un six fait toujours rejouer.',
    'helpers.ludo.tip.start': 'Déplace ton pion hors de la case de départ avant d’en sortir un autre.',
    'helpers.ludo.tip.exact': 'Pour arriver, il faut le compte exact : un pion trop proche pour ce lancer reste où il est.'
};
