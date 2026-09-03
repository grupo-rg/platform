/**
 * One-off seed for the shared `calibration_factors/default` document.
 *
 * Writes the cold-start factors recommended by the calibration spec (§7):
 *   - global 1.36 (raw-PEM level; 1.7× all-in ÷ 1.25 GG+BI markup), source "seed", 0 samples
 *   - chapter DEMOLICIONES 1.42 (Grupo RG small-surface demolition evidence), source "seed"
 *   - guard { min_samples: 8, clamp_min: 0.8, clamp_max: 2.6, outlier_ratio_cap: 3.0 }
 *
 * Uso:
 *   npx tsx src/scripts/seed-calibration-factors.ts
 *
 * Requiere las env vars del admin SDK (FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL /
 * FIREBASE_PRIVATE_KEY) ya configuradas en `.env`.
 *
 * Usa { merge: true } → re-ejecutar es seguro (no borra capítulos ya aprendidos).
 * Los timestamps son strings ISO-8601 — el mismo contrato que leen el repositorio
 * Node y el pricer Python.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
config();

// Pure domain module (no side effects) → safe to import statically.
import {
    CALIBRATION_DOC_ID,
    type CalibrationFactors,
} from '@/backend/calibration/domain/calibration-factors';

const OWNER = 'correodeconsultoria@gmail.com';

async function main() {
    console.log('🚀 Seeding calibration_factors/default ...');

    // admin-app self-initializes at module load → import it AFTER dotenv.config().
    const { initFirebaseAdminApp } = await import('@/backend/shared/infrastructure/firebase/admin-app');
    const { getFirestore } = await import('firebase-admin/firestore');

    initFirebaseAdminApp();
    const db = getFirestore();

    const now = new Date().toISOString();

    const doc: CalibrationFactors = {
        id: CALIBRATION_DOC_ID,
        global: {
            factor: 1.36,
            source: 'seed',
            sample_count: 0,
            last_updated: now,
            updated_by: 'system',
        },
        chapters: {
            DEMOLICIONES: {
                factor: 1.42,
                source: 'seed',
                sample_count: 0,
                learned_factor: null,
                manual_factor: 1.42,
                last_updated: now,
                updated_by: OWNER,
            },
        },
        guard: {
            min_samples: 8,
            clamp_min: 0.8,
            clamp_max: 2.6,
            outlier_ratio_cap: 3.0,
        },
        updatedAt: now,
    };

    await db.collection('calibration_factors').doc(CALIBRATION_DOC_ID).set(doc, { merge: true });

    console.log('✅ Seeded calibration_factors/default:');
    console.log(`   global   → ${doc.global.factor}× (${doc.global.source})`);
    console.log(`   chapters → DEMOLICIONES ${doc.chapters.DEMOLICIONES.factor}× (${doc.chapters.DEMOLICIONES.source})`);
    console.log(`   guard    → min_samples=${doc.guard.min_samples}, clamp=[${doc.guard.clamp_min}, ${doc.guard.clamp_max}], outlier_cap=${doc.guard.outlier_ratio_cap}`);
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('❌ Seed failed:', err);
        process.exit(1);
    });
