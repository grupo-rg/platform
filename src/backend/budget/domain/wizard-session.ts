import { BudgetRequirement } from './budget-requirements';

/**
 * Wizard session persisted in `wizard_sessions/{sessionId}`.
 *
 * Designed to survive a full-page reload mid-job. The client keeps the
 * latest sessionId in `localStorage.lastSessionId` and on bootstrap reads
 * it back, then hydrates the chat from Firestore. The active jobId — if
 * any — is mirrored in `lastJobId` so the UI can show a "Tienes un job
 * activo desde hace X min" banner with a deep link to the progress view
 * without having to re-derive the job from the (possibly long) message
 * history.
 */

export type WizardSessionState =
    | 'idle'
    | 'collecting'
    | 'review'
    | 'generating'
    | 'generated';

export interface WizardMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    /** ISO date string. Stored as string so the document round-trips
     *  through Firestore's Timestamp serialiser cleanly. */
    createdAt: string;
    attachments?: string[];
    extractedInfo?: string[];
}

export interface WizardSession {
    /** Firestore doc id. */
    id: string;
    /** Auth uid. The Firestore rule uses this to enforce per-user
     *  isolation — every read/write is gated on
     *  `request.auth.uid == resource.data.uid`. */
    uid: string;
    /** Optional CRM lead id when the session refines a real lead. */
    leadId: string | null;
    /** Budget being generated/refined (if any). */
    budgetId: string | null;
    /** Last pipeline job id this session dispatched. Used to drive the
     *  "active job" banner on reload. */
    lastJobId: string | null;
    messages: WizardMessage[];
    state: WizardSessionState;
    requirements: Partial<BudgetRequirement>;
    /** Optional metadata used at dispatch time (PDF metadata or chat-collected). */
    clientName?: string;
    budgetTitle?: string;
    /** Display title for the conversation list. */
    title?: string;
    /** Either ISO strings or native Dates depending on serialisation
     *  boundary. The repository layer normalises on read/write. */
    createdAt: string | Date;
    updatedAt: string | Date;
}

/**
 * Helper to make a brand-new wizard session entity.
 *
 * Why a factory: keeps default values (state, empty messages, null ids)
 * in one place so server and client agree on the initial shape.
 */
export function newWizardSession(params: { id: string; uid: string; leadId?: string | null }): WizardSession {
    const now = new Date().toISOString();
    return {
        id: params.id,
        uid: params.uid,
        leadId: params.leadId ?? null,
        budgetId: null,
        lastJobId: null,
        messages: [],
        state: 'idle',
        requirements: {},
        createdAt: now,
        updatedAt: now,
    };
}
