import { Session } from './session';
import { ABTest } from './ab-test';

/**
 * Session Repository Port
 */
export interface SessionRepository {
    save(session: Session): Promise<void>;
    findById(id: string): Promise<Session | null>;
    findByFingerprint(fingerprint: string): Promise<Session | null>;
    findRecent(limit: number): Promise<Session[]>;
}

/**
 * ABTest Repository Port
 */
export interface ABTestRepository {
    save(test: ABTest): Promise<void>;
    findById(id: string): Promise<ABTest | null>;
    findActive(): Promise<ABTest[]>;
}

/**
 * Analytics Aggregation DTOs
 */
export interface AnalyticsSummary {
    totalSessions: number;
    totalPageViews: number;
    avgSessionDurationMs: number;
    avgScrollDepth: number;
    videoPlayCount: number;
    avgVideoWatchTimeMs: number;
    ctaClickCounts: Record<string, number>;
    topPages: { path: string; views: number }[];
}

export interface ABTestResult {
    testId: string;
    testName: string;
    variants: {
        variantId: string;
        variantName: string;
        impressions: number;
        conversions: number;
        conversionRate: number;
    }[];
    isSignificant: boolean;
    winningVariantId: string | null;
}
