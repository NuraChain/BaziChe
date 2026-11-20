import type { Dictionary } from '../en/index.ts';
import type { helpersLudo as reference } from '../en/helpers-ludo.ts';

export const helpersLudo: Pick<Dictionary, keyof typeof reference> = {
    'helpers.ludo.tip.yard': 'На дорожке нет ни одной фишки: вывести фишку из загона можно только шестёркой.',
    'helpers.ludo.tip.six': 'Шестёрка: после этого хода бросаешь ещё раз.',
    'helpers.ludo.tip.threeSixes': 'Три шестёрки подряд заканчивают ход, и третья не играется.',
    'helpers.ludo.tip.star': 'На этой клетке фишка в безопасности. Если можете, выберите другой ход.',
    'helpers.ludo.tip.blocked': 'Эта клетка занята. Если можете, выберите другой ход.',
    'helpers.ludo.tip.helping': 'Все четыре твои фишки дома, так что каждый твой бросок теперь двигает фишки напарника. Шестёрка всё так же даёт ещё бросок.',
    'helpers.ludo.tip.start': 'На этой клетке фишка в безопасности. Если можете, выберите другой ход.',
    'helpers.ludo.tip.exact': 'В дом нужно прийти точным броском, так что фишка, которой этот бросок велик, остаётся на месте.'
};
