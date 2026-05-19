import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Sprint 1 — S1-B-01 part 4: unit tests for `getJobMetricsAction`.
 *
 * Pattern: mock `verifyAuth` (admin guard) and `adminFirestore` (the
 * `pipeline_telemetry/{jobId}/events` query surface). Resets modules
 * between tests so each describes a fresh import where mocks apply.
 */

const verifyAuthMock = vi.fn();
const finalSnapMock = vi.fn();
const partidaSnapMock = vi.fn();

vi.mock('@/backend/auth/auth.middleware', () => ({
    verifyAuth: (...args: any[]) => verifyAuthMock(...args),
}));

vi.mock('@/backend/shared/infrastructure/firebase/admin-app', () => ({
    adminFirestore: {
        collection: () => ({
            doc: () => ({
                collection: () => ({
                    where: () => ({
                        orderBy: () => ({
                            limit: (n: number) => ({
                                get: () => (n === 1 ? finalSnapMock() : partidaSnapMock()),
                            }),
                        }),
                    }),
                }),
            }),
        }),
    },
}));

function makePartidaDoc(overrides: Record<string, any> = {}) {
    return {
        data: () => ({
            type: 'partida_resolved_v2',
            timestamp: { toDate: () => new Date('2026-05-19T10:00:00Z') },
            data: {
                code: 'P-001',
                tier_used: 'flash',
                tier_reason: 'score 0.92 ≥ 0.85 → Flash',
                tokens_in: 1234,
                tokens_out: 567,
                cost_usd: 0,
                latency_ms: 0,
                cache_hit: null,
                match_kind: '1:1',
                confidence_score: 95,
                ...overrides,
            },
        }),
    };
}

function makeFinalDoc(overrides: Record<string, any> = {}) {
    return {
        data: () => ({
            type: 'job_metrics_final',
            timestamp: { toDate: () => new Date('2026-05-19T10:05:00Z') },
            data: {
                total_tokens_in: 12345,
                total_tokens_out: 6789,
                total_cost_usd: 0.42,
                duration_seconds: 312.5,
                partidas_total: 18,
                cache_hit_rate: 0.5,
                latency_p50: 1200,
                latency_p95: 3400,
                tier_flash_count: 14,
                tier_pro_count: 4,
                needs_review_count: 1,
                ...overrides,
            },
        }),
    };
}

