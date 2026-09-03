/**
 * Price-calibration factors — the "catálogo → real constructor" multiplier.
 *
 * BC3/catálogo unit prices correlate with a real constructor's prices, but the
 * constructor runs a per-chapter multiplier over the catalog. This store holds
 * the owner-configurable + learned factor applied at the **raw-PEM level**
 * (pre-markup), consistent with the pricing order of operations:
 *
 *   catalog_unit_price (Judge PEM)
 *     × calibration_factor(chapter)   ← applied in the swarm, on raw PEM
 *     × markup_factor (1 + (GG+BI)/100)
 *     × (1 + IVA)
 *
 * Single Firestore doc `calibration_factors/default` (single-tenant today).
 * Read & written by the Python pricer AND the Next.js owner panel, so the
 * schema here is a shared contract — keep it aligned with the spec §4a.
 *
 * NOTE on timestamps: stored as ISO-8601 strings (not Firestore Timestamps).
 * This keeps them trivially serializable across the Next server-action → client
 * boundary and unambiguous for the Python reader (`datetime.fromisoformat`).
 */

export type CalibrationSource = 'manual' | 'learned' | 'seed';

/** Global default factor — applies to chapters with 0 samples / low-confidence names. */
export interface GlobalCalibration {
    /** Effective value the pricer reads (raw-PEM level). 1.0 = neutral cold start. */
    factor: number;
    source: CalibrationSource;
    sample_count: number;
    last_updated: string; // ISO-8601
    updated_by: string;
}

/** Per-chapter factor. Key = normalized chapter (see `normalizeChapterKey`). */
export interface ChapterCalibration {
    /**
     * Effective value the pricer reads (raw-PEM level). Equals `learned_factor`
     * only when `sample_count >= guard.min_samples` (and not manual-locked);
     * otherwise equals `manual_factor` (or the global default).
     */
    factor: number;
    source: CalibrationSource;
    sample_count: number;
    /** Running robust estimate; null until >= min samples have been collected. */
    learned_factor: number | null;
    /** Owner-set value that wins below the guard (and always when `manual_locked`). */
    manual_factor: number | null;
    /** When true, manual always wins; learning still updates `learned_factor` for visibility. */
    manual_locked?: boolean;
    last_updated: string; // ISO-8601
    updated_by: string;
    /** Optional per-chapter override of the global clamp. */
    clamp_min?: number;
    clamp_max?: number;
}

/** Learning-loop guard rails (owner-tunable without a deploy). */
export interface CalibrationGuard {
    /** Auto-apply threshold: below this per-chapter sample count, seed/manual/global is used. */
    min_samples: number;
    clamp_min: number;
    clamp_max: number;
    /** Reject corrections whose ratio is outside [1/cap, cap]. */
    outlier_ratio_cap: number;
}

export interface CalibrationFactors {
    id: string; // 'default'
    global: GlobalCalibration;
    /** Keyed by normalized chapter name (UPPERCASE + trim). */
    chapters: Record<string, ChapterCalibration>;
    guard: CalibrationGuard;
    updatedAt: string; // ISO-8601
}

export const CALIBRATION_DOC_ID = 'default';

export const DEFAULT_CALIBRATION_GUARD: CalibrationGuard = {
    min_samples: 8,
    clamp_min: 0.8,
    clamp_max: 2.6,
    outlier_ratio_cap: 3.0,
};

/**
 * Fallback returned when the doc does not exist yet. `global.factor = 1.0` is the
 * neutral cold start; the owner seeds a real value (spec recommends 1.36) via the
 * seed script / owner panel.
 */
export function defaultCalibrationFactors(): CalibrationFactors {
    const now = new Date().toISOString();
    return {
        id: CALIBRATION_DOC_ID,
        global: {
            factor: 1.0,
            source: 'seed',
            sample_count: 0,
            last_updated: now,
            updated_by: 'system',
        },
        chapters: {},
        guard: { ...DEFAULT_CALIBRATION_GUARD },
        updatedAt: now,
    };
}

/**
 * Normalize a chapter name into its calibration key. Mirrors the Python pricer's
 * `_normalize_chapter` (strip + upper) so a key seeded here matches the key the
 * pricer looks up. Kept intentionally minimal (no accent-stripping / whitespace
 * collapsing) to stay byte-identical with the pricer's lookup key.
 */
export function normalizeChapterKey(raw: string): string {
    return (raw ?? '').trim().toUpperCase();
}

export function clampFactor(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
}

/**
 * Effective (factor, source) for a chapter given the global default + guard.
 * Pure — used both at write-time (to stamp the stored `factor`) and by the UI.
 *
 * Precedence: manual-locked manual → learned (>= min_samples) → manual → global.
 */
export function computeEffectiveChapterFactor(
    chapter: Pick<ChapterCalibration, 'learned_factor' | 'manual_factor' | 'manual_locked' | 'sample_count' | 'source' | 'clamp_min' | 'clamp_max'>,
    global: Pick<GlobalCalibration, 'factor'>,
    guard: CalibrationGuard,
): { factor: number; source: CalibrationSource } {
    const cmin = chapter.clamp_min ?? guard.clamp_min;
    const cmax = chapter.clamp_max ?? guard.clamp_max;

    if (chapter.manual_locked && chapter.manual_factor != null) {
        return { factor: clampFactor(chapter.manual_factor, cmin, cmax), source: 'manual' };
    }
    if (chapter.sample_count >= guard.min_samples && chapter.learned_factor != null) {
        return { factor: clampFactor(chapter.learned_factor, cmin, cmax), source: 'learned' };
    }
    if (chapter.manual_factor != null) {
        // Preserve a 'seed' source if the owner never explicitly switched it to manual.
        const src: CalibrationSource = chapter.source === 'seed' ? 'seed' : 'manual';
        return { factor: clampFactor(chapter.manual_factor, cmin, cmax), source: src };
    }
    return { factor: global.factor, source: 'seed' };
}

export type CalibrationConfidenceLevel = 'seed' | 'learning' | 'learned';

/** UI confidence derived from sample_count (NOT the pricing 40/95 confidence). */
export function calibrationConfidence(
    sampleCount: number,
    minSamples: number,
): { level: CalibrationConfidenceLevel; label: string; progress: number } {
    if (sampleCount <= 0) {
        return { level: 'seed', label: 'seed/global', progress: 0 };
    }
    if (sampleCount < minSamples) {
        return {
            level: 'learning',
            label: `learning (${sampleCount}/${minSamples})`,
            progress: Math.round((sampleCount / minSamples) * 100),
        };
    }
    return { level: 'learned', label: 'learned', progress: 100 };
}

export interface CalibrationFactorsRepository {
    getFactors(): Promise<CalibrationFactors>;
    /** Full upsert (merge) of the doc. */
    saveFactors(factors: CalibrationFactors): Promise<void>;
    upsertGlobal(patch: Partial<GlobalCalibration>): Promise<void>;
    /** Deep-merge patch into `chapters[key]`, preserving the chapter's other fields. */
    upsertChapter(key: string, patch: Partial<ChapterCalibration>): Promise<void>;
    upsertGuard(patch: Partial<CalibrationGuard>): Promise<void>;
}
