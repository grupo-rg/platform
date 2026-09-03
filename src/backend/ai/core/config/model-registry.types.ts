/**
 * Configurable Model Registry — shared domain types + code defaults (spec §5.1).
 *
 * Phase 0: pure indirection, ZERO behaviour change. Every default below is the
 * CURRENT model id in production, so seeding/reading the registry keeps the
 * pipeline identical until an owner deliberately edits a role via the admin UI.
 *
 * SHARED SCHEMA CONTRACT — the Python swarm (`services/ai-core`) reads the SAME
 * Firestore collection `model_registry` (doc id = role key). Keep this shape in
 * lock-step with `services/ai-core/src/budget/infrastructure/config/model_registry.py`.
 */

export type ModelProvider = 'vertexai' | 'googleai' | 'local';

export type HealthStatus = 'ok' | 'failed' | 'unchecked';

/**
 * Role taxonomy — maps many call sites to a few roles (spec §5.1). The doc id in
 * `model_registry/{role}` is exactly one of these strings, on BOTH stacks.
 */
export type ModelRole =
    | 'embedding'
    | 'pricing_flash'
    | 'pricing_pro'
    | 'chat'
    | 'architect'
    | 'extraction'
    | 'transcription'
    | 'marketing'
    | 'image_gen'
    | 'reranker';

export const MODEL_ROLES: ModelRole[] = [
    'embedding',
    'pricing_flash',
    'pricing_pro',
    'chat',
    'architect',
    'extraction',
    'transcription',
    'marketing',
    'image_gen',
    'reranker',
];

/** The one role that must NOT hot-swap — swapping it invalidates every stored vector (spec §6). */
export const EMBEDDING_ROLE: ModelRole = 'embedding';

/** Default endpoint/region for every role (EU data residency). */
export const DEFAULT_REGION = 'europe-southwest1';

export interface ModelParams {
    temperature: number | null;
    maxOutputTokens: number | null;
    /** 768 for the embedding role ONLY; null everywhere else. */
    outputDimensionality: number | null;
}

export interface ModelHealth {
    status: HealthStatus;
    /** ISO string on read (Firestore Timestamp at rest). */
    checkedAt: string | null;
    latencyMs: number | null;
    error: string | null;
}

/**
 * One document per ROLE. `updatedAt` is an ISO string when read back through the
 * repository (Firestore stores it as a Timestamp).
 */
export interface ModelConfigDoc {
    role: ModelRole;
    provider: ModelProvider;
    modelId: string;
    /** Resolved exact snapshot (e.g. `-preview-MMDD`); null when only an alias is pinned. */
    pinnedVersion: string | null;
    region: string;
    params: ModelParams;
    enabled: boolean;
    /** Code default — never invalid. Used when `enabled:false` or the doc is bad. */
    fallbackModelId: string;
    health: ModelHealth;
    updatedAt: string | null;
    updatedBy: string | null;
    notes: string | null;
}

/** Shape returned by `resolveModel()` — the id in every form a call site may need. */
export interface ResolvedModel {
    /** Bare id, e.g. `gemini-2.5-flash`. */
    id: string;
    /** Genkit plugin reference, `gemini(id)` — for `ai.generate({ model })`. */
    genkitRef: unknown;
    /** Provider-prefixed string, e.g. `vertexai/gemini-2.5-flash`. */
    prefixed: string;
    params: ModelParams;
    region: string;
}

interface RoleDefault {
    provider: ModelProvider;
    modelId: string;
    region: string;
    params: ModelParams;
    notes: string;
}

/**
 * CODE DEFAULTS = the CURRENT production ids (Phase-0 seed). `resolveModel()`
 * falls back to these on any error, so the pipeline can never hard-fail on bad
 * config, and the seed script writes exactly these values.
 */
