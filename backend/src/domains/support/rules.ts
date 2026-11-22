export const SUPPORT_STATES = ['open', 'answered', 'closed'] as const;

export type SupportStatus = (typeof SUPPORT_STATES)[number];

export const SUPPORT_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const SUBJECT_LIMIT = 120;
export const BODY_LIMIT = 4000;
export const TICKETS_PER_PAGE = 30;
export const MESSAGES_PER_PAGE = 50;
