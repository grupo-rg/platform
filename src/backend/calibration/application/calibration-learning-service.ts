import {
    CalibrationFactorsRepository,
    ChapterCalibration,
    computeEffectiveChapterFactor,
    normalizeChapterKey,
} from '../domain/calibration-factors';
import {
    CalibrationCorrection,
    CalibrationCorrectionsRepository,
    correctionDocId,
} from '../domain/calibration-corrections';
import { decideInclusion, recomputeChapterLearnedFactor } from '../domain/calibration-learning';

export interface RecordCorrectionInput {
    budgetId: string;
    partidaCode: string;
    chapterName: string;
    /** Raw PEM before calibration (the learning baseline, spec gap 2). */
    aiPreCalibrationPrice: number;
    /** Factor in force at generation (1.0 if none). Audit-only; not used in the ratio. */
    appliedFactorAtGeneration: number;
    /** Human-corrected unit price already de-baked to raw PEM (÷ bakeFactor). */
    correctedRawPrice: number;
    correctedBy: string;
    correctedAt?: string; // ISO-8601; defaults to now
}

export type RecordCorrectionResult =
    | { status: 'skipped'; reason: string }
    | {
          status: 'recorded';
          chapterKey: string;
          ratio: number;
          included: boolean;
          inclusionReason: string;
          learnedFactor: number | null;
          sampleCount: number;
          effectiveFactor: number;
          effectiveSource: string;
      };

/**
 * Learning-loop application service (spec §5). Implements the
 * capture → dedup → recompute → upsert-chapter flow:
 *
 *   1. ratio = correctedRaw / aiPreCalibration   (raw-PEM level, gap 2 baseline)
 *   2. UPSERT the correction keyed by (budget, partida) — idempotent on re-save.
 *   3. RECOMPUTE the chapter's learned_factor from ALL included corrections
 *      (full recompute, never incremental → no double count).
 *   4. upsertChapter(learned_factor, sample_count) + the recomputed effective
 *      `factor`/`source` (computeEffectiveChapterFactor). Never touches
 *      manual_factor; learned only auto-applies at sample_count >= min_samples;
 *      manual_locked always wins.
 *
 * The reducer of a chapter's factor stays pure in `calibration-learning.ts`;
 * this service only orchestrates persistence.
 */
export class CalibrationLearningService {
    constructor(
        private readonly factorsRepo: CalibrationFactorsRepository,
        private readonly correctionsRepo: CalibrationCorrectionsRepository,
    ) {}

    async recordCorrection(input: RecordCorrectionInput): Promise<RecordCorrectionResult> {
        const key = normalizeChapterKey(input.chapterName);
        const base = input.aiPreCalibrationPrice;
        const corrected = input.correctedRawPrice;

        // Guard: need a positive, finite baseline + corrected price to form a ratio.
        if (!Number.isFinite(base) || base <= 0) {
            return { status: 'skipped', reason: 'invalid_baseline' };
        }
        if (!Number.isFinite(corrected) || corrected <= 0) {
            return { status: 'skipped', reason: 'invalid_corrected' };
        }

        const ratio = corrected / base;
        if (!Number.isFinite(ratio) || ratio <= 0) {
            return { status: 'skipped', reason: 'invalid_ratio' };
        }

        const factors = await this.factorsRepo.getFactors();
        const guard = factors.guard;

        const docId = correctionDocId(input.budgetId, input.partidaCode);
        const existing = await this.correctionsRepo.listByChapter(key);
        // Exclude any prior entry for THIS partida so a re-save re-evaluates cleanly.
        const others = existing.filter((c) => c.id !== docId);
        const existingIncludedRatios = others.filter((c) => c.included).map((c) => c.ratio);

        const decision = decideInclusion(ratio, existingIncludedRatios, guard);

        const correction: CalibrationCorrection = {
            id: docId,
            budget_id: input.budgetId,
            partida_code: input.partidaCode,
            chapter: key,
            ai_pre_calibration_price: base,
            applied_factor_at_generation: Number.isFinite(input.appliedFactorAtGeneration)
                ? input.appliedFactorAtGeneration
                : 1,
            corrected_raw_price: corrected,
            ratio,
            corrected_by: input.correctedBy || 'system',
            corrected_at: input.correctedAt || new Date().toISOString(),
            included: decision.included,
        };
        await this.correctionsRepo.upsert(correction);

        // Full recompute from ALL included corrections (idempotent — the just-upserted
        // doc replaces any prior entry for this partida in the merged set).
        const merged = [...others, correction];
        const includedRatios = merged.filter((c) => c.included).map((c) => c.ratio);
        const { learned_factor, sample_count } = recomputeChapterLearnedFactor(includedRatios);

        // Recompute the effective factor/source honoring the existing manual override.
        const prior = factors.chapters[key];
        const effInput: Pick<
            ChapterCalibration,
            'learned_factor' | 'manual_factor' | 'manual_locked' | 'sample_count' | 'source' | 'clamp_min' | 'clamp_max'
        > = {
            learned_factor,
            manual_factor: prior?.manual_factor ?? null,
            manual_locked: prior?.manual_locked,
            sample_count,
            source: prior?.source ?? 'seed',
            clamp_min: prior?.clamp_min,
            clamp_max: prior?.clamp_max,
        };
        const eff = computeEffectiveChapterFactor(effInput, factors.global, guard);

        // Never touch manual_factor. Only learned_factor / sample_count / effective factor/source.
        await this.factorsRepo.upsertChapter(key, {
            learned_factor,
            sample_count,
            factor: eff.factor,
            source: eff.source,
            updated_by: input.correctedBy || 'system',
        });

        return {
            status: 'recorded',
            chapterKey: key,
            ratio,
            included: decision.included,
            inclusionReason: decision.reason,
            learnedFactor: learned_factor,
            sampleCount: sample_count,
            effectiveFactor: eff.factor,
            effectiveSource: eff.source,
        };
    }
}
