import type { Dictionary } from '../en/index.ts';
import type { helpersLudo as reference } from '../en/helpers-ludo.ts';

export const helpersLudo: Pick<Dictionary, keyof typeof reference> = {
    'helpers.ludo.touch.land': '轻点标记的目标格。',
    'helpers.ludo.touch.pick': '轻点棋子以预览走法。',
    'helpers.ludo.tip.yard': '跑道上还没有你的棋子：只有掷出六点才能从基地出一枚。',
    'helpers.ludo.tip.six': '六点：走完这一步你再掷一次。',
    'helpers.ludo.tip.threeSixes': '连续三次六点会结束这一回合，第三次不走。',
    'helpers.ludo.tip.star': '这枚棋子在此格受到保护。如果可以，请选择其他走法。',
    'helpers.ludo.tip.blocked': '此格已有棋子。如果可以，请选择其他走法。',
    'helpers.ludo.tip.helping': '你的四枚棋子都到家了，现在你每次掷骰都走队友的棋子。掷出六点照样再掷一次。',
    'helpers.ludo.tip.start': '先把自己的棋子移出起点，再让另一枚棋子出场。',
    'helpers.ludo.tip.exact': '进家要点数刚好，离得太近、这次点数过大的棋子只能原地不动。'
};
