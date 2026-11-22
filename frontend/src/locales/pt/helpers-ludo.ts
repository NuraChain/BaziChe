import type { Dictionary } from '../en/index.ts';
import type { helpersLudo as reference } from '../en/helpers-ludo.ts';

export const helpersLudo: Pick<Dictionary, keyof typeof reference> = {
    'helpers.ludo.touch.land': 'Toque na casa marcada ou solte o peão nela.',
    'helpers.ludo.touch.pick': 'Toque ou arraste um peão para ver o percurso.',
    'helpers.ludo.tip.yard': 'Nenhum peão está na pista: só um seis tira um peão da base.',
    'helpers.ludo.tip.six': 'Um seis: depois desta jogada você joga de novo.',
    'helpers.ludo.tip.threeSixes': 'Três seis seguidos encerram a vez, e o terceiro não é jogado.',
    'helpers.ludo.tip.star': 'O peão está protegido nesta casa. Escolha outro movimento se puder.',
    'helpers.ludo.tip.blocked': 'Esta casa está ocupada. Escolha outro movimento se puder.',
    'helpers.ludo.tip.helping': 'Seus quatro peões chegaram, então agora cada jogada sua move os peões do seu parceiro. Um seis ainda dá outra jogada.',
    'helpers.ludo.tip.start': 'Tire seu peão da casa de saída antes de colocar outro em jogo.',
    'helpers.ludo.tip.exact': 'Para chegar é preciso o número exato, então um peão perto demais para esta jogada fica onde está.'
};
