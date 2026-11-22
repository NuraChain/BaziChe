import type { Dictionary } from '../en/index.ts';
import type { helpersLudo as reference } from '../en/helpers-ludo.ts';

export const helpersLudo: Pick<Dictionary, keyof typeof reference> = {
    'helpers.ludo.touch.land': 'المس خانة الوصول المحددة.',
    'helpers.ludo.touch.pick': 'المس قطعة لمعاينة حركتها.',
    'helpers.ludo.tip.yard': 'لا قطعة لك على المسار: وحدها الستة تُخرج قطعة من القاعدة.',
    'helpers.ludo.tip.six': 'ستة: بعد هذه الحركة ترمي مرة أخرى.',
    'helpers.ludo.tip.threeSixes': 'ثلاث ستات متتالية تنهي الدور، والثالثة لا تُلعب.',
    'helpers.ludo.tip.star': 'القطعة آمنة على هذا المربع. اختر حركة أخرى إن أمكن.',
    'helpers.ludo.tip.blocked': 'هذا المربع مشغول. اختر حركة أخرى إن أمكن.',
    'helpers.ludo.tip.helping': 'قطعك الأربع وصلت إلى البيت، فكل رمية لك الآن تحرّك قطع شريكك. والستة ما زالت تمنحك رمية أخرى.',
    'helpers.ludo.tip.start': 'حرّك قطعتك عن مربع البداية قبل إخراج قطعة أخرى.',
    'helpers.ludo.tip.exact': 'الوصول إلى البيت يحتاج العدد بالضبط، فالقطعة الأقرب من هذه الرمية تبقى مكانها.'
};
