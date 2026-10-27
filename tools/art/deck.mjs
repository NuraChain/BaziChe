import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { H, W, deck } from './card-parts.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'frontend', 'public', 'board');
const CX = W / 2;
const CY = H / 2;

const round = (value) => Math.round(value * 100) / 100;

function back()
{
    const star = [];

    for (let index = 0; index < 16; index += 1)
    {
        const angle = -Math.PI / 2 + index * Math.PI / 8;
        const reach = index % 2 === 0 ? (index % 4 === 0 ? 34 : 24) : 9;

        star.push(`${ round(CX + Math.cos(angle) * reach) } ${ round(CY + Math.sin(angle) * reach) }`);
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ W } ${ H }" width="${ W }" height="${ H }">
<defs>
    <linearGradient id="field" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2F5FD0"/><stop offset="0.55" stop-color="#1E3A8A"/><stop offset="1" stop-color="#15286A"/></linearGradient>
    <pattern id="weave" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0H14M0 0V14" stroke="#9CC2FF" stroke-opacity="0.28" stroke-width="1.4"/><circle cx="7" cy="7" r="1.4" fill="#9CC2FF" fill-opacity="0.3"/></pattern>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#60A5FA" stop-opacity="0.45"/><stop offset="1" stop-color="#60A5FA" stop-opacity="0"/></radialGradient>
</defs>
<rect width="${ W }" height="${ H }" fill="#F8F6F0"/>
<rect x="9" y="9" width="${ W - 18 }" height="${ H - 18 }" rx="10" fill="url(#field)"/>
<rect x="9" y="9" width="${ W - 18 }" height="${ H - 18 }" rx="10" fill="url(#weave)"/>
<rect x="17" y="17" width="${ W - 34 }" height="${ H - 34 }" rx="6" fill="none" stroke="#E3C170" stroke-opacity="0.85" stroke-width="2"/>
<rect x="22" y="22" width="${ W - 44 }" height="${ H - 44 }" rx="4" fill="none" stroke="#E3C170" stroke-opacity="0.35" stroke-width="1"/>
<circle cx="${ CX }" cy="${ CY }" r="70" fill="url(#glow)"/>
<circle cx="${ CX }" cy="${ CY }" r="48" fill="#172554" stroke="#E3C170" stroke-width="3"/>
<circle cx="${ CX }" cy="${ CY }" r="41" fill="none" stroke="#E3C170" stroke-opacity="0.5" stroke-width="1.2"/>
<polygon points="${ star.join(' ') }" fill="#E3C170" stroke="#8C6A1C" stroke-width="1"/>
<circle cx="${ CX }" cy="${ CY }" r="6" fill="#172554" stroke="#E3C170" stroke-width="2"/>
${ [[40, 40], [W - 40, 40], [40, H - 40], [W - 40, H - 40]].map(([x, y]) => `<path d="M${ x } ${ y - 8 }L${ x + 8 } ${ y }L${ x } ${ y + 8 }L${ x - 8 } ${ y }Z" fill="#E3C170" fill-opacity="0.8"/>`).join('') }
</svg>
`;
}

writeFileSync(join(OUT, 'deck.svg'), deck());
console.log('board deck.svg');
writeFileSync(join(OUT, 'card-back.svg'), back());
console.log('board card-back.svg');
