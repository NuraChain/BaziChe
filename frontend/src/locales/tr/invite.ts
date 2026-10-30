import type { Dictionary } from '../en/index.ts';
import type { invite as reference } from '../en/invite.ts';

export const invite: Pick<Dictionary, keyof typeof reference> = {
    'invite.join.tab': 'Baziche’ye katıl',
    'invite.join.title': '{name} seni Baziche’ye davet etti',
    'invite.join.someone': 'Bir arkadaşın seni Baziche’ye davet etti',
    'invite.join.lead': 'Arkadaşlarınla Ludo, Hokm, tavla, poker ve satranç; canlı ya da sıra tabanlı.',
    'invite.join.how': 'Bir cüzdan bağla; imzaladığında hesabın oluşur.',
    'invite.join.member': 'Zaten bir hesabın var',
    'invite.join.memberLead': 'Davet bağlantısı yeni hesaplar içindir ve senin hesabın zaten burada.',
    'invite.join.open': 'Baziche’yi aç',
    'invite.join.gone': 'Bu davet bağlantısı artık çalışmıyor',
    'invite.join.goneLead': 'Gönderen yeni bir bağlantı oluşturmuş olabilir. Yine de katılabilirsin.'
};
