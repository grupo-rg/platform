'use server';

import { AnalyticsEventType } from '@/backend/analytics/domain/analytics-event';
import { FirestoreSessionRepository, FirestoreABTestRepository } from '@/backend/analytics/infrastructure/firestore-analytics-repository';
import { TrackEventUseCase, TrackPageViewUseCase } from '@/backend/analytics/application/track-event-use-case';
import { AssignABVariantUseCase } from '@/backend/analytics/application/assign-ab-variant-use-case';

const sessionRepo = new FirestoreSessionRepository();
const abTestRepo = new FirestoreABTestRepository();

/**
 * Track a page view
 */
export async function trackPageViewAction(params: {
    sessionId: string;
    fingerprint: string;
    path: string;
    referrer: string | null;
    locale: string;
    userAgent: string;
    variantId?: string;
}): Promise<void> {
    const useCase = new TrackPageViewUseCase(sessionRepo);
    await useCase.execute(params);
}

/**
 * Track a discrete analytics event
 */
export async function trackEventAction(params: {
    sessionId: string;
    fingerprint: string;
    eventType: AnalyticsEventType;
    metadata: Record<string, string | number | boolean>;
    locale: string;
    userAgent: string;
    referrer?: string | null;
}): Promise<void> {
    const useCase = new TrackEventUseCase(sessionRepo);
    await useCase.execute({
        ...params,
        referrer: params.referrer ?? null
    });
}

/**
 * Get or assign an AB test variant for the current session.
 * Returns null if the test doesn't exist or is inactive.
 */
export async function getABVariantAction(params: {
    sessionId: string;
    fingerprint: string;
    testId: string;
    locale: string;
    userAgent: string;
}): Promise<{ variantId: string; variantName: string; content: Record<string, string> } | null> {
    const useCase = new AssignABVariantUseCase(sessionRepo, abTestRepo);
    return useCase.execute(params);
}
