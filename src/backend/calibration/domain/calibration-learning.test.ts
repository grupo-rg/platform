/**
 * Unit tests for the calibration learning-loop aggregation (spec §5).
 *
 * Two layers:
 *   1. Pure helpers — median / MAD / outlier-cap / MAD-gate / clamp / recompute.
 *   2. CalibrationLearningService — end-to-end capture→dedup→recompute→upsert
 *      against in-memory fakes (no Firestore). Proves the key invariant:
 *      re-saving the same partida is IDEMPOTENT (no double count), and
 *      manual_locked always wins.
 */
import { describe, it, expect } from 'vitest';

import {
    median,
    medianAbsoluteDeviation,
    isWithinOutlierCap,
    passesMadGate,
    decideInclusion,
    recomputeChapterLearnedFactor,
} from './calibration-learning';
import {
    clampFactor,
    CalibrationFactors,
    CalibrationFactorsRepository,
    CalibrationGuard,
    ChapterCalibration,
    GlobalCalibration,
    DEFAULT_CALIBRATION_GUARD,
    defaultCalibrationFactors,
} from './calibration-factors';
import {
    CalibrationCorrection,
    CalibrationCorrectionsRepository,
    correctionDocId,
} from './calibration-corrections';
import { CalibrationLearningService } from '../application/calibration-learning-service';

// ---------- Pure helpers ----------

describe('median', () => {
    it('handles odd-length lists', () => {
        expect(median([3, 1, 2])).toBe(2);
    });
    it('averages the middle two for even-length lists', () => {
        expect(median([1, 2, 3, 4])).toBe(2.5);
    });
    it('returns 0 for an empty list', () => {
        expect(median([])).toBe(0);
    });
    it('ignores non-finite values', () => {
        expect(median([1, 2, Number.NaN, 3])).toBe(2);
    });
});

describe('medianAbsoluteDeviation', () => {
    it('is 0 when all values are identical', () => {
        expect(medianAbsoluteDeviation([1.4, 1.4, 1.4])).toBe(0);
    });
    it('computes MAD around the median', () => {
        // median = 3; deviations = [2,1,0,1,2]; MAD = median = 1
        expect(medianAbsoluteDeviation([1, 2, 3, 4, 5])).toBe(1);
    });
});

describe('isWithinOutlierCap', () => {
    it('keeps ratios inside [1/cap, cap]', () => {
        expect(isWithinOutlierCap(1.42, 3.0)).toBe(true);
        expect(isWithinOutlierCap(0.5, 3.0)).toBe(true);
    });
    it('rejects ratios outside the band (10x fat-finger)', () => {
        expect(isWithinOutlierCap(10, 3.0)).toBe(false);
        expect(isWithinOutlierCap(0.1, 3.0)).toBe(false);
    });
    it('rejects non-positive / non-finite ratios', () => {
        expect(isWithinOutlierCap(0, 3.0)).toBe(false);
        expect(isWithinOutlierCap(Number.NaN, 3.0)).toBe(false);
    });
});

describe('passesMadGate', () => {
    const min = 8;
    it('accepts any sample while below min_samples', () => {
        expect(passesMadGate(5, [1.4, 1.5], min)).toBe(true);
    });
    it('rejects a sample beyond 4·MAD once at/above min_samples', () => {
        // 8 tight samples around ~1.4, MAD small; a 2.9 ratio is far out.
        const existing = [1.4, 1.42, 1.38, 1.41, 1.39, 1.43, 1.4, 1.4];
        expect(passesMadGate(2.9, existing, min)).toBe(false);
    });
    it('accepts a sample within 4·MAD once at/above min_samples', () => {
        // median 1.4, MAD 0.01 → 4·MAD = 0.04; 1.43 is 0.03 away → within band.
        const existing = [1.4, 1.42, 1.38, 1.41, 1.39, 1.43, 1.4, 1.4];
        expect(passesMadGate(1.43, existing, min)).toBe(true);
    });
    it('skips the test when MAD collapses to 0', () => {
        const existing = [1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4];
        expect(passesMadGate(1.6, existing, min)).toBe(true);
    });
});

describe('decideInclusion', () => {
    const guard = { min_samples: 8, outlier_ratio_cap: 3.0 };
    it('includes a normal ratio', () => {
        expect(decideInclusion(1.42, [], guard)).toEqual({ included: true, reason: 'ok' });
    });
    it('excludes an outlier by cap', () => {
        expect(decideInclusion(9, [], guard)).toEqual({ included: false, reason: 'outlier_cap' });
    });
    it('excludes by MAD once enough samples exist', () => {
        const existing = [1.4, 1.42, 1.38, 1.41, 1.39, 1.43, 1.4, 1.4];
        expect(decideInclusion(2.9, existing, guard)).toEqual({ included: false, reason: 'mad' });
    });
});

