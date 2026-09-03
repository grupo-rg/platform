'use server';

/**
 * Admin server actions for the configurable model registry (spec §5.4 / §5.5).
 *
 * All admin-gated via `verifyAuth(true)`. Writes go through `saveModelConfigDoc`
 * (admin-SDK), matching the restrictive `firestore.rules`.
 *
 *   - getModelRegistryAction : read all role docs (defaults fill the gaps).
 *   - testModelAction        : probe a candidate, NO write.
 *   - saveModelConfigAction  : PROBE-BEFORE-WRITE. On probe failure, return the
 *                              error and DO NOT touch the running config.
 *
 * Probe contract (spec §5.4):
 *   - LLM role       → 1-token generate, assert non-empty.
 *   - embedding role → embed "ping", assert vector length == outputDimensionality
 *                      (768); reject on mismatch (protects the Firestore vector schema).
 *   - image_gen      → skipped (full image gen is heavy) — accepted with a note.
 *   - local provider → skipped (cannot probe a local model from Node) — accepted.
 *
 * Embedding is a SPECIAL role (spec §6): its model id must NOT hot-swap. A model
 * change (or an outputDimensionality change) is BLOCKED here with a
 * re-vectorization warning — the full re-vectorization flow is out of Phase-0 scope.
 */

import { verifyAuth } from '@/backend/auth/auth.middleware';
import { ai } from '@/backend/ai/core/config/genkit.config';
import { geminiEmbedding001 } from '@genkit-ai/vertexai';
import {
    getAllModelConfigDocs,
    getModelConfigDoc,
    saveModelConfigDoc,
    type SaveModelConfigInput,
} from '@/backend/ai/core/config/model-registry.repository';
import { invalidateModelCache } from '@/backend/ai/core/config/model-registry';
import {
    buildDefaultDoc,
    EMBEDDING_ROLE,
    isModelRole,
    type ModelConfigDoc,
    type ModelParams,
    type ModelProvider,
    type ModelRole,
} from '@/backend/ai/core/config/model-registry.types';

export interface ProbeResult {
    ok: boolean;
    latencyMs: number;
    error: string | null;
    note?: string;
    /** For the embedding probe: the vector length returned. */
    dim?: number;
}

interface ProbeArgs {
    role: ModelRole;
    provider: ModelProvider;
    modelId: string;
    outputDimensionality: number | null;
}

