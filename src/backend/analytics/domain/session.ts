import { PageView } from './page-view';
import { AnalyticsEvent, AnalyticsEventType } from './analytics-event';

/**
 * Session Aggregate Root
 * Represents a single browsing session, tracking all page views,
 * events, and AB test variant assignments.
 */
export class Session {
    constructor(
        public readonly id: string,
        public readonly fingerprint: string,
        public readonly startedAt: Date,
        public lastActiveAt: Date,
        public pageViews: PageView[],
        public events: AnalyticsEvent[],
        public variantAssignments: Record<string, string>, // testId -> variantId
        public readonly locale: string,
        public readonly userAgent: string,
        public readonly referrer: string | null
    ) { }

    static create(
        id: string,
        fingerprint: string,
        locale: string,
        userAgent: string,
        referrer: string | null
    ): Session {
        const now = new Date();
        return new Session(
            id,
            fingerprint,
            now,
            now,
            [],
            [],
            {},
            locale,
            userAgent,
            referrer
        );
    }

    trackPageView(pageView: PageView): void {
        this.pageViews.push(pageView);
        this.lastActiveAt = new Date();
    }

    trackEvent(event: AnalyticsEvent): void {
        this.events.push(event);
        this.lastActiveAt = new Date();
    }

    assignVariant(testId: string, variantId: string): void {
        this.variantAssignments[testId] = variantId;
    }

    getVariant(testId: string): string | undefined {
        return this.variantAssignments[testId];
    }

    getSessionDurationMs(): number {
        return this.lastActiveAt.getTime() - this.startedAt.getTime();
    }

    getEventsByType(type: AnalyticsEventType): AnalyticsEvent[] {
        return this.events.filter(e => e.type === type);
    }

    getMaxScrollDepth(): number {
        const scrollEvents = this.getEventsByType('SCROLL_DEPTH');
        if (scrollEvents.length === 0) return 0;
        return Math.max(...scrollEvents.map(e => Number(e.metadata.depth) || 0));
    }

    getVideoWatchTimeMs(): number {
        const watchEvents = this.getEventsByType('VIDEO_WATCH_TIME');
        return watchEvents.reduce((sum, e) => sum + (Number(e.metadata.durationMs) || 0), 0);
    }
}