export const MODEL_DEFAULTS: Record<ModelRole, RoleDefault> = {
    embedding: {
        provider: 'vertexai',
        modelId: 'gemini-embedding-001',
        region: DEFAULT_REGION,
        params: { temperature: null, maxOutputTokens: null, outputDimensionality: 768 },
        notes: 'EU residency. 768-d (MRL truncated) to fit the Firestore ≤2048 vector cap. Swapping requires full re-vectorization (spec §6).',
    },
    pricing_flash: {
        provider: 'vertexai',
        modelId: 'gemini-2.5-flash',
        region: DEFAULT_REGION,
        params: { temperature: 0.2, maxOutputTokens: null, outputDimensionality: null },
        notes: 'Swarm pricing — Flash tier.',
    },
    pricing_pro: {
        provider: 'vertexai',
        modelId: 'gemini-2.5-pro',
        region: DEFAULT_REGION,
        params: { temperature: 0.2, maxOutputTokens: null, outputDimensionality: null },
        notes: 'Swarm pricing — Pro tier. Opt-in (ENABLE_PRO_PRICING); off in prod.',
    },
    chat: {
        provider: 'vertexai',
        modelId: 'gemini-2.5-flash',
        region: DEFAULT_REGION,
        params: { temperature: 0.2, maxOutputTokens: null, outputDimensionality: null },
        notes: 'Triage / commercial chat / wizard / demo / client-requirements.',
    },
    architect: {
        provider: 'vertexai',
        modelId: 'gemini-2.5-flash',
        region: DEFAULT_REGION,
        params: { temperature: 0.1, maxOutputTokens: null, outputDimensionality: null },
        notes: 'Chapter decomposition (construction architect).',
    },
    extraction: {
        provider: 'vertexai',
        modelId: 'gemini-2.5-flash',
        region: DEFAULT_REGION,
        params: { temperature: 0.1, maxOutputTokens: null, outputDimensionality: null },
        notes: 'Invoice / attachments / measurements / price-book PDF parsing.',
    },
    transcription: {
        provider: 'vertexai',
        modelId: 'gemini-2.5-flash',
        region: DEFAULT_REGION,
        params: { temperature: 0.2, maxOutputTokens: null, outputDimensionality: null },
        notes: 'Audio transcription.',
    },
    marketing: {
        provider: 'vertexai',
        modelId: 'gemini-2.5-flash',
        region: DEFAULT_REGION,
        params: { temperature: 0.7, maxOutputTokens: null, outputDimensionality: null },
        notes: 'Marketing email rewrite.',
    },
    image_gen: {
        provider: 'vertexai',
        modelId: 'gemini-2.5-flash-image',
        region: DEFAULT_REGION,
        params: { temperature: null, maxOutputTokens: null, outputDimensionality: null },
        notes: 'Renovation render image generation (non-critical path).',
    },
    reranker: {
        provider: 'local',
        modelId: 'BAAI/bge-reranker-v2-m3',
        region: DEFAULT_REGION,
        params: { temperature: null, maxOutputTokens: null, outputDimensionality: null },
        notes: 'Local cross-encoder (sentence-transformers, pre-downloaded in the Python Dockerfile). Not a Vertex model — swap is a container concern.',
    },
};

/**
 * Full default document for a role — health `unchecked`, `fallbackModelId` == the
 * current id, `enabled:true`. Used as the resolveModel fallback and as the seed.
 */
export function buildDefaultDoc(role: ModelRole): ModelConfigDoc {
    const d = MODEL_DEFAULTS[role];
    return {
        role,
        provider: d.provider,
        modelId: d.modelId,
        pinnedVersion: null,
        region: d.region,
        params: { ...d.params },
        enabled: true,
        fallbackModelId: d.modelId,
        health: { status: 'unchecked', checkedAt: null, latencyMs: null, error: null },
        updatedAt: null,
        updatedBy: 'code-default',
        notes: d.notes,
    };
}

export function isModelRole(value: string): value is ModelRole {
    return (MODEL_ROLES as string[]).includes(value);
}
