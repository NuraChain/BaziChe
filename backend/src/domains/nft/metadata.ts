import { tokenIdOf, tokenPathOf } from '../../chain/minting.ts';
import { RUNGS } from '../achieve/families.ts';
import { COLLECTION_BLURBS, COLLECTION_NAMES, LOOKS, type ShopKind, type ShopLook } from '../shop/catalogue.ts';
import type { Rung } from '../achieve/ladders.ts';
import { LEGENDARY } from './service.ts';

/**
 * What a wallet or an explorer shows of a token: ERC-1155 metadata JSON under the contracts' `{id}`
 * templates, `/api/nft/looks/{id}.json` and `/api/nft/achievements/{id}.json`, `{id}` the token's
 * id as 64 lower-case hex digits. Read by strangers' software, so it is in English, holds nothing
 * about who owns a token, and names only what the catalogue and the ladders already say in public.
 */

const KIND_NAMES: Record<ShopKind, string> = {
    decoration: 'Avatar Decoration',
    effect: 'Profile Effect',
    theme: 'Profile Theme',
    nameplate: 'Nameplate',
    dice: 'Dice',
    pawns: 'Pawns',
    yard: 'Ludo Yard',
    back: 'Card Back',
    face: 'Card Faces',
    felt: 'Table Felt',
    chips: 'Poker Chips',
    checkers: 'Checkers',
    home: 'Home Board',
    pieces: 'Chess Set',
    celebration: 'Celebration'
};

const TITLE = (word: string) => `${ word.charAt(0).toUpperCase() }${ word.slice(1) }`;

const LOOK_BY_PATH = new Map<string, ShopLook>(LOOKS.map((look) => [tokenPathOf(tokenIdOf(look.id)), look]));

const LEGENDS = new Set(LEGENDARY);

/** Only the legendary rungs are minted, so only they have metadata: anything else is not a token. */
const RUNG_BY_PATH = new Map<string, Rung>(RUNGS.filter((rung) => LEGENDS.has(rung.id)).map((rung) => [tokenPathOf(tokenIdOf(rung.id)), rung]));

const TOKEN_PATH = /^[0-9a-f]{64}$/;

export interface NftMetadata
{
    name: string;
    description: string;
    image: string;
    external_url: string;
    attributes: { trait_type: string; value: string }[];
}

export function lookMetadata(origin: string, path: string): NftMetadata | null
{
    const look = TOKEN_PATH.test(path) ? LOOK_BY_PATH.get(path) : undefined;

    if (look === undefined)
    {
        return null;
    }

    return {
        name: `${ COLLECTION_NAMES[look.collection].en } ${ KIND_NAMES[look.kind] }`,
        description: `${ COLLECTION_BLURBS[look.collection].en } A look from the Baziche shop, soulbound to the wallet of whoever owns it.`,
        image: `${ origin }/looks/${ look.id }.svg`,
        external_url: `${ origin }/app/shop`,
        attributes: [
            { trait_type: 'Kind', value: KIND_NAMES[look.kind] },
            { trait_type: 'Collection', value: COLLECTION_NAMES[look.collection].en },
            { trait_type: 'Tier', value: TITLE(look.tier) }
        ]
    };
}

export function achievementMetadata(origin: string, path: string): NftMetadata | null
{
    const rung = TOKEN_PATH.test(path) ? RUNG_BY_PATH.get(path) : undefined;

    if (rung === undefined)
    {
        return null;
    }

    return {
        name: rung.nameEn,
        description: `${ rung.blurbEn } A legendary achievement on Baziche, soulbound to the wallet of whoever earned it.`,
        image: `${ origin }/api/nft/achievements/${ path }.svg`,
        external_url: `${ origin }/app/games`,
        attributes: [
            { trait_type: 'Game', value: rung.game === null ? 'Every game' : TITLE(rung.game) },
            { trait_type: 'Tier', value: TITLE(rung.tier) },
            { trait_type: 'Rarity', value: 'Legendary' },
            { trait_type: 'Step', value: String(rung.step) }
        ]
    };
}

const TIER_COLOURS: Record<Rung['tier'], [string, string]> = {
    bronze: ['#7a4a24', '#d7965c'],
    silver: ['#5d6873', '#d9e0e6'],
    gold: ['#8a6410', '#f2cd5c'],
    platinum: ['#3d5b6e', '#bfe3f2'],
    diamond: ['#3b2f7a', '#b7a6ff']
};

const escaped = (text: string) => text.replace(/[&<>"']/g, (one) => `&#${ one.charCodeAt(0) };`);

/**
 * The medal a legendary achievement is drawn as: achievements have no picture of their own, so its
 * tier's colours, a ring, its step and its name. Text only from the ladders, escaped all the same.
 */
export function achievementMedal(path: string): string | null
{
    const rung = TOKEN_PATH.test(path) ? RUNG_BY_PATH.get(path) : undefined;

    if (rung === undefined)
    {
        return null;
    }

    const [deep, bright] = TIER_COLOURS[rung.tier];
    const game = rung.game === null ? 'EVERY GAME' : rung.game.toUpperCase();

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">`
        + `<defs><radialGradient id="g" cx="50%" cy="38%" r="65%"><stop offset="0" stop-color="${ bright }"/><stop offset="1" stop-color="${ deep }"/></radialGradient></defs>`
        + `<rect width="512" height="512" fill="#0b1020"/>`
        + `<circle cx="256" cy="226" r="170" fill="url(#g)"/>`
        + `<circle cx="256" cy="226" r="148" fill="none" stroke="#0b1020" stroke-opacity=".35" stroke-width="6"/>`
        + `<circle cx="256" cy="226" r="186" fill="none" stroke="${ bright }" stroke-width="4" stroke-dasharray="6 10"/>`
        + `<text x="256" y="250" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="96" font-weight="800" fill="#0b1020">${ rung.step }</text>`
        + `<text x="256" y="300" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="22" font-weight="700" letter-spacing="6" fill="#0b1020">LEGENDARY</text>`
        + `<text x="256" y="446" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="30" font-weight="700" fill="#ffffff">${ escaped(rung.nameEn) }</text>`
        + `<text x="256" y="484" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="18" letter-spacing="4" fill="${ bright }">${ escaped(game) }</text>`
        + `</svg>`;
}