describe('getJobMetricsAction', () => {
    beforeEach(() => {
        verifyAuthMock.mockReset();
        finalSnapMock.mockReset();
        partidaSnapMock.mockReset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    async function loadFresh() {
        vi.resetModules();
        return (await import('./get-job-metrics.action')).getJobMetricsAction;
    }

    it('throws "unauthorized" when verifyAuth returns null (non-admin caller)', async () => {
        verifyAuthMock.mockResolvedValue(null);
        finalSnapMock.mockResolvedValue({ empty: true, docs: [] });
        partidaSnapMock.mockResolvedValue({ empty: true, docs: [] });

        const action = await loadFresh();
        await expect(action('job-abc')).rejects.toThrow('unauthorized');
        // We never reach the Firestore layer when auth fails.
        expect(finalSnapMock).not.toHaveBeenCalled();
        expect(partidaSnapMock).not.toHaveBeenCalled();
    });

    it('returns empty result when both event streams are empty', async () => {
        verifyAuthMock.mockResolvedValue({ userId: 'u1', role: 'admin' });
        finalSnapMock.mockResolvedValue({ empty: true, docs: [] });
        partidaSnapMock.mockResolvedValue({ empty: true, docs: [] });

        const action = await loadFresh();
        const result = await action('job-empty');
        expect(result).toEqual({ jobMetrics: null, partidasResolved: [] });
    });

    it('parses job_metrics_final + partida_resolved_v2 documents (happy path)', async () => {
        verifyAuthMock.mockResolvedValue({ userId: 'u1', role: 'admin' });
        finalSnapMock.mockResolvedValue({ empty: false, docs: [makeFinalDoc()] });
        partidaSnapMock.mockResolvedValue({
            empty: false,
            docs: [
                makePartidaDoc({ code: 'P-001', tier_used: 'flash' }),
                makePartidaDoc({ code: 'P-002', tier_used: 'pro', match_kind: 'composed' }),
                makePartidaDoc({
                    code: 'P-003',
                    tier_used: 'flash',
                    match_kind: 'needs_review',
                    confidence_score: 40,
                }),
            ],
        });

        const action = await loadFresh();
        const result = await action('job-happy');

        expect(result.jobMetrics).not.toBeNull();
        expect(result.jobMetrics!.is_partial).toBe(false);
        expect(result.jobMetrics!.total_cost_usd).toBe(0.42);
        expect(result.jobMetrics!.partidas_total).toBe(18);
        expect(result.jobMetrics!.tier_flash_count).toBe(14);
        expect(result.jobMetrics!.tier_pro_count).toBe(4);
        expect(result.jobMetrics!.needs_review_count).toBe(1);
        expect(result.jobMetrics!.cache_hit_rate).toBe(0.5);
        expect(result.jobMetrics!.latency_p50).toBe(1200);
        expect(result.jobMetrics!.latency_p95).toBe(3400);

        expect(result.partidasResolved).toHaveLength(3);
        expect(result.partidasResolved[0]).toMatchObject({
            code: 'P-001',
            tier_used: 'flash',
            match_kind: '1:1',
            confidence_score: 95,
            tokens_in: 1234,
            tokens_out: 567,
        });
        expect(result.partidasResolved[2]).toMatchObject({
            code: 'P-003',
            match_kind: 'needs_review',
            confidence_score: 40,
        });
    });

    it('synthesises an is_partial aggregate when only partidas exist', async () => {
        verifyAuthMock.mockResolvedValue({ userId: 'u1', role: 'admin' });
        finalSnapMock.mockResolvedValue({ empty: true, docs: [] });
        partidaSnapMock.mockResolvedValue({
            empty: false,
            docs: [
                makePartidaDoc({ code: 'P-A', tier_used: 'flash' }),
                makePartidaDoc({ code: 'P-B', tier_used: 'pro', match_kind: 'needs_review' }),
            ],
        });

        const action = await loadFresh();
        const result = await action('job-partial');

        expect(result.jobMetrics).not.toBeNull();
        expect(result.jobMetrics!.is_partial).toBe(true);
        expect(result.jobMetrics!.partidas_total).toBe(2);
        expect(result.jobMetrics!.tier_flash_count).toBe(1);
        expect(result.jobMetrics!.tier_pro_count).toBe(1);
        expect(result.jobMetrics!.needs_review_count).toBe(1);
        // No cache_hit data yet → rate stays at 0 (S1-A-04 dependency).
        expect(result.jobMetrics!.cache_hit_rate).toBe(0);
    });

    it('returns empty result without throwing when jobId is falsy', async () => {
        verifyAuthMock.mockResolvedValue({ userId: 'u1', role: 'admin' });

        const action = await loadFresh();
        const result = await action('');
        expect(result).toEqual({ jobMetrics: null, partidasResolved: [] });
        // Firestore mocks should never be invoked because we short-circuit
        // on the falsy jobId path.
        expect(finalSnapMock).not.toHaveBeenCalled();
        expect(partidaSnapMock).not.toHaveBeenCalled();
    });
});

describe('percentile helper', () => {
    async function loadHelpers() {
        vi.resetModules();
        return await import('./_job-metrics-helpers');
    }

    it('returns 0 on empty input', async () => {
        const { percentile } = await loadHelpers();
        expect(percentile([], 50)).toBe(0);
    });

    it('matches the Python helper for canonical samples', async () => {
        const { percentile } = await loadHelpers();
        // [10,20,30,40,50] → p50 = 30, p95 = 48 (linear interpolation).
        expect(percentile([10, 20, 30, 40, 50], 50)).toBe(30);
        expect(percentile([10, 20, 30, 40, 50], 95)).toBe(48);
    });
});
