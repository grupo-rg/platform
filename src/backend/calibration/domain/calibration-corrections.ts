/**
 * Calibration corrections — the append-only (upsert) sample log that feeds the
 * learning loop (spec §4b). One document per corrected partida, keyed by
 * `(budget_id, partida_code)` so re-saving the same budget UPSERTS the same doc
 * (idempotent — no double counting on re-save).
 *
 * Ratios are computed at the **raw-PEM level** (pre-markup), learning against the
 * pricer's `pre_calibration_unit_price` (never the already-calibrated price) so a
 * stable human yields a stable learned factor rather than compounding feedback.
 *
 * Admin-SDK only (Firestore rules forbid client writes to this collection).
 * Timestamps are ISO-8601 strings for trivial serialization + a stable Python read.
 */

export interface CalibrationCorrection {
    /** Deterministic id: `${budget_id}__${sanitized partida_code}` (idempotency key). */
    id: string;
    budget_id: string;
    partida_code: string;
    /** Normalized chapter key (see `normalizeChapterKey`). */
    chapter: string;
    /** Raw PEM before any calibration factor was applied (baseline for the ratio). */
    ai_pre_calibration_price: number;
    /** Calibration factor that was in force when the budget was generated (1.0 if none). */
    applied_factor_at_generation: number;
    /** Human-corrected unit price de-baked to raw PEM (÷ bakeFactor). */
    corrected_raw_price: number;
    /** corrected_raw_price / ai_pre_calibration_price. */
    ratio: number;
    corrected_by: string;
    corrected_at: string; // ISO-8601
    /** false when rejected as an outlier — kept for audit / deterministic recompute. */
    included: boolean;
}

/**
 * Build the deterministic doc id for a correction. Firestore doc ids may not
 * contain '/', so slashes in catalog/BC3 codes are escaped. The pair
 * (budget_id, partida_code) is the idempotency key.
 */
export function correctionDocId(budgetId: string, partidaCode: string): string {
    const trimmed = (partidaCode ?? '').trim().replace(/\//g, '__SL__').slice(0, 400);
    const safeCode = trimmed.length > 0 ? trimmed : 'nocode';
    return `${budgetId}__${safeCode}`;
}

export interface CalibrationCorrectionsRepository {
    /** Upsert (replace) the correction keyed by its deterministic id. */
    upsert(correction: CalibrationCorrection): Promise<void>;
    /** All corrections recorded for a normalized chapter key (included + excluded). */
    listByChapter(chapter: string): Promise<CalibrationCorrection[]>;
}