describe('clampFactor', () => {
    it('clamps to [min, max]', () => {
        expect(clampFactor(3.5, 0.8, 2.6)).toBe(2.6);
        expect(clampFactor(0.2, 0.8, 2.6)).toBe(0.8);
        expect(clampFactor(1.42, 0.8, 2.6)).toBe(1.42);
    });
});

describe('recomputeChapterLearnedFactor', () => {
    it('returns null learned factor for no included ratios', () => {
        expect(recomputeChapterLearnedFactor([])).toEqual({ learned_factor: null, sample_count: 0 });
    });
    it('returns the median of included ratios', () => {
        expect(recomputeChapterLearnedFactor([1.3, 1.5, 1.4])).toEqual({
            learned_factor: 1.4,
            sample_count: 3,
        });
    });
    it('drops non-positive / non-finite ratios from the count', () => {
        expect(recomputeChapterLearnedFactor([1.4, 0, Number.NaN, 1.6])).toEqual({
            learned_factor: 1.5,
            sample_count: 2,
        });
    });
});

// ---------- In-memory fakes ----------

class InMemoryFactorsRepo implements CalibrationFactorsRepository {
    factors: CalibrationFactors;
    constructor(seed?: Partial<CalibrationFactors>) {
        this.factors = { ...defaultCalibrationFactors(), ...seed };
    }
    async getFactors(): Promise<CalibrationFactors> {
        // return a deep-ish copy so callers cannot mutate internal state
        return JSON.parse(JSON.stringify(this.factors));
    }
    async saveFactors(f: CalibrationFactors): Promise<void> {
        this.factors = JSON.parse(JSON.stringify(f));
    }
    async upsertGlobal(patch: Partial<GlobalCalibration>): Promise<void> {
        this.factors.global = { ...this.factors.global, ...patch } as GlobalCalibration;
    }
    async upsertChapter(key: string, patch: Partial<ChapterCalibration>): Promise<void> {
        const prev = this.factors.chapters[key] ?? ({} as ChapterCalibration);
        this.factors.chapters[key] = { ...prev, ...patch } as ChapterCalibration;
    }
    async upsertGuard(patch: Partial<CalibrationGuard>): Promise<void> {
        this.factors.guard = { ...this.factors.guard, ...patch };
    }
}

class InMemoryCorrectionsRepo implements CalibrationCorrectionsRepository {
    store = new Map<string, CalibrationCorrection>();
    async upsert(c: CalibrationCorrection): Promise<void> {
        this.store.set(c.id, { ...c });
    }
    async listByChapter(chapter: string): Promise<CalibrationCorrection[]> {
        return [...this.store.values()].filter((c) => c.chapter === chapter);
    }
}

const GUARD: CalibrationGuard = { ...DEFAULT_CALIBRATION_GUARD }; // min 8, cap 3, clamp [0.8,2.6]

function seededFactors(): CalibrationFactors {
    const now = new Date().toISOString();
    return {
        id: 'default',
        global: { factor: 1.36, source: 'seed', sample_count: 0, last_updated: now, updated_by: 'system' },
        chapters: {},
        guard: { ...GUARD },
        updatedAt: now,
    };
}

// ---------- Service-level: idempotent recompute + guard behavior ----------