/** Run the role-appropriate probe against a candidate model in the target region. */
async function probeModel(args: ProbeArgs): Promise<ProbeResult> {
    const { role, provider, modelId, outputDimensionality } = args;
    const start = Date.now();

    try {
        if (provider === 'local') {
            return {
                ok: true,
                latencyMs: 0,
                error: null,
                note: 'Modelo local (cross-encoder). No se prueba desde Node; su despliegue es del contenedor Python.',
            };
        }

        if (role === EMBEDDING_ROLE) {
            const dims = outputDimensionality ?? 768;
            const embedder =
                modelId === 'gemini-embedding-001' ? geminiEmbedding001 : `vertexai/${modelId}`;
            const res: any = await ai.embed({
                embedder: embedder as any,
                content: 'ping',
                options: { outputDimensionality: dims },
            });
            const vector: number[] | undefined = Array.isArray(res)
                ? res[0]?.embedding
                : res?.embedding;
            const len = vector?.length ?? 0;
            if (len !== dims) {
                return {
                    ok: false,
                    latencyMs: Date.now() - start,
                    error: `El embedder devolvió ${len} dimensiones, se esperaban ${dims}.`,
                    dim: len,
                };
            }
            return { ok: true, latencyMs: Date.now() - start, error: null, dim: len };
        }

        if (role === 'image_gen') {
            return {
                ok: true,
                latencyMs: 0,
                error: null,
                note: 'Probe de imagen omitido (la generación de imagen es costosa). Verifique manualmente antes de usar en producción.',
            };
        }

        // LLM roles — 1-token generate.
        const result: any = await ai.generate({
            model: `vertexai/${modelId}`,
            prompt: 'Reply with the single word: ok',
            config: { temperature: 0, maxOutputTokens: 16 },
        });
        const text = (result?.text ?? '').trim();
        if (!text) {
            return { ok: false, latencyMs: Date.now() - start, error: 'La generación devolvió texto vacío.' };
        }
        return { ok: true, latencyMs: Date.now() - start, error: null };
    } catch (err: any) {
        return { ok: false, latencyMs: Date.now() - start, error: err?.message || 'Fallo de la prueba.' };
    }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getModelRegistryAction(): Promise<
    { success: true; data: ModelConfigDoc[] } | { success: false; error: string }
> {
    const auth = await verifyAuth(true);
    if (!auth) return { success: false, error: 'forbidden' };
    try {
        const docs = await getAllModelConfigDocs();
        return { success: true, data: docs };
    } catch (error: any) {
        console.error('[getModelRegistryAction] failed', error);
        return { success: false, error: error?.message || 'unknown_error' };
    }
}

// ---------------------------------------------------------------------------
// Test (probe, no write)
// ---------------------------------------------------------------------------

export interface TestModelInput {
    role: string;
    provider?: ModelProvider;
    modelId: string;
    params?: Partial<ModelParams>;
}

export async function testModelAction(
    input: TestModelInput,
): Promise<{ success: true; probe: ProbeResult } | { success: false; error: string }> {
    const auth = await verifyAuth(true);
    if (!auth) return { success: false, error: 'forbidden' };
    if (!isModelRole(input.role)) return { success: false, error: `Rol desconocido: ${input.role}` };
    if (!input.modelId?.trim()) return { success: false, error: 'modelId vacío.' };

    const def = buildDefaultDoc(input.role);
    const probe = await probeModel({
        role: input.role,
        provider: input.provider ?? def.provider,
        modelId: input.modelId.trim(),
        outputDimensionality:
            input.params?.outputDimensionality ?? def.params.outputDimensionality,
    });
    return { success: true, probe };
}

// ---------------------------------------------------------------------------
// Save (probe-before-write)
// ---------------------------------------------------------------------------

export interface SaveModelInput {
    role: string;
    provider?: ModelProvider;
    modelId: string;
    pinnedVersion?: string | null;
    region?: string;
    params?: Partial<ModelParams>;
    enabled?: boolean;
    notes?: string | null;
}

export async function saveModelConfigAction(
    input: SaveModelInput,
): Promise<
    | { success: true; data: ModelConfigDoc; probe: ProbeResult }
    | { success: false; error: string; code?: 'embedding_requires_revectorization' | 'probe_failed' }
> {
    const auth = await verifyAuth(true);
    if (!auth) return { success: false, error: 'forbidden' };
    if (!isModelRole(input.role)) return { success: false, error: `Rol desconocido: ${input.role}` };

    const role = input.role;
    const modelId = input.modelId?.trim();
    if (!modelId) return { success: false, error: 'modelId vacío.' };

    let existing: ModelConfigDoc | null = null;
    try {
        existing = await getModelConfigDoc(role);
    } catch (err) {
        console.warn('[saveModelConfigAction] could not read existing doc', err);
    }
    const def = buildDefaultDoc(role);
    const current = existing ?? def;
    const provider = input.provider ?? current.provider;
    const nextDims = input.params?.outputDimensionality ?? current.params.outputDimensionality;

    // --- Embedding special-case: block the one-click swap (spec §6) ---
    if (role === EMBEDDING_ROLE) {
        const modelChanged = modelId !== current.modelId;
        const dimChanged = nextDims !== current.params.outputDimensionality;
        if (modelChanged || dimChanged) {
            return {
                success: false,
                code: 'embedding_requires_revectorization',
                error:
                    'Cambiar el modelo de embeddings (o su dimensionalidad) invalida TODOS los vectores ' +
                    'almacenados (material_catalog, price_book_2025): la búsqueda semántica fallaría en ' +
                    'silencio. Requiere un flujo de RE-VECTORIZACIÓN controlado (shadow index → cutover → ' +
                    'verificación), fuera del alcance de este cambio. El swap de un clic está bloqueado a propósito.',
            };
        }
    }

    // --- Probe-before-write ---
    const probe = await probeModel({
        role,
        provider,
        modelId,
        outputDimensionality: nextDims,
    });
    if (!probe.ok) {
        return {
            success: false,
            code: 'probe_failed',
            error: probe.error || 'La prueba del modelo falló; no se ha escrito nada.',
        };
    }

    // --- Commit ---
    try {
        const saveInput: SaveModelConfigInput = {
            role,
            provider,
            modelId,
            pinnedVersion: input.pinnedVersion ?? current.pinnedVersion,
            region: input.region ?? current.region,
            params: input.params,
            enabled: input.enabled ?? current.enabled,
            notes: input.notes ?? current.notes,
        };
        const saved = await saveModelConfigDoc(
            saveInput,
            auth.email || auth.userId,
            { status: 'ok', latencyMs: probe.latencyMs, error: null },
            existing,
        );
        invalidateModelCache(role);
        return { success: true, data: saved, probe };
    } catch (error: any) {
        console.error('[saveModelConfigAction] write failed', error);
        return { success: false, error: error?.message || 'Fallo al escribir la configuración.' };
    }
}
