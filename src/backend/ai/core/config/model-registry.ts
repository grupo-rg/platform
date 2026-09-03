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
 * Phase-0 inline sweep — DONE (spec §1B): each site below now resolves its id via
 * `resolveModel(role)` at the async call point, keeping the exact id shape the site
 * needs. Role defaults == today's ids, so behaviour is unchanged.
 *   #7  private/agents/validation.agent.ts               → chat        / prefixed
 *   #8  core/agents/aparejador-orchestrator.agent.ts     → chat        / prefixed
 *   #9  private-core/tools/web-price-search.tool.ts       → chat        / prefixed
 *   #10 core/tools/web-price-search.tool.ts (dup)         → chat        / prefixed
 *   #12 private/agents/construction-architect.agent.ts    → architect   / prefixed
 *   #13 core/infrastructure/gemini-files.service.ts       → extraction  / `models/`+id
 *   #14 core/infrastructure/gemini-files.service.ts       → extraction  / `models/`+id
 *   #15 private-core/flows/renovation/generate-render.flow.ts (translate) → chat      / plain id
 *   #16 private-core/flows/renovation/generate-render.flow.ts (image gen) → image_gen / plain id
 *   #17 private/flows/renovation/generate-render.flow.ts (image gen)      → image_gen / plain id
 *   #18 marketing/application/ai-messaging.decorator.ts   → marketing   / plain id
 *   #21 src/genkit/ingestion.ts (legacy price-book, PRO)  → pricing_pro / prefixed
 *
 *   NOTE (#13/#14): the Files/Batch API still calls through the Developer-API-key
 *   client (`@google/genai`) — a separate client migration. Only the id now comes
 *   from the registry; the `models/<id>` id shape and that client are unchanged.
 *   NOTE (#17): the private dup tree builds its prompt text directly (no prompt-
 *   translator LLM call), so only the image-gen id existed to wire — there is no
 *   `chat` call site in that file.
 *
 * STILL hardcoded, deliberately NOT routed through resolveModel:
 *   #5  src/genkit/index.ts (legacy genkit-instance default `model:`) — a module-
 *       init (sync) object literal with no async call point, so it stays a pure code
 *       default like the `genkit.config.ts` singletons above.
 *   + the ~20 `gemini25Flash` consumers (spec §1A) — move when that singleton is
 *     eventually resolved through the registry.
 *   NOTE: embedding call sites (#1,3,22) are deliberately NOT migrated — a swap
 *   must go through the gated re-vectorization flow (spec §6).
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
