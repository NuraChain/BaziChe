import type { Dictionary } from '../en/index.ts';
import type { helpersLudo as reference } from '../en/helpers-ludo.ts';

export const helpersLudo: Pick<Dictionary, keyof typeof reference> = {
    'helpers.ludo.tip.yard': 'No tienes ninguna ficha en el recorrido: solo un seis saca una de la base.',
    'helpers.ludo.tip.six': 'Un seis: después de esta jugada vuelves a tirar.',
    'helpers.ludo.tip.threeSixes': 'Tres seises seguidos terminan el turno, y el tercero no se juega.',
    'helpers.ludo.tip.star': 'La ficha está a salvo en esta casilla. Elige otro movimiento si puedes.',
    'helpers.ludo.tip.blocked': 'Esta casilla está ocupada. Elige otro movimiento si puedes.',
    'helpers.ludo.tip.helping': 'Tus cuatro fichas ya están en la meta, así que cada tirada tuya mueve ahora las fichas de tu compañero. Un seis sigue dando otra tirada.',
    'helpers.ludo.tip.start': 'La ficha está a salvo en esta casilla. Elige otro movimiento si puedes.',
    'helpers.ludo.tip.exact': 'Para llegar a la meta hace falta el número exacto, así que una ficha demasiado cerca para esta tirada se queda donde está.'
};
