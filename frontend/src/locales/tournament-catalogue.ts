import { registerCatalogue } from '../stores/locale.store.ts';
import { tournament as tournamentEn } from './en/tournament.ts';
import { tournament as tournamentFa } from './fa/tournament.ts';

registerCatalogue({ en: tournamentEn, fa: tournamentFa });
