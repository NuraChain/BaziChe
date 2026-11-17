import { registerCatalogue } from '../stores/locale.store.ts';
import { rewards as rewardsEn } from './en/rewards.ts';
import { rewards as rewardsFa } from './fa/rewards.ts';

registerCatalogue({ en: rewardsEn, fa: rewardsFa });
