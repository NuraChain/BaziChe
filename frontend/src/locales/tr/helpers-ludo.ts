import type { Dictionary } from '../en/index.ts';
import type { helpersLudo as reference } from '../en/helpers-ludo.ts';

export const helpersLudo: Pick<Dictionary, keyof typeof reference> = {
    'helpers.ludo.tip.yard': 'Yolda hiç piyonun yok: piyonu evden yalnızca altı çıkarır.',
    'helpers.ludo.tip.six': 'Altı geldi: bu hamleden sonra bir daha atarsın.',
    'helpers.ludo.tip.threeSixes': 'Üst üste üç altı sırayı bitirir, üçüncüsü oynanmaz.',
    'helpers.ludo.tip.star': 'Bu karedeki taş güvende. Yapabiliyorsan başka bir hamle seç.',
    'helpers.ludo.tip.blocked': 'Bu kare dolu. Yapabiliyorsan başka bir hamle seç.',
    'helpers.ludo.tip.helping': 'Dört piyonun da hedefte, artık her atışın ortağının piyonlarını oynatır. Altı yine bir atış daha getirir.',
    'helpers.ludo.tip.start': 'Bu karedeki taş güvende. Yapabiliyorsan başka bir hamle seç.',
    'helpers.ludo.tip.exact': 'Hedefe tam sayıyla girilir; bu atış için fazla yakın olan piyon yerinde kalır.'
};
