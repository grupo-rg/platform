'use server';

/**
 * Learning-loop capture (spec §3 gap 1, §5). Admin-gated server action wired
 * into the editor SAVE flow alongside `updateBudgetAction`. It reads the
 * JUST-SAVED budget, diffs eligible AI-sourced catalog partidas at the
 * **raw-PEM level**, upserts a `calibration_corrections` sample per changed
 * partida, and recomputes the chapter's learned factor.
 *
 * Design invariants (see spec):
 *   - Learn against `ai_resolution.pre_calibration_unit_price` (NOT the
 *     already-calibrated price) → falls back to `ai_unit_price` (raw PEM) for
 *     older budgets that predate calibration stamping.
 *   - De-bake the corrected price: `corrected_raw = unitPrice / bakeFactor`,
 *     `bakeFactor = 1 + (GG+BI)/100` from the budget's baked config.
 *   - Chapter key via `normalizeChapterKey` (matches the pricer/UI key).
 *   - Skip `active_price_source === 'bc3'` and `match_kind === 'from_scratch'`.
 *   - Only harvest partidas whose price actually moved off the AI value.
 *   - Idempotent: correction docs keyed by (budget, partida); re-saving
 *     recomputes from all included corrections (no double count).
 *
 * Fire-and-forget / non-fatal: this action never throws to the caller — the
 * editor calls it after a successful save and ignores failures so learning
 * capture can never block or fail a save. It COEXISTS with the RLHF
 * `logCorrectionPairAction` (this one calibrates the price factor).
 */

import { verifyAuth } from '@/backend/auth/auth.middleware';
import { BudgetRepositoryFirestore } from '@/backend/budget/infrastructure/budget-repository-firestore';
import { CalibrationLearningService } from '@/backend/calibration/application/calibration-learning-service';
import { FirestoreCalibrationRepository } from '@/backend/calibration/infrastructure/firestore-calibration.repository';
import { FirestoreCalibrationCorrectionsRepository } from '@/backend/calibration/infrastructure/firestore-calibration-corrections.repository';

export interface RecordPriceCorrectionsResult {
    success: boolean;
    processed?: number;
    recorded?: number;
    included?: number;
    skipped?: number;
    error?: string;
}

/** Relative + absolute epsilon for "price actually changed" detection (raw PEM). */
const EPS_ABS = 0.01;
const EPS_REL = 0.005;

type AnyConfig = { marginGG?: number; marginBI?: number; tax?: number } | undefined | null;

/**
 * De-bake factor for the persisted `unitPrice` → raw PEM, chosen by
 * `calibrationVersion` (the storage semantics differ per version — see
 * budget.ts). Returns `null` when we CANNOT de-bake reliably, so the caller
 * skips harvesting rather than corrupt the learned factor with a wrong de-bake.
 *   - 'phase17-markup-baked': partidas store baked PVP → factor = 1 + (GG+BI)/100.
 *   - 'phase15': partidas already store raw PEM → factor = 1 (no de-bake).
 *   - phase14 / undefined / legacy: storage is all-in baked by old calibration
 *     (the editor even forces GG=BI=0), so a per-config de-bake is meaningless
 *     → null (skip).
 */
function computeBakeFactor(budget: any): number | null {
    const version = budget?.calibrationVersion;
    if (version === 'phase15') return 1;
    if (version !== 'phase17-markup-baked') return null;
    const cfg: AnyConfig = budget?.bakedConfig ?? budget?.config;
    const gg = Number(cfg?.marginGG);
    const bi = Number(cfg?.marginBI);
    if (!Number.isFinite(gg) || !Number.isFinite(bi)) return null;
    const factor = 1 + (gg + bi) / 100;
    return factor > 0 ? factor : null;
}

function readAiResolution(item: any): any {
    return item?.ai_resolution ?? item?.aiResolution ?? null;
}

