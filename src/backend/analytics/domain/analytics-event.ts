/**
 * Analytics Event Types
 */
export type AnalyticsEventType =
    | 'VIDEO_PLAY'
    | 'VIDEO_PAUSE'
    | 'VIDEO_WATCH_TIME'
    | 'CTA_CLICK'
    | 'SCROLL_DEPTH'
    | 'WIZARD_START'
    | 'WIZARD_COMPLETE'
    | 'POPUP_SHOWN'
    | 'POPUP_DISMISSED'
    | 'AGENDA_BOOKED'
    | 'MODAL_OPENED'
    | 'PAGE_EXIT';

/**
 * AnalyticsEvent Value Object
 * Represents a discrete user interaction to be tracked.
 */
export interface AnalyticsEvent {
    id: string;
    sessionId: string;
    type: AnalyticsEventType;
    metadata: Record<string, string | number | boolean>;
    timestamp: Date;
}
