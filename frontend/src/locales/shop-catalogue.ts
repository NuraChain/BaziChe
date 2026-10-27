import { registerCatalogue } from '../stores/locale.store.ts';
import { shop as shopEn } from './en/shop.ts';
import { shop as shopFa } from './fa/shop.ts';

registerCatalogue({ en: shopEn, fa: shopFa });
