import { checkHandle, normalizeHandle } from '../identity/handle.ts';

/**
 * Names for system players, in the shapes real players choose here: a first name common on a
 * Persian/English site, with the short tails people add when theirs is taken (`sara.m`, `amir_h7`,
 * `reza1372`). First names only, so no name is a public figure's. Pure: every choice comes from the
 * random source the caller passes, so a seed gives the same name every time.
 */

/** Latin spelling, and the Persian one a player writing in Persian would choose. */
const PERSIAN: readonly (readonly [string, string])[] = [
    ['sara', 'سارا'], ['amir', 'امیر'], ['ali', 'علی'], ['reza', 'رضا'], ['mina', 'مینا'], ['neda', 'ندا'],
    ['nima', 'نیما'], ['parsa', 'پارسا'], ['arash', 'آرش'], ['babak', 'بابک'], ['darya', 'دریا'], ['elham', 'الهام'],
    ['farhad', 'فرهاد'], ['hamed', 'حامد'], ['kian', 'کیان'], ['laleh', 'لاله'], ['mahsa', 'مهسا'], ['maryam', 'مریم'],
    ['mehdi', 'مهدی'], ['mohsen', 'محسن'], ['nazanin', 'نازنین'], ['omid', 'امید'], ['pouya', 'پویا'], ['ramin', 'رامین'],
    ['roya', 'رویا'], ['saman', 'سامان'], ['shirin', 'شیرین'], ['sina', 'سینا'], ['soheil', 'سهیل'], ['yasaman', 'یاسمن'],
    ['zahra', 'زهرا'], ['armin', 'آرمین'], ['bahar', 'بهار'], ['behnam', 'بهنام'], ['hoda', 'هدی'], ['iman', 'ایمان'],
    ['kaveh', 'کاوه'], ['leila', 'لیلا'], ['milad', 'میلاد'], ['nasrin', 'نسرین'], ['payam', 'پیام'], ['pegah', 'پگاه'],
    ['sahar', 'سحر'], ['sepideh', 'سپیده'], ['shayan', 'شایان'], ['hesam', 'حسام'], ['navid', 'نوید'], ['peyman', 'پیمان'],
    ['rozhin', 'روژین'], ['setareh', 'ستاره'], ['taraneh', 'ترانه'], ['vahid', 'وحید'], ['yasin', 'یاسین'], ['ehsan', 'احسان'],
    ['golnaz', 'گلناز'], ['hadi', 'هادی'], ['javad', 'جواد'], ['keyvan', 'کیوان'], ['mani', 'مانی'], ['negar', 'نگار'],
    ['parisa', 'پریسا'], ['raha', 'رها'], ['sadaf', 'صدف'], ['tara', 'تارا'], ['aida', 'آیدا'], ['arian', 'آرین'],
    ['dorsa', 'درسا'], ['erfan', 'عرفان'], ['farzad', 'فرزاد'], ['ghazal', 'غزل'], ['hasti', 'هستی'], ['mobin', 'مبین'],
    ['nika', 'نیکا'], ['ramtin', 'رامتین'], ['samira', 'سمیرا'], ['taha', 'طاها'], ['yalda', 'یلدا'], ['ziba', 'زیبا']
];

const ENGLISH: readonly string[] = [
    'alex', 'sam', 'max', 'leo', 'mia', 'emma', 'noah', 'liam', 'jack', 'ella', 'chris', 'dan', 'ben', 'kate',
    'anna', 'tom', 'nick', 'ryan', 'lucy', 'zoe', 'adam', 'eric', 'jay', 'ruby', 'lily', 'nina', 'oscar', 'eli'
];

const LETTERS = 'abcdefghijklmnoprstvyz';

/**
 * Words that would make a name read as the product, its staff, or a machine. A handle or display
 * name holding one as a part is never given out, whatever the lists above come to hold.
 */
const STAFF_LIKE = [
    'admin', 'staff', 'support', 'system', 'official', 'moderator', 'mod', 'team', 'help', 'baziche', 'nura',
    'bot', 'robot', 'ai', 'cpu', 'auto', 'server', 'guest', 'test', 'owner', 'root'
];

/** Whether a name has a part that reads as staff, the product, or a machine. */
export const looksStaff = (name: string) =>
{
    const folded = normalizeHandle(name);
    const parts = folded.split(/[^\p{L}]+/u).filter((part) => part !== '');

    return parts.some((part) => STAFF_LIKE.includes(part)) || STAFF_LIKE.some((word) => word.length >= 4 && folded.includes(word));
};

export interface SystemName
{
    handle: string;
    displayName: string;
    hue: number;
}

const pick = <T>(random: () => number, from: readonly T[]): T => from[Math.min(from.length - 1, Math.floor(random() * from.length))];

const digits = (random: () => number, width: number) => String(Math.floor(random() * 10 ** width)).padStart(width, '0');

const capital = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

/** The tails real players add to a taken first name, each with how often it is chosen. */
const TAILS: readonly (readonly [number, (name: string, random: () => number) => string])[] = [
    [3, (name, random) => `${ name }.${ pick(random, [...LETTERS]) }`],
    [4, (name, random) => `${ name }_${ pick(random, [...LETTERS]) }${ 1 + Math.floor(random() * 9) }`],
    [4, (name, random) => `${ name }.${ pick(random, [...LETTERS]) }${ pick(random, [...LETTERS]) }`],
    [4, (name, random) => `${ name }${ 13 }${ 60 + Math.floor(random() * 26) }`],
    [3, (name, random) => `${ name }${ pick(random, ['8', '9', '0']) }${ digits(random, 1) }`],
    [5, (name, random) => `${ name }_${ pick(random, [...LETTERS]) }${ digits(random, 2) }`],
    [4, (name, random) => `${ pick(random, [...LETTERS]) }${ name }${ digits(random, 2) }`],
    [3, (name, random) => `${ name }${ pick(random, [...LETTERS]) }${ digits(random, 3) }`]
];

const TAIL_WEIGHT = TAILS.reduce((sum, [weight]) => sum + weight, 0);

const tailOf = (random: () => number) =>
{
    let left = random() * TAIL_WEIGHT;

    for (const [weight, tail] of TAILS)
    {
        left -= weight;

        if (left < 0)
        {
            return tail;
        }
    }

    return TAILS[TAILS.length - 1][1];
};

const once = (random: () => number): SystemName =>
{
    const persian = random() < 0.75;
    const [latin, script] = persian ? pick(random, PERSIAN) : [pick(random, ENGLISH), null];
    const handle = tailOf(random)(latin, random);
    const shape = random();
    const displayName = script !== null && shape < 0.35
        ? script
        : shape < 0.6
            ? capital(latin)
            : shape < 0.8
                ? `${ capital(latin) } ${ pick(random, [...LETTERS]).toUpperCase() }.`
                : handle;

    return { handle, displayName, hue: Math.floor(random() * 360) % 360 };
};

/**
 * A name for a new system player. Every handle passes `checkHandle` and neither part reads as staff;
 * the lists cannot make one that fails, and a draw that somehow did is drawn again.
 */
export const systemNameOf = (random: () => number): SystemName =>
{
    for (let attempt = 0; attempt < 16; attempt += 1)
    {
        const name = once(random);

        if (checkHandle(name.handle) === null && !looksStaff(name.handle) && !looksStaff(name.displayName))
        {
            return name;
        }
    }

    return { handle: `${ pick(random, ENGLISH) }_${ digits(random, 4) }`, displayName: capital(pick(random, ENGLISH)), hue: Math.floor(random() * 360) % 360 };
};