describe('CalibrationLearningService.recordCorrection', () => {
    it('skips when the baseline is non-positive', async () => {
        const svc = new CalibrationLearningService(
            new InMemoryFactorsRepo(seededFactors()),
            new InMemoryCorrectionsRepo(),
        );
        const res = await svc.recordCorrection({
            budgetId: 'b1',
            partidaCode: 'EDM01',
            chapterName: 'Demoliciones',
            aiPreCalibrationPrice: 0,
            appliedFactorAtGeneration: 1,
            correctedRawPrice: 100,
            correctedBy: 'owner',
        });
        expect(res.status).toBe('skipped');
    });

    it('records a ratio and keeps learned_factor below the min-sample guard (not auto-applied)', async () => {
        const factors = new InMemoryFactorsRepo(seededFactors());
        const svc = new CalibrationLearningService(factors, new InMemoryCorrectionsRepo());
        const res = await svc.recordCorrection({
            budgetId: 'b1',
            partidaCode: 'EDM01',
            chapterName: 'Demoliciones',
            aiPreCalibrationPrice: 100,
            appliedFactorAtGeneration: 1,
            correctedRawPrice: 142,
            correctedBy: 'owner',
        });
        expect(res.status).toBe('recorded');
        if (res.status !== 'recorded') return;
        expect(res.ratio).toBeCloseTo(1.42, 5);
        expect(res.included).toBe(true);
        expect(res.learnedFactor).toBeCloseTo(1.42, 5);
        expect(res.sampleCount).toBe(1);
        // Below min_samples (8): effective factor stays the global seed 1.36, source seed.
        expect(res.effectiveSource).toBe('seed');
        expect(res.effectiveFactor).toBeCloseTo(1.36, 5);
    });

    it('is IDEMPOTENT: re-saving the same partida does not double-count', async () => {
        const corrections = new InMemoryCorrectionsRepo();
        const svc = new CalibrationLearningService(new InMemoryFactorsRepo(seededFactors()), corrections);
        const input = {
            budgetId: 'b1',
            partidaCode: 'EDM01',
            chapterName: 'Demoliciones',
            aiPreCalibrationPrice: 100,
            appliedFactorAtGeneration: 1,
            correctedRawPrice: 150,
            correctedBy: 'owner',
        };
        const first = await svc.recordCorrection(input);
        const second = await svc.recordCorrection(input); // same (budget, partida) → upsert
        expect(second.status).toBe('recorded');
        if (second.status !== 'recorded') return;
        expect(second.sampleCount).toBe(1); // NOT 2
        expect(corrections.store.size).toBe(1); // single doc
        expect(second.learnedFactor).toBeCloseTo(1.5, 5);
        // Re-saving with a different corrected price replaces (not adds).
        const changed = await svc.recordCorrection({ ...input, correctedRawPrice: 160 });
        expect(changed.status).toBe('recorded');
        if (changed.status !== 'recorded') return;
        expect(changed.sampleCount).toBe(1);
        expect(changed.learnedFactor).toBeCloseTo(1.6, 5);
    });

    it('auto-applies the learned median once min_samples is reached (clamped)', async () => {
        const factors = new InMemoryFactorsRepo(seededFactors());
        const svc = new CalibrationLearningService(factors, new InMemoryCorrectionsRepo());
        // 8 partidas, ratios centered on 1.5 → median 1.5, sample_count 8 == min_samples.
        const ratios = [1.4, 1.45, 1.5, 1.5, 1.5, 1.55, 1.6, 1.5];
        let last: any;
        for (let i = 0; i < ratios.length; i++) {
            last = await svc.recordCorrection({
                budgetId: 'b1',
                partidaCode: `P${i}`,
                chapterName: 'Demoliciones',
                aiPreCalibrationPrice: 100,
                appliedFactorAtGeneration: 1,
                correctedRawPrice: 100 * ratios[i],
                correctedBy: 'owner',
            });
        }
        expect(last.status).toBe('recorded');
        expect(last.sampleCount).toBe(8);
        expect(last.effectiveSource).toBe('learned');
        expect(last.effectiveFactor).toBeCloseTo(1.5, 5);
        // stored chapter factor equals the learned median (within clamp).
        const stored = (await factors.getFactors()).chapters['DEMOLICIONES'];
        expect(stored.learned_factor).toBeCloseTo(1.5, 5);
        expect(stored.factor).toBeCloseTo(1.5, 5);
    });

    it('excludes an outlier correction but keeps it logged (included:false)', async () => {
        const corrections = new InMemoryCorrectionsRepo();
        const svc = new CalibrationLearningService(new InMemoryFactorsRepo(seededFactors()), corrections);
        const res = await svc.recordCorrection({
            budgetId: 'b1',
            partidaCode: 'EDM99',
            chapterName: 'Demoliciones',
            aiPreCalibrationPrice: 100,
            appliedFactorAtGeneration: 1,
            correctedRawPrice: 900, // ratio 9.0 → outside [0.33, 3.0]
            correctedBy: 'owner',
        });
        expect(res.status).toBe('recorded');
        if (res.status !== 'recorded') return;
        expect(res.included).toBe(false);
        expect(res.inclusionReason).toBe('outlier_cap');
        expect(res.learnedFactor).toBeNull();
        expect(res.sampleCount).toBe(0);
        // doc is persisted for audit even though excluded.
        const id = correctionDocId('b1', 'EDM99');
        expect(corrections.store.get(id)?.included).toBe(false);
    });

    it('manual_locked always wins even past the guard', async () => {
        const seed = seededFactors();
        seed.chapters['DEMOLICIONES'] = {
            factor: 1.8,
            source: 'manual',
            sample_count: 0,
            learned_factor: null,
            manual_factor: 1.8,
            manual_locked: true,
            last_updated: seed.updatedAt,
            updated_by: 'owner',
        };
        const factors = new InMemoryFactorsRepo(seed);
        const svc = new CalibrationLearningService(factors, new InMemoryCorrectionsRepo());
        let last: any;
        for (let i = 0; i < 8; i++) {
            last = await svc.recordCorrection({
                budgetId: 'b1',
                partidaCode: `P${i}`,
                chapterName: 'Demoliciones',
                aiPreCalibrationPrice: 100,
                appliedFactorAtGeneration: 1,
                correctedRawPrice: 150, // learned would be 1.5
                correctedBy: 'owner',
            });
        }
        expect(last.sampleCount).toBe(8);
        expect(last.learnedFactor).toBeCloseTo(1.5, 5); // learned still tracked for visibility
        expect(last.effectiveSource).toBe('manual');
        expect(last.effectiveFactor).toBeCloseTo(1.8, 5); // manual override wins
        // manual_factor is never overwritten by learning.
        const stored = (await factors.getFactors()).chapters['DEMOLICIONES'];
        expect(stored.manual_factor).toBe(1.8);
    });
});
