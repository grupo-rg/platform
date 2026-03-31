'use client';

import { useAnalytics } from '@/hooks/use-analytics';

/**
 * AnalyticsTracker — invisible client component that activates
 * automatic page view, scroll depth, and session tracking.
 * Mount once in the root layout.
 */
export function AnalyticsTracker() {
    useAnalytics();
    return null;
}
