import type { Dictionary } from '../en/index.ts';
import type { invite as reference } from '../en/invite.ts';

export const invite: Pick<Dictionary, keyof typeof reference> = {
    'invite.join.tab': 'बाज़ीचे से जुड़ें',
    'invite.join.title': '{name} ने आपको बाज़ीचे पर बुलाया है',
    'invite.join.someone': 'एक दोस्त ने आपको बाज़ीचे पर बुलाया है',
    'invite.join.lead': 'दोस्तों के साथ लूडो, हुक्म, बैकगैमन, पोकर और शतरंज, लाइव या बारी-बारी से।',
    'invite.join.how': 'एक वॉलेट जोड़ें, और साइन करते ही आपका खाता बन जाएगा।',
    'invite.join.member': 'आपका खाता पहले से है',
    'invite.join.memberLead': 'न्योते का लिंक नए खातों के लिए है, और आपका खाता पहले से यहाँ है।',
    'invite.join.open': 'बाज़ीचे खोलें',
    'invite.join.gone': 'यह न्योते का लिंक अब काम नहीं करता',
    'invite.join.goneLead': 'शायद भेजने वाले ने नया लिंक बनाया है। आप फिर भी जुड़ सकते हैं।'
};
