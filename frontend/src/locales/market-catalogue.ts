import { registerCatalogue } from '../stores/locale.store.ts';
import { market as marketEn } from './en/market.ts';
import { market as marketFa } from './fa/market.ts';

registerCatalogue({ en: marketEn, fa: marketFa });
