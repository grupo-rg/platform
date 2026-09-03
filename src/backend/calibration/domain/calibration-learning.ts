/**
 * Pure aggregation helpers for the calibration learning loop (spec §5).
 *
 * All functions here are side-effect free and deterministic so the learning
 * algorithm (median / MAD / outlier-reject / clamp / idempotent recompute) is
 * unit-testable without touching Firestore. The application service composes
 * these with the repositories.
 */

import { CalibrationGuard, clampFactor } from './calibration-factors';

/** Median of a numeric list. Returns 0 for an empty list. */
export function median(values: number[]): number {
    const nums = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
    const n = nums.length;
    if (n === 0) return 0;
    const mid = Math.floor(n / 2);
    return n % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid];
}

/**
 * Median Absolute Deviation — a robust dispersion measure. MAD = median(|xᵢ − med|).
 * Pass a precomputed median to avoid recomputing it.
 */
export function medianAbsoluteDeviation(values: number[], med?: number): number {
    const nums = values.filter((v) => Number.isFinite(v));
    if (nums.length === 0) return 0;
    const m = med ?? median(nums);
    return median(nums.map((v) => Math.abs(v - m)));
}

/**
 * Hard outlier gate: keep ratios in [1/cap, cap] (default cap 3.0 → [0.33, 3.0]).
 * A ratio outside this band is a fat-finger / wrong-unit edit and is excluded.
 */
export function isWithinOutlierCap(ratio: number, cap: number): boolean {
    if (!Number.isFinite(ratio) || ratio <= 0) return false;
    if (!Number.isFinite(cap) || cap <= 0) return true;
    return ratio >= 1 / cap && ratio <= cap;
}

/**
 * MAD gate for a NEW sample: only rejects once we already have enough included
 * samples (`existingIncluded.length >= minSamples`) so early samples are never
 * spuriously trimmed. Accepts when the deviation is within `k` MADs of the
 * current median. When MAD collapses to 0 (all prior ratios identical) the test
 * is skipped (a lone differing sample is not necessarily wild).
 */
export function passesMadGate(
    ratio: number,
    existingIncluded: number[],
    minSamples: number,
    k = 4,
): boolean {
    if (existingIncluded.length < minSamples) return true;
    const med = median(existingIncluded);
    const mad = medianAbsoluteDeviation(existingIncluded, med);
    if (mad <= 0) return true;
    return Math.abs(ratio - med) <= k * mad;
}

export interface InclusionDecision {
    included: boolean;
    reason: 'ok' | 'outlier_cap' | 'mad';
}

/**
 * Decide whether a new sample's `ratio` is included, applying the outlier cap
 * first then the MAD gate (spec §5.2). `existingIncluded` are the ratios of
 * previously-included corrections for the SAME chapter, excluding any prior
 * entry for this same partida (so a re-save re-evaluates cleanly).
 */
export function decideInclusion(
    ratio: number,
    existingIncluded: number[],
    guard: Pick<CalibrationGuard, 'min_samples' | 'outlier_ratio_cap'>,
): InclusionDecision {
    if (!isWithinOutlierCap(ratio, guard.outlier_ratio_cap)) {
        return { included: false, reason: 'outlier_cap' };
    }
    if (!passesMadGate(ratio, existingIncluded, guard.min_samples)) {
        return { included: false, reason: 'mad' };
    }
    return { included: true, reason: 'ok' };
}

export interface RecomputeResult {
    /** median of included ratios; null when there are none. */
    learned_factor: number | null;
    /** count of included corrections for the chapter. */
    sample_count: number;
}

/**
 * Recompute a chapter's learned factor from ALL included ratios (spec §5.3).
 * This is a full recompute — NOT an incremental add — so re-saving a budget
 * (which replaces one correction) can never double-count.
 */
export function recomputeChapterLearnedFactor(includedRatios: number[]): RecomputeResult {
    const clean = includedRatios.filter((r) => Number.isFinite(r) && r > 0);
    if (clean.length === 0) {
        return { learned_factor: null, sample_count: 0 };
    }
    return { learned_factor: median(clean), sample_count: clean.length };
}

/** Clamp helper re-exported for the pricer/service (defense-in-depth at write-time). */
export { clampFactor };
