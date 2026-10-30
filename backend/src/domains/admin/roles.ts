export const STAFF_ROLES = ['moderator', 'admin', 'owner'] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export const OWNER_WALLET = '0x6c1bd367efcc5f57f2812b404d83480c2af77987';

export function ownersOf(named: string)
{
    const also = named.trim().toLowerCase();

    return also === '' || also === OWNER_WALLET ? [OWNER_WALLET] : [OWNER_WALLET, also];
}

export function shownOwnersOf(named: string)
{
    const also = named.trim().toLowerCase();

    return also === '' ? [] : [also];
}

export const GRANTED_ROLES = ['moderator', 'admin'] as const;

export type GrantedRole = (typeof GRANTED_ROLES)[number];

export const ACTION_KINDS = ['grant', 'change', 'revoke', 'note', 'suspend', 'lift', 'expire', 'clear', 'sign-out', 'report', 'game', 'void', 'close', 'minor', 'notice', 'check', 'shop-item', 'shop-feature', 'shop-grant', 'shop-revoke', 'shop-refund', 'invite-campaign', 'invite-reward'] as const;

export type ActionKind = (typeof ACTION_KINDS)[number];

export const LOG_PAGE = 50;

export const SUSPEND_CATEGORIES = ['harassment', 'spam', 'cheating', 'inappropriate', 'other'] as const;

export type SuspendCategory = (typeof SUSPEND_CATEGORIES)[number];

export const SUSPEND_DAYS = [1, 7, 30] as const;

export type SuspendDays = (typeof SUSPEND_DAYS)[number];

export const CLEAR_PARTS = ['picture', 'name', 'bio'] as const;

export type ClearPart = (typeof CLEAR_PARTS)[number];

export const PEOPLE_LISTS = ['newest', 'suspended', 'minors', 'staff', 'reported'] as const;

export type PeopleList = (typeof PEOPLE_LISTS)[number];

export const PEOPLE_PAGE = 50;

export const REPORT_STATUSES = ['received', 'reviewed', 'actioned'] as const;

export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_OUTCOMES = ['reviewed', 'actioned'] as const;

export type ReportOutcome = (typeof REPORT_OUTCOMES)[number];

export const REPORT_LISTS = ['received', 'reviewed', 'actioned', 'all'] as const;

export type ReportList = (typeof REPORT_LISTS)[number];

export const REPORTS_PAGE = 50;

export const STUCK_KINDS = ['no-engine', 'no-turn', 'no-autoplay', 'refused', 'threw'] as const;

export type StuckKind = (typeof STUCK_KINDS)[number];

export const MATCH_LISTS = ['all', 'stuck'] as const;

export type MatchList = (typeof MATCH_LISTS)[number];

export const PLAY_PAGE = 50;

export const NOTICE_HOURS = [1, 6, 24, 72, 168] as const;

export type NoticeHours = (typeof NOTICE_HOURS)[number];

export const NOTICE_MAX = 200;

/** How long a sale the staff put on a look runs: an hour to thirty days. */
export const SALE_HOURS = [1, 6, 24, 72, 168, 336, 720] as const;

export type SaleHours = (typeof SALE_HOURS)[number];

export const SHOP_ORDERS_PAGE = 50;

/** Where the staff move a campaign: started (or started again), paused, or ended for good. */
export const CAMPAIGN_MOVES = ['active', 'paused', 'ended'] as const;

export type CampaignMove = (typeof CAMPAIGN_MOVES)[number];

/** What the staff decide about a reward: given or refused while it waits, or taken back once given. */
export const REWARD_MOVES = ['given', 'refused', 'taken'] as const;

export type RewardMove = (typeof REWARD_MOVES)[number];

export const REWARD_LISTS = ['review', 'given', 'refused', 'taken', 'all'] as const;

export type RewardList = (typeof REWARD_LISTS)[number];

export const INVITES_PAGE = 50;

/** A campaign's milestones: five at most, each a number of friends up to a thousand. */
export const MILESTONES_MOST = 5;

export const MILESTONE_MOST = 1000;

/** The most rewards a campaign may give one person. */
export const CAMPAIGN_MOST = 1000;

/** How many days the overview of invites shows one by one, and how many inviters it names. */
export const INVITE_DAYS = 14;

export const INVITE_TOP = 10;

export const ABILITIES = {
    overview: 'moderator',
    live: 'moderator',
    people: 'moderator',
    reports: 'moderator',
    play: 'admin',
    shop: 'admin',
    invites: 'admin',
    notice: 'admin',
    money: 'admin',
    staff: 'admin',
    log: 'admin',
    health: 'admin',
    wallet: 'owner'
} as const satisfies Record<string, StaffRole>;

export const LIVE_PAGE = 50;

export type Ability = keyof typeof ABILITIES;

const rankOf = (role: StaffRole | null) => (role === null ? -1 : STAFF_ROLES.indexOf(role));

export const may = (role: StaffRole | null, ability: Ability) => rankOf(role) >= rankOf(ABILITIES[ability]);

export const outranks = (actor: StaffRole | null, other: StaffRole | null) => actor !== null && rankOf(actor) > rankOf(other);
