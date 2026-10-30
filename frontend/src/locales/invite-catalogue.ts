import { registerCatalogue } from '../stores/locale.store.ts';
import { invite as inviteEn } from './en/invite.ts';
import { invite as inviteFa } from './fa/invite.ts';

registerCatalogue({ en: inviteEn, fa: inviteFa });
