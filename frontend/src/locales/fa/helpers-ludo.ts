import type { Dictionary } from '../en/index.ts';
import type { helpersLudo as reference } from '../en/helpers-ludo.ts';

export const helpersLudo: Pick<Dictionary, keyof typeof reference> = {
    'helpers.ludo.touch.land': 'خانهٔ مقصد مشخص‌شده را لمس کن.',
    'helpers.ludo.touch.pick': 'برای دیدن حرکت، یک مهره را لمس کن.',
    'helpers.ludo.tip.yard': 'هیچ مهره‌ای روی مسیر نیست؛ فقط با شش یکی از خونه میاد بیرون.',
    'helpers.ludo.tip.six': 'شش آوردی؛ بعد از این حرکت دوباره تاس می‌ریزی.',
    'helpers.ludo.tip.threeSixes': 'سه تا شش پشت سر هم نوبتت رو تموم می‌کنه و شش سوم بازی نمی‌شه.',
    'helpers.ludo.tip.star': 'مهره روی این خونه امنه. اگه می‌تونی یه حرکت دیگه انتخاب کن.',
    'helpers.ludo.tip.blocked': 'این خونه پره. اگه می‌تونی یه حرکت دیگه انتخاب کن.',
    'helpers.ludo.tip.helping': 'هر چهار تا مهره‌ت رسیدن خونه، پس از این به بعد با هر تاست مهره‌های یارت رو حرکت می‌دی. شش هنوزم یه تاس دیگه داره.',
    'helpers.ludo.tip.start': 'اول مهره‌ات را از خانهٔ شروع حرکت بده تا بتوانی مهرهٔ دیگری بیرون بیاوری.',
    'helpers.ludo.tip.exact': 'واسه رسیدن به خونه عدد باید دقیق باشه، پس مهره‌ای که واسه این تاس زیادی نزدیکه سر جاش می‌مونه.'
};
