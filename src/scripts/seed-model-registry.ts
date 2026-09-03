/**
 * One-off seed for the configurable model registry `model_registry/{role}`.
 *
 * Writes ALL 10 roles with the CURRENT production model ids (Phase 0 — zero
 * behaviour change). The shared schema (spec §5.1) is read by BOTH the Node app
 * and the Python swarm (`services/ai-core`), so this seed and the readers must
 * agree on the doc shape.
 *
 * Uso:
 *   npx tsx src/scripts/seed-model-registry.ts           # skip roles that already exist
 *   npx tsx src/scripts/seed-model-registry.ts --force   # overwrite every role
 *
 * Requiere las env vars del admin SDK (FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL /
 * FIREBASE_PRIVATE_KEY) ya configuradas en `.env`.
 *
 * Skip-if-exists por defecto → re-ejecutar no pisa ediciones hechas por el owner
 * desde la UI. `--force` reescribe (útil para restablecer a los defaults de código).
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
config();

// Pure domain module (constants only, no side effects) → safe to import statically.
import { MODEL_ROLES, buildDefaultDoc } from '@/backend/ai/core/config/model-registry.types';

const OWNER = 'seed-script';
const COLLECTION = 'model_registry';

async function main() {
    const force = process.argv.includes('--force');
    console.log(`🚀 Seeding ${COLLECTION}/* (${MODEL_ROLES.length} roles)${force ? ' [--force]' : ''} ...`);

    // admin-app self-initializes at module load → import it AFTER dotenv.config().
    const { initFirebaseAdminApp } = await import('@/backend/shared/infrastructure/firebase/admin-app');
    const { getFirestore, FieldValue } = await import('firebase-admin/firestore');

    initFirebaseAdminApp();
    const db = getFirestore();

    let written = 0;
    let skipped = 0;

    for (const role of MODEL_ROLES) {
        const ref = db.collection(COLLECTION).doc(role);
        const existing = await ref.get();
        if (existing.exists && !force) {
            skipped++;
            console.log(`   ⏭  ${role} — ya existe, se omite (usa --force para reescribir)`);
            continue;
        }

        const def = buildDefaultDoc(role);
        const persisted = {
            role: def.role,
            provider: def.provider,
            modelId: def.modelId,
            pinnedVersion: def.pinnedVersion, // null
            region: def.region,
            params: def.params,
            enabled: def.enabled,
            fallbackModelId: def.fallbackModelId,
            health: { status: 'unchecked', checkedAt: null, latencyMs: null, error: null },
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: OWNER,
            notes: def.notes,
        };

        await ref.set(persisted, { merge: false });
        await ref.collection('versions').add({ ...persisted, committedAt: FieldValue.serverTimestamp() });

        written++;
        console.log(`   ✅ ${role.padEnd(14)} → ${def.provider}/${def.modelId}`);
    }

    console.log(`\n✅ Done. ${written} escritos, ${skipped} omitidos.`);
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('❌ Seed failed:', err);
        process.exit(1);
    });
