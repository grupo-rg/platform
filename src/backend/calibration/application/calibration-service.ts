import {
    CalibrationFactors,
    CalibrationFactorsRepository,
    CalibrationGuard,
    ChapterCalibration,
    clampFactor,
    computeEffectiveChapterFactor,
    normalizeChapterKey,
} from '../domain/calibration-factors';

/**
 * Owner-facing calibration use cases. Keeps the dependency direction
 * infrastructure → application → domain: server actions call this service, which
 * delegates persistence to the repository and centralizes the clamp / effective
 * factor rules (so what the panel writes matches what the pricer reads).
 *
 * Learning-loop mutation (aggregating corrections) is a later increment; this
 * service only covers the owner-editable surface.
 */
export class CalibrationService {
    constructor(private readonly repo: CalibrationFactorsRepository) {}

    getFactors(): Promise<CalibrationFactors> {
        return this.repo.getFactors();
    }

    /** Owner edits the global default factor → source becomes `manual`. */
    async setGlobalFactor(factor: number, updatedBy: string): Promise<CalibrationFactors> {
        const current = await this.repo.getFactors();
        const clamped = clampFactor(factor, current.guard.clamp_min, current.guard.clamp_max);
        await this.repo.upsertGlobal({
            factor: clamped,
            source: 'manual',
            updated_by: updatedBy,
        });
        return this.repo.getFactors();
    }

    /**
     * Owner edits a chapter's effective factor and/or its manual lock. Writes
     * `manual_factor`, flips `source → manual`, and stamps the recomputed
     * effective `factor`. Preserves sample_count / learned_factor via merge.
     */
    async setChapterManual(
        chapterName: string,
        opts: { manualFactor: number; manualLocked: boolean },
        updatedBy: string,
    ): Promise<CalibrationFactors> {
        const key = normalizeChapterKey(chapterName);
        const current = await this.repo.getFactors();
        const existing = current.chapters[key];

        const cmin = existing?.clamp_min ?? current.guard.clamp_min;
        const cmax = existing?.clamp_max ?? current.guard.clamp_max;
        const effective = clampFactor(opts.manualFactor, cmin, cmax);

        const patch: Partial<ChapterCalibration> = {
            manual_factor: opts.manualFactor,
            manual_locked: opts.manualLocked,
            factor: effective,
            source: 'manual',
            updated_by: updatedBy,
        };
        // Initialize invariant fields when creating a brand-new chapter row.
        if (!existing) {
            patch.sample_count = 0;
            patch.learned_factor = null;
        }

        await this.repo.upsertChapter(key, patch);
        return this.repo.getFactors();
    }

    /** Toggle a chapter's manual lock without changing its factor value. */
    async setChapterLock(
        chapterName: string,
        locked: boolean,
        updatedBy: string,
    ): Promise<CalibrationFactors> {
        const key = normalizeChapterKey(chapterName);
        const current = await this.repo.getFactors();
        const existing = current.chapters[key];

        const patch: Partial<ChapterCalibration> = {
            manual_locked: locked,
            updated_by: updatedBy,
        };
        // Recompute the effective factor + source under the new lock state.
        if (existing) {
            const eff = computeEffectiveChapterFactor(
                { ...existing, manual_locked: locked },
                current.global,
                current.guard,
            );
            patch.factor = eff.factor;
            patch.source = eff.source;
        }

        await this.repo.upsertChapter(key, patch);
        return this.repo.getFactors();
    }

    /**
     * Reset a chapter to the global default: clears the manual override + lock,
     * and recomputes the effective factor from learned (if past guard) else global.
     */
    async resetChapterToGlobal(
        chapterName: string,
        updatedBy: string,
    ): Promise<CalibrationFactors> {
        const key = normalizeChapterKey(chapterName);
        const current = await this.repo.getFactors();
        const existing = current.chapters[key];

        const cleared = {
            ...(existing ?? {
                sample_count: 0,
                learned_factor: null as number | null,
            }),
            manual_factor: null as number | null,
            manual_locked: false,
            source: 'seed' as const,
        };
        const eff = computeEffectiveChapterFactor(cleared as any, current.global, current.guard);

        await this.repo.upsertChapter(key, {
            manual_factor: null,
            manual_locked: false,
            factor: eff.factor,
            source: eff.source,
            updated_by: updatedBy,
        });
        return this.repo.getFactors();
    }

    /** Owner tunes the learning guard rails (min_samples / clamps / outlier cap). */
    async setGuard(
        patch: Partial<CalibrationGuard>,
        _updatedBy: string,
    ): Promise<CalibrationFactors> {
        // Only persist finite numeric fields.
        const clean: Partial<CalibrationGuard> = {};
        if (Number.isFinite(patch.min_samples as number)) clean.min_samples = patch.min_samples;
        if (Number.isFinite(patch.clamp_min as number)) clean.clamp_min = patch.clamp_min;
        if (Number.isFinite(patch.clamp_max as number)) clean.clamp_max = patch.clamp_max;
        if (Number.isFinite(patch.outlier_ratio_cap as number)) clean.outlier_ratio_cap = patch.outlier_ratio_cap;

        await this.repo.upsertGuard(clean);
        return this.repo.getFactors();
    }
}
