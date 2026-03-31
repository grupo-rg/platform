'use client';

import { useCallback, useEffect, useRef } from 'react';
import { trackPageViewAction, trackEventAction } from '@/actions/marketing-analytics/tracking.action';
import { AnalyticsEventType } from '@/backend/analytics/domain/analytics-event';
import { usePathname } from 'next/navigation';

/**
 * Generates a simple fingerprint from browser properties.
 * Not a UUID — just a stable-ish hash for grouping sessions.
 */
function generateFingerprint(): string {
    if (typeof window === 'undefined') return 'ssr';
    const raw = [
        navigator.userAgent,
        navigator.language,
        screen.width,
        screen.height,
        Intl.DateTimeFormat().resolvedOptions().timeZone
    ].join('|');
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
        hash = ((hash << 5) - hash) + raw.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash).toString(36);
}

function getOrCreateSessionId(): string {
    if (typeof window === 'undefined') return 'ssr';
    const key = 'basis_session_id';
    let id = sessionStorage.getItem(key);
    if (!id) {
        id = `s_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        sessionStorage.setItem(key, id);
    }
    return id;
}

/**
 * useAnalytics — lightweight client hook for tracking.
 *
 * Auto-tracks page views on route change.
 * Exposes `trackEvent()` and `trackVideoWatchTime()` for manual tracking.
 */
export function useAnalytics() {
    const pathname = usePathname();
    const sessionId = useRef<string>('');
    const fingerprint = useRef<string>('');
    const scrollTracked = useRef<Set<number>>(new Set());

    useEffect(() => {
        sessionId.current = getOrCreateSessionId();
        fingerprint.current = generateFingerprint();
    }, []);

    // Auto-track page views on route change
    useEffect(() => {
        if (!sessionId.current) return;

        trackPageViewAction({
            sessionId: sessionId.current,
            fingerprint: fingerprint.current,
            path: pathname,
            referrer: typeof document !== 'undefined' ? document.referrer : null,
            locale: typeof navigator !== 'undefined' ? navigator.language : 'es',
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : ''
        }).catch(() => { });
    }, [pathname]);

    // Auto-track scroll depth milestones
    useEffect(() => {
        const handler = () => {
            const scrollTop = window.scrollY;
            const docHeight = document.documentElement.scrollHeight - window.innerHeight;
            if (docHeight <= 0) return;
            const depth = Math.round((scrollTop / docHeight) * 100);

            const milestones = [25, 50, 75, 100];
            for (const m of milestones) {
                if (depth >= m && !scrollTracked.current.has(m)) {
                    scrollTracked.current.add(m);
                    trackEventAction({
                        sessionId: sessionId.current,
                        fingerprint: fingerprint.current,
                        eventType: 'SCROLL_DEPTH',
                        metadata: { depth: m },
                        locale: navigator.language,
                        userAgent: navigator.userAgent
                    }).catch(() => { });
                }
            }
        };

        window.addEventListener('scroll', handler, { passive: true });
        return () => window.removeEventListener('scroll', handler);
    }, []);

    const trackEvent = useCallback((type: AnalyticsEventType, metadata: Record<string, string | number | boolean> = {}) => {
        if (!sessionId.current) return;
        trackEventAction({
            sessionId: sessionId.current,
            fingerprint: fingerprint.current,
            eventType: type,
            metadata,
            locale: navigator.language,
            userAgent: navigator.userAgent
        }).catch(() => { });
    }, []);

    /**
     * Tracks cumulative video watch time.
     * Call with a video element ref — it sets up timeupdate listeners automatically.
     */
    const trackVideoWatchTime = useCallback((videoEl: HTMLVideoElement | null) => {
        if (!videoEl) return;

        let lastReportedSecond = 0;

        const onTimeUpdate = () => {
            const currentSecond = Math.floor(videoEl.currentTime);
            if (currentSecond > 0 && currentSecond % 5 === 0 && currentSecond !== lastReportedSecond) {
                lastReportedSecond = currentSecond;
                trackEvent('VIDEO_WATCH_TIME', {
                    durationMs: currentSecond * 1000,
                    videoSrc: videoEl.src.split('/').pop() ?? 'unknown'
                });
            }
        };

        videoEl.addEventListener('timeupdate', onTimeUpdate);
        videoEl.addEventListener('play', () => trackEvent('VIDEO_PLAY', { videoSrc: videoEl.src.split('/').pop() ?? 'unknown' }));
        videoEl.addEventListener('pause', () => trackEvent('VIDEO_PAUSE', { videoSrc: videoEl.src.split('/').pop() ?? 'unknown' }));

        return () => {
            videoEl.removeEventListener('timeupdate', onTimeUpdate);
        };
    }, [trackEvent]);

    return { trackEvent, trackVideoWatchTime, sessionId: sessionId.current };
}
