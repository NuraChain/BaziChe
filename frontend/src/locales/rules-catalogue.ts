import { registerCatalogue } from '../stores/locale.store.ts';
import { rules as rulesEn } from './en/rules.ts';
import { rules as rulesFa } from './fa/rules.ts';

registerCatalogue({ en: rulesEn, fa: rulesFa });
