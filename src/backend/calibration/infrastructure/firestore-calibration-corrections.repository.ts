import { getFirestore } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/backend/shared/infrastructure/firebase/admin-app';
import {
    CalibrationCorrection,
    CalibrationCorrectionsRepository,
} from '../domain/calibration-corrections';

const COLLECTION = 'calibration_corrections';

/** Coerce a Firestore Timestamp / Date / ISO string into an ISO-8601 string. */
function toIso(value: unknown, fallback: string): string {
    if (!value) return fallback;
    if (typeof value === 'string') return value;
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
 * Admin-SDK repository for the append-only `calibration_corrections` log.
 * Flat collection keyed by `${budget_id}__${partida_code}` (see `correctionDocId`)
 * so the same partida on the same budget UPSERTS one doc (idempotent). Read &
 * written only via the admin SDK (Firestore rules forbid client writes here).
 */
export class FirestoreCalibrationCorrectionsRepository implements CalibrationCorrectionsRepository {
    private db;

    constructor() {
        initFirebaseAdminApp();
        this.db = getFirestore();
    }

    private col() {
        return this.db.collection(COLLECTION);
    }

    async upsert(correction: CalibrationCorrection): Promise<void> {
        await this.col().doc(correction.id).set(
            {
                ...correction,
                corrected_at: correction.corrected_at || new Date().toISOString(),
            },
            { merge: true },
        );
    }

    async listByChapter(chapter: string): Promise<CalibrationCorrection[]> {
        const snap = await this.col().where('chapter', '==', chapter).get();
        const nowIso = new Date().toISOString();
        return snap.docs.map((doc) => {
            const d = doc.data() as any;
            return {
                id: doc.id,
                budget_id: d.budget_id ?? '',
                partida_code: d.partida_code ?? '',
                chapter: d.chapter ?? chapter,
                ai_pre_calibration_price: Number(d.ai_pre_calibration_price) || 0,
                applied_factor_at_generation: Number(d.applied_factor_at_generation) || 1,
                corrected_raw_price: Number(d.corrected_raw_price) || 0,
                ratio: Number(d.ratio) || 0,
                corrected_by: d.corrected_by ?? 'system',
                corrected_at: toIso(d.corrected_at, nowIso),
                included: d.included === true,
            } satisfies CalibrationCorrection;
        });
    }
}
