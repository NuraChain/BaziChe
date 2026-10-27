import type { ShopSlot } from './catalogue.ts';

/** The looks somebody wears away from a table, by the column a read names each one. */
export const PROFILE_LOOKS = {
    deco: 'profile.decoration',
    nameplate: 'profile.nameplate',
    theme: 'profile.theme',
    effect: 'profile.effect'
} as const satisfies Record<string, ShopSlot>;

export type ProfileLookColumn = keyof typeof PROFILE_LOOKS;

export type ProfileLooks = Record<ProfileLookColumn, string | null>;

/** The look an account chose for one slot, as a scalar sub-select over the account aliased `alias`. */
export const chosenIn = (alias: string, slot: ShopSlot) =>
    `(select e.item_id from equipped_items e where e.user_id = ${ alias }.id and e.slot = '${ slot }')`;

/** Every profile look as a column of a select over `alias`: `deco`, `nameplate`, `theme`, `effect`. */
export const profileLookColumns = (alias: string) =>
    (Object.entries(PROFILE_LOOKS) as [ProfileLookColumn, ShopSlot][]).map(([column, slot]) => `${ chosenIn(alias, slot) } as ${ column }`).join(', ');

/** Only the looks a row of a list draws: the frame round the picture and the ground behind the name. */
export const listLookColumns = (alias: string) =>
    `${ chosenIn(alias, PROFILE_LOOKS.deco) } as deco, ${ chosenIn(alias, PROFILE_LOOKS.nameplate) } as nameplate`;

/** A look the wire carries only when there is one. */
export const worn = <K extends string>(key: K, value: string | null | undefined) =>
    (value === null || value === undefined ? {} : { [key]: value }) as Partial<Record<K, string>>;
