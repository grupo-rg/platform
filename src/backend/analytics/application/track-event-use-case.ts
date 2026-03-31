import { SessionRepository } from '../domain/analytics-repository';
import { Session } from '../domain/session';
import { AnalyticsEvent, AnalyticsEventType } from '../domain/analytics-event';
import { PageView } from '../domain/page-view';

/**
 * TrackEventUseCase
 * Creates or updates a session and appends an analytics event to it.
 */
export class TrackEventUseCase {
    constructor(private sessionRepo: SessionRepository) { }

    async execute(params: {
        sessionId: string;
        fingerprint: string;
        eventType: AnalyticsEventType;
        metadata: Record<string, string | number | boolean>;
        locale: string;
        userAgent: string;
        referrer: string | null;
    }): Promise<void> {
        let session = await this.sessionRepo.findById(params.sessionId);

        if (!session) {
            session = Session.create(
                params.sessionId,
                params.fingerprint,
                params.locale,
                params.userAgent,
                params.referrer
            );
        }

        const event: AnalyticsEvent = {
            id: `${params.sessionId}_${Date.now()}`,
            sessionId: params.sessionId,
            type: params.eventType,
            metadata: params.metadata,
            timestamp: new Date()
        };

        session.trackEvent(event);
        await this.sessionRepo.save(session);
    }
}

/**
 * TrackPageViewUseCase
 * Appends a page view to an existing session or creates a new one.
 */
export class TrackPageViewUseCase {
    constructor(private sessionRepo: SessionRepository) { }

    async execute(params: {
        sessionId: string;
        fingerprint: string;
        path: string;
        referrer: string | null;
        locale: string;
        userAgent: string;
        variantId?: string;
    }): Promise<void> {
        let session = await this.sessionRepo.findById(params.sessionId);

        if (!session) {
            session = Session.create(
                params.sessionId,
                params.fingerprint,
                params.locale,
                params.userAgent,
                params.referrer
            );
        }

        const pageView: PageView = {
            path: params.path,
            referrer: params.referrer,
            userAgent: params.userAgent,
            locale: params.locale,
            timestamp: new Date(),
            variantId: params.variantId
        };

        session.trackPageView(pageView);
        await this.sessionRepo.save(session);
    }
}
