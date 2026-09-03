/**
 * Configurable Model Registry — resolver (spec §5.2).
 *
 * `resolveModel(role)` reads `model_registry/{role}` (via `adminFirestore`) and
 * returns the id in every shape a call site needs. A process-level TTL cache
 * (~60s) keeps hot paths off Firestore.
 *
 * AI-FIRST, NEVER HARD-FAIL: the Firestore read + validation are wrapped in
 * try/catch. On a missing doc / `enabled:false` / unparseable modelId / ANY
 * error, it returns the CODE DEFAULT for the role (the current production id)
 * and warns. Module init does NO async read — resolution is lazy per call.
 *
 * Phase 0 note: the two `genkit.config.ts` singletons (`gemini25Flash`,
 * `embeddingModel`) stay exported as pure code defaults and are unchanged, so
 * every call site that has not been migrated behaves exactly as before.
 *
 * TODO(model-registry): migrate remaining inline sites (spec §1B). Still hardcoding
 * the model id and NOT yet routed through resolveModel:
 *   #5  src/genkit/index.ts:12 (legacy default model)
 *   #7  private/agents/validation.agent.ts:37
 *   #8  core/agents/aparejador-orchestrator.agent.ts:97
 *   #9  private-core/tools/web-price-search.tool.ts:42
 *   #10 core/tools/web-price-search.tool.ts:42 (dup)
 *   #12 private/agents/construction-architect.agent.ts:53
 *   #13 core/infrastructure/gemini-files.service.ts:61  (Files/Batch API, models/ prefix)
 *   #14 core/infrastructure/gemini-files.service.ts:92  (Files/Batch API, models/ prefix)
 *   #15 private-core/flows/renovation/generate-render.flow.ts:51 (image prompt translate)
 *   #16 private-core/flows/renovation/generate-render.flow.ts:84 (image gen)
 *   #17 private/flows/renovation/generate-render.flow.ts:49,68 (dup tree)
 *   #18 marketing/application/ai-messaging.decorator.ts:78 (raw @google/genai client)
 *   #21 src/genkit/ingestion.ts:61 (legacy price-book ingestion, PRO)
 *   + the ~20 `gemini25Flash` consumers (spec §1A) which move when the singleton is
 *     eventually resolved through the registry.
 *   NOTE: embedding call sites (#1,3,22) are deliberately NOT migrated here — a
 *   swap must go through the gated re-vectorization flow (spec §6).
 */

import { gemini } from '@genkit-ai/vertexai';
import {
    buildDefaultDoc,
    type ModelConfigDoc,
    type ModelRole,
    type ResolvedModel,
} from './model-registry.types';
import { getModelConfigDoc } from './model-registry.repository';

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
    doc: ModelConfigDoc;
    expiresAt: number;
}

const cache = new Map<ModelRole, CacheEntry>();

/** Drop cached config so the next `resolveModel` re-reads Firestore. Called on Save. */
export function invalidateModelCache(role?: ModelRole): void {
    if (role) cache.delete(role);
    else cache.clear();
}

function toResolved(doc: ModelConfigDoc): ResolvedModel {
    const id = doc.modelId;
    return {
        id,
        genkitRef: gemini(id),
        prefixed: doc.provider === 'vertexai' ? `vertexai/${id}` : id,
        params: doc.params,
        region: doc.region,
    };
}

/**
 * Resolve the active model for a role. Never throws — returns the code default
 * on any problem. Result carries `{ id, genkitRef, prefixed, params, region }`.
 */
export async function resolveModel(role: ModelRole): Promise<ResolvedModel> {
    const now = Date.now();
    const cached = cache.get(role);
    if (cached && cached.expiresAt > now) {
        return toResolved(cached.doc);
    }

    const fallbackDoc = buildDefaultDoc(role);

    try {
        const doc = await getModelConfigDoc(role);

        if (!doc) {
            // Missing doc is expected before the registry is seeded — quiet fallback.
            cache.set(role, { doc: fallbackDoc, expiresAt: now + CACHE_TTL_MS });
            return toResolved(fallbackDoc);
        }
        if (!doc.enabled) {
            console.warn(
                `[model-registry] role '${role}' is disabled — using code default '${fallbackDoc.modelId}'.`,
            );
            cache.set(role, { doc: fallbackDoc, expiresAt: now + CACHE_TTL_MS });
            return toResolved(fallbackDoc);
        }
        if (typeof doc.modelId !== 'string' || !doc.modelId.trim()) {
            console.warn(
                `[model-registry] role '${role}' has an unparseable modelId — using code default '${fallbackDoc.modelId}'.`,
            );
            cache.set(role, { doc: fallbackDoc, expiresAt: now + CACHE_TTL_MS });
            return toResolved(fallbackDoc);
        }

        cache.set(role, { doc, expiresAt: now + CACHE_TTL_MS });
        return toResolved(doc);
    } catch (err) {
        console.warn(
            `[model-registry] resolveModel('${role}') failed — using code default '${fallbackDoc.modelId}'.`,
            err,
        );
        // Cache the fallback briefly so a Firestore outage doesn't hammer it per call.
        cache.set(role, { doc: fallbackDoc, expiresAt: now + CACHE_TTL_MS });
        return toResolved(fallbackDoc);
    }
}

/** Synchronous code-default resolution (no Firestore) — for non-async contexts. */
export function resolveModelDefault(role: ModelRole): ResolvedModel {
    return toResolved(buildDefaultDoc(role));
}
