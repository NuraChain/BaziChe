// The ludo pawn every look is drawn on, in a 256 square whose foot the board stands on its square
// (PAWN_BOX in game/board/ludo-board.ts): a look changes what it is made of, never where it stands.

export const INK = '#2A1E5C';

export const PAWN = {
    foot: 'cx="128" cy="203" rx="80" ry="28"',
    base: 'cx="128" cy="191" rx="80" ry="28"',
    body: 'M60 190C68 154 86 128 96 110H160C170 128 188 154 196 190C176 207 80 207 60 190Z',
    collar: 'cx="128" cy="109" rx="44" ry="15"',
    head: 'cx="128" cy="62" r="56"',
    shade: 'M162 120C174 142 184 164 188 188C178 196 168 198 158 199C156 172 154 146 150 122Z',
    lit: 'M80 184C84 160 94 140 106 124',
    crown: 'M177 35A56 56 0 0 1 152 113A52 52 0 0 0 177 35Z',
    gleam: 'M88 46A44 44 0 0 1 120 18',
    glint: 'cx="104" cy="36" rx="12" ry="8" fill="#FFFFFF" transform="rotate(-30 104 36)"',
    rim: 'M66 196C88 209 168 209 190 196'
};

/** The pawn's five shapes outlined in `stroke`, each filled as it says. */
export const outlined = ({ foot, base, body, collar, head }, stroke = INK) => [
    `<g stroke="${ stroke }" stroke-width="9" stroke-linejoin="round" stroke-linecap="round">`,
    `    <ellipse ${ PAWN.foot } fill="${ foot }"/>`,
    `    <ellipse ${ PAWN.base } fill="${ base }"/>`,
    `    <path d="${ PAWN.body }" fill="${ body }"/>`,
    `    <ellipse ${ PAWN.collar } fill="${ collar }"/>`,
    `    <circle ${ PAWN.head } fill="${ head }"/>`,
    '</g>'
].join('\n');
