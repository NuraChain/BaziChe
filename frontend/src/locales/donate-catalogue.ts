import { registerCatalogue } from '../stores/locale.store.ts';
import { donate as donateEn } from './en/donate.ts';
import { donate as donateFa } from './fa/donate.ts';

registerCatalogue({ en: donateEn, fa: donateFa });
