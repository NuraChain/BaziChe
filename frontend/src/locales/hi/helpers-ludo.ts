import type { Dictionary } from '../en/index.ts';
import type { helpersLudo as reference } from '../en/helpers-ludo.ts';

export const helpersLudo: Pick<Dictionary, keyof typeof reference> = {
    'helpers.ludo.touch.land': 'चिह्नित खाने को छुएँ या गोटी वहीं छोड़ें।',
    'helpers.ludo.touch.pick': 'चाल देखने के लिए गोटी को छुएँ या खींचें।',
    'helpers.ludo.tip.yard': 'ट्रैक पर कोई गोटी नहीं है: सिर्फ़ छक्का ही गोटी को घर से बाहर निकालता है।',
    'helpers.ludo.tip.six': 'छक्का: इस चाल के बाद तुम फिर से पासा फेंकोगे।',
    'helpers.ludo.tip.threeSixes': 'लगातार तीन छक्के बारी ख़त्म कर देते हैं, और तीसरा नहीं चला जाता।',
    'helpers.ludo.tip.star': 'इस खाने पर गोटी सुरक्षित है। हो सके तो कोई और चाल चुनें।',
    'helpers.ludo.tip.blocked': 'इस खाने पर गोटी है। हो सके तो कोई और चाल चुनें।',
    'helpers.ludo.tip.helping': 'तुम्हारी चारों गोटियाँ घर पहुँच गई हैं, तो अब तुम्हारा हर पासा पार्टनर की गोटियाँ चलाता है। छक्के पर फिर भी दोबारा पासा फेंकते हो।',
    'helpers.ludo.tip.start': 'दूसरी गोटी निकालने से पहले शुरुआती खाने से अपनी गोटी हटाएँ।',
    'helpers.ludo.tip.exact': 'घर पहुँचने के लिए ठीक उतनी ही गिनती चाहिए, इसलिए जो गोटी इस पासे के लिए बहुत क़रीब है, वह वहीं रहती है।'
};
