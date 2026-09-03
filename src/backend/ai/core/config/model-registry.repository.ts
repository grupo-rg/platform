/**
 * Firestore repository for the configurable model registry (spec §5.1).
 *
 * Admin-SDK only — matches the restrictive `firestore.rules` (client writes to
 * `model_registry` stay blocked; all access is server-side). The Python swarm
 * reads the SAME `model_registry/{role}` docs, so the persisted shape here must
 * match `model-registry.types.ts` exactly.
 *
 *   model_registry/{role}                     ← one doc per role (id == role)
 *   model_registry/{role}/versions/{autoId}   ← audit / rollback snapshots
 */

import { adminFirestore } from '@/backend/shared/infrastructure/firebase/admin-app';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
    buildDefaultDoc,
    MODEL_DEFAULTS,
    MODEL_ROLES,
    type ModelConfigDoc,
    type ModelHealth,
    type ModelParams,
    type ModelProvider,
    type ModelRole,
} from './model-registry.types';

const COLLECTION = 'model_registry';

function tsToIso(value: any): string | null {
    if (!value) return null;
    if (typeof value?.toDate === 'function') return value.toDate().toISOString();
    if (typeof value === 'string') return value;
    if (value instanceof Date) return value.toISOString();
    return null;
}

function parseParams(raw: any, fallback: ModelParams): ModelParams {
    const p = raw && typeof raw === 'object' ? raw : {};
    const num = (v: any): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    return {
        temperature: p.temperature === null ? null : num(p.temperature) ?? fallback.temperature,
        maxOutputTokens: p.maxOutputTokens === null ? null : num(p.maxOutputTokens) ?? fallback.maxOutputTokens,
        outputDimensionality:
            p.outputDimensionality === null
                ? null
                : num(p.outputDimensionality) ?? fallback.outputDimensionality,
    };
}

function parseHealth(raw: any): ModelHealth {
    const h = raw && typeof raw === 'object' ? raw : {};
    const status: ModelHealth['status'] =
        h.status === 'ok' || h.status === 'failed' ? h.status : 'unchecked';
    return {
        status,
        checkedAt: tsToIso(h.checkedAt),
        latencyMs: typeof h.latencyMs === 'number' ? h.latencyMs : null,
        error: typeof h.error === 'string' ? h.error : null,
    };
}

/**
 * Merge a raw Firestore doc onto the role's code default so that a partial or
 * legacy doc never yields `undefined` fields. Timestamps become ISO strings.
 */
function parseDoc(role: ModelRole, raw: any): ModelConfigDoc {
    const def = buildDefaultDoc(role);
    if (!raw || typeof raw !== 'object') return def;
    const provider: ModelProvider =
        raw.provider === 'vertexai' || raw.provider === 'googleai' || raw.provider === 'local'
            ? raw.provider
            : def.provider;
    return {
        role,
        provider,
        modelId: typeof raw.modelId === 'string' && raw.modelId ? raw.modelId : def.modelId,
        pinnedVersion: typeof raw.pinnedVersion === 'string' ? raw.pinnedVersion : null,
        region: typeof raw.region === 'string' && raw.region ? raw.region : def.region,
        params: parseParams(raw.params, def.params),
        enabled: typeof raw.enabled === 'boolean' ? raw.enabled : def.enabled,
        fallbackModelId:
            typeof raw.fallbackModelId === 'string' && raw.fallbackModelId
                ? raw.fallbackModelId
                : def.fallbackModelId,
        health: parseHealth(raw.health),
        updatedAt: tsToIso(raw.updatedAt),
        updatedBy: typeof raw.updatedBy === 'string' ? raw.updatedBy : null,
        notes: typeof raw.notes === 'string' ? raw.notes : def.notes,
    };
}

/** Read a single role doc. Returns `null` when the doc does not exist. */
export async function getModelConfigDoc(role: ModelRole): Promise<ModelConfigDoc | null> {
    const snap = await adminFirestore.collection(COLLECTION).doc(role).get();
    if (!snap.exists) return null;
    return parseDoc(role, snap.data());
}

/** Read every role, filling any missing doc with its code default. */
export async function getAllModelConfigDocs(): Promise<ModelConfigDoc[]> {
    const refs = MODEL_ROLES.map((r) => adminFirestore.collection(COLLECTION).doc(r));
    const snaps = await adminFirestore.getAll(...refs);
    return MODEL_ROLES.map((role, i) => {
        const snap = snaps[i];
        return snap?.exists ? parseDoc(role, snap.data()) : buildDefaultDoc(role);
    });
}

export interface SaveModelConfigInput {
    role: ModelRole;
    provider?: ModelProvider;
    modelId: string;
    pinnedVersion?: string | null;
    region?: string;
    params?: Partial<ModelParams>;
    enabled?: boolean;
    notes?: string | null;
}

/**
 * Persist a role config AND append an audit snapshot to `versions/`. `health` is
 * the result of the probe that gated this write (see the server action). Returns
 * the parsed doc (ISO timestamps) for immediate UI use.
 *
 * NOTE: no probing / validation here — the server action is responsible for
 * probe-before-write. This repo only writes what it is told.
 */
export async function saveModelConfigDoc(
    input: SaveModelConfigInput,
    updatedBy: string,
    health: { status: 'ok' | 'failed'; latencyMs: number | null; error: string | null },
    existing: ModelConfigDoc | null,
): Promise<ModelConfigDoc> {
    const def = buildDefaultDoc(input.role);
    const base = existing ?? def;
    const provider = input.provider ?? base.provider;
    const params: ModelParams = {
        temperature: input.params?.temperature ?? base.params.temperature,
        maxOutputTokens: input.params?.maxOutputTokens ?? base.params.maxOutputTokens,
        outputDimensionality:
            input.params?.outputDimensionality ?? base.params.outputDimensionality,
    };
    const checkedAt = Timestamp.now();

    // The persisted document — Firestore Timestamps at rest, matching the shared
    // schema the Python side reads.
    const persisted = {
        role: input.role,
        provider,
        modelId: input.modelId,
        pinnedVersion: input.pinnedVersion ?? base.pinnedVersion ?? null,
        region: input.region ?? base.region,
        params,
        enabled: input.enabled ?? base.enabled,
        fallbackModelId: def.fallbackModelId, // always the code default id
        health: {
            status: health.status,
            checkedAt,
            latencyMs: health.latencyMs,
            error: health.error,
        },
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy,
        notes: input.notes ?? base.notes ?? null,
    };

    const ref = adminFirestore.collection(COLLECTION).doc(input.role);
    await ref.set(persisted, { merge: false });
    // Audit / rollback snapshot.
    await ref.collection('versions').add({
        ...persisted,
        committedAt: FieldValue.serverTimestamp(),
    });

    return parseDoc(input.role, { ...persisted, updatedAt: checkedAt });
}

/** Persist only a probe result to `health` (used by the read/refresh path if needed). */
export async function saveHealthOnly(
    role: ModelRole,
    health: { status: 'ok' | 'failed'; latencyMs: number | null; error: string | null },
): Promise<void> {
    await adminFirestore
        .collection(COLLECTION)
        .doc(role)
        .set(
            {
                health: {
                    status: health.status,
                    checkedAt: Timestamp.now(),
                    latencyMs: health.latencyMs,
                    error: health.error,
                },
            },
            { merge: true },
        );
}

export { MODEL_DEFAULTS };
