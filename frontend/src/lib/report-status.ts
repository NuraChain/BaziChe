import type { ReportStatus } from '../../../backend/src/domains/admin/roles.ts';
import type { Tone } from '../components/ui/variants.ts';

/** One colour for a report's status wherever it is drawn: to whoever filed it and to the staff. */
export const REPORT_TONES: Record<ReportStatus, Tone> = {
    received: 'gold',
    reviewed: 'neutral',
    actioned: 'live'
};
