import { getFirestore } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/backend/shared/infrastructure/firebase/admin-app';
import {
    CALIBRATION_DOC_ID,
    CalibrationFactors,
    CalibrationFactorsRepository,
    CalibrationGuard,
    ChapterCalibration,
    DEFAULT_CALIBRATION_GUARD,
    GlobalCalibration,
    defaultCalibrationFactors,
} from '../domain/calibration-factors';

const COLLECTION = 'calibration_factors';

/** Coerce a Firestore Timestamp / Date / ISO string into an ISO-8601 string. */
function toIso(value: unknown, fallback: string): string {
    if (!value) return fallback;
    if (typeof value === 'string') return value;
    // firebase-admin Timestamp
    if (typeof (value as any).toDate === 'function') {
        try {
            return (value as any).toDate().toISOString();
        } catch {
            return fallback;
        }
    }
    if (value instanceof Date) return value.toISOString();
    return fallback;
}

/**
 * Admin-SDK repository for the shared `calibration_factors/default` doc.
 * Mirrors `FirestoreBudgetConfigRepository`. Read & written only via the admin
 * SDK (Firestore rules forbid client writes to this collection).
 */
export class FirestoreCalibrationRepository implements CalibrationFactorsRepository {
    private db;

    constructor() {
        initFirebaseAdminApp();
        this.db = getFirestore();
    }

    private docRef() {
        return this.db.collection(COLLECTION).doc(CALIBRATION_DOC_ID);
    }

    async getFactors(): Promise<CalibrationFactors> {
        const snap = await this.docRef().get();
        const defaults = defaultCalibrationFactors();

        if (!snap.exists) {
            return defaults;
        }

        const data = snap.data() ?? {};
        const nowIso = new Date().toISOString();

        const global: GlobalCalibration = {
            ...defaults.global,
            ...(data.global ?? {}),
            last_updated: toIso(data.global?.last_updated, defaults.global.last_updated),
        };

        const guard: CalibrationGuard = {
            ...DEFAULT_CALIBRATION_GUARD,
            ...(data.guard ?? {}),
        };

        // Normalize each chapter: ensure required fields exist + timestamps are ISO strings.
        const rawChapters: Record<string, any> = data.chapters ?? {};
        const chapters: Record<string, ChapterCalibration> = {};
        for (const [key, raw] of Object.entries(rawChapters)) {
            if (!raw || typeof raw !== 'object') continue;
            const r = raw as any;
            chapters[key] = {
                factor: typeof r.factor === 'number' ? r.factor : global.factor,
                source: r.source ?? 'seed',
                sample_count: typeof r.sample_count === 'number' ? r.sample_count : 0,
                learned_factor: typeof r.learned_factor === 'number' ? r.learned_factor : null,
                manual_factor: typeof r.manual_factor === 'number' ? r.manual_factor : null,
                manual_locked: r.manual_locked === true ? true : undefined,
                last_updated: toIso(r.last_updated, nowIso),
                updated_by: r.updated_by ?? 'system',
                clamp_min: typeof r.clamp_min === 'number' ? r.clamp_min : undefined,
                clamp_max: typeof r.clamp_max === 'number' ? r.clamp_max : undefined,
            };
        }

        return {
            id: CALIBRATION_DOC_ID,
            global,
            chapters,
            guard,
            updatedAt: toIso(data.updatedAt, defaults.updatedAt),
        };
    }

    async saveFactors(factors: CalibrationFactors): Promise<void> {
        await this.docRef().set(
            {
                ...factors,
                id: CALIBRATION_DOC_ID,
                updatedAt: new Date().toISOString(),
            },
            { merge: true },
        );
    }

    async upsertGlobal(patch: Partial<GlobalCalibration>): Promise<void> {
        const nowIso = new Date().toISOString();
        await this.docRef().set(
            {
                id: CALIBRATION_DOC_ID,
                global: { ...patch, last_updated: nowIso },
                updatedAt: nowIso,
            },
            { merge: true },
        );
    }

    async upsertChapter(key: string, patch: Partial<ChapterCalibration>): Promise<void> {
        const nowIso = new Date().toISOString();
        // Nested-object form (NOT a dotted FieldPath) so chapter keys containing
        // dots / accents / spaces are treated as literal map keys. `set(merge:true)`
        // deep-merges maps, preserving this chapter's untouched fields + sibling chapters.
        await this.docRef().set(
            {
                id: CALIBRATION_DOC_ID,
                chapters: { [key]: { ...patch, last_updated: nowIso } },
                updatedAt: nowIso,
            },
            { merge: true },
        );
    }

    async upsertGuard(patch: Partial<CalibrationGuard>): Promise<void> {
        const nowIso = new Date().toISOString();
        await this.docRef().set(
            {
                id: CALIBRATION_DOC_ID,
                guard: { ...patch },
                updatedAt: nowIso,
            },
            { merge: true },
        );
    }
}