/** Baseline for the learned ratio: pre-calibration raw PEM, falling back to ai_unit_price. */
function resolveBaseline(item: any): number | null {
    const res = readAiResolution(item);
    const preCal = res?.pre_calibration_unit_price;
    if (Number.isFinite(preCal) && Number(preCal) > 0) return Number(preCal);
    const aiRaw = item?.ai_unit_price;
    if (Number.isFinite(aiRaw) && Number(aiRaw) > 0) return Number(aiRaw);
    return null;
}

export async function recordPriceCorrectionsAction(
    budgetId: string,
): Promise<RecordPriceCorrectionsResult> {
    try {
        // Admin-gated (owner-only) — mirrors src/actions/admin/*.
        const auth = await verifyAuth(true);
        if (!auth) {
            return { success: false, error: 'unauthorized' };
        }
        if (!budgetId) {
            return { success: false, error: 'missing_budget_id' };
        }

        const budgetRepo = new BudgetRepositoryFirestore();
        const budget: any = await budgetRepo.findById(budgetId);
        if (!budget) {
            return { success: false, error: 'budget_not_found' };
        }

        const bakeFactor = computeBakeFactor(budget);
        if (bakeFactor == null) {
            // Ambiguous storage semantics for this calibrationVersion (legacy /
            // phase14 / undefined) → do NOT harvest; a wrong de-bake would poison
            // the learned factor. Non-fatal: the save already succeeded.
            return { success: true, processed: 0, recorded: 0, included: 0, skipped: 0 };
        }
        const learning = new CalibrationLearningService(
            new FirestoreCalibrationRepository(),
            new FirestoreCalibrationCorrectionsRepository(),
        );

        let processed = 0;
        let recorded = 0;
        let included = 0;
        let skipped = 0;

        const chapters: any[] = Array.isArray(budget.chapters) ? budget.chapters : [];
        for (const chapter of chapters) {
            const chapterName: string = chapter?.name ?? '';
            const items: any[] = Array.isArray(chapter?.items) ? chapter.items : [];

            for (const item of items) {
                if ((item?.type ?? 'PARTIDA') !== 'PARTIDA') continue;
                processed++;

                // Exclusions (spec §8): BC3 active-source + from_scratch partidas.
                if (item?.active_price_source === 'bc3') {
                    skipped++;
                    continue;
                }
                if (item?.match_kind === 'from_scratch') {
                    skipped++;
                    continue;
                }

                const baseline = resolveBaseline(item);
                if (baseline == null) {
                    skipped++;
                    continue;
                }

                const correctedRaw = Number(item?.unitPrice) / bakeFactor;
                if (!Number.isFinite(correctedRaw) || correctedRaw <= 0) {
                    skipped++;
                    continue;
                }

                const res = readAiResolution(item);
                const appliedFactor =
                    Number.isFinite(res?.applied_calibration_factor) && Number(res?.applied_calibration_factor) > 0
                        ? Number(res.applied_calibration_factor)
                        : 1;

                // Change detection at raw-PEM level: did the human move the price off
                // the AI value? The AI value at raw PEM = baseline × appliedFactor.
                const aiRawAtGeneration = baseline * appliedFactor;
                const delta = Math.abs(correctedRaw - aiRawAtGeneration);
                const tolerance = Math.max(EPS_ABS, EPS_REL * aiRawAtGeneration);
                if (delta <= tolerance) {
                    skipped++;
                    continue; // unchanged — treat un-edited AI partidas as neutral.
                }

                const partidaCode: string = item?.code || item?.id || '';

                const result = await learning.recordCorrection({
                    budgetId,
                    partidaCode,
                    chapterName,
                    aiPreCalibrationPrice: baseline,
                    appliedFactorAtGeneration: appliedFactor,
                    correctedRawPrice: correctedRaw,
                    correctedBy: auth.email || auth.userId,
                });

                if (result.status === 'recorded') {
                    recorded++;
                    if (result.included) included++;
                } else {
                    skipped++;
                }
            }
        }

        return { success: true, processed, recorded, included, skipped };
    } catch (error: any) {
        // Non-fatal: never block or fail the save.
        console.error('[recordPriceCorrectionsAction] failed', error);
        return { success: false, error: error?.message || 'unknown_error' };
    }
}
