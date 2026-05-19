'use server';

/**
 * Server Actions for the wizard-session persistence layer.
 *
 * The wizard UI is now stateful across reloads: every message and state
 * transition is mirrored to `wizard_sessions/{sessionId}`. The client
 * keeps `localStorage.lastSessionId` as a cheap pointer; on bootstrap it
 * calls `getWizardSessionAction(id)` to rehydrate.
 *
 * All actions are gated on `verifyAuth(false)` — any signed-in user can
 * own a wizard session (no admin requirement). The repository enforces
 * `session.uid === auth.uid` on every read so leaked session ids can't
 * be replayed across users.
 */

import { v4 as uuidv4 } from 'uuid';
import { verifyAuth } from '@/backend/auth/auth.middleware';
import { FirestoreWizardSessionRepository } from '@/backend/budget/infrastructure/firestore-wizard-session-repository';
import {
    WizardMessage,
    WizardSession,
    WizardSessionState,
    newWizardSession,
} from '@/backend/budget/domain/wizard-session';
import type { BudgetRequirement } from '@/backend/budget/domain/budget-requirements';

const repo = new FirestoreWizardSessionRepository();

export interface CreateWizardSessionInput {
    leadId?: string | null;
    title?: string;
}

export type WizardActionResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: string };

async function authedOrFail<T>(work: (uid: string) => Promise<T>): Promise<WizardActionResult<T>> {
    const auth = await verifyAuth(false);
    if (!auth) return { ok: false, error: 'unauthenticated' };
    try {
        const data = await work(auth.userId);
        return { ok: true, data };
    } catch (err: any) {
        console.error('[wizard-session action] error', err);
        return { ok: false, error: err?.message || 'unknown_error' };
    }
}

export async function createWizardSessionAction(
    input: CreateWizardSessionInput = {},
): Promise<WizardActionResult<WizardSession>> {
    return authedOrFail(async uid => {
        const session = newWizardSession({
            id: uuidv4(),
            uid,
            leadId: input.leadId ?? null,
        });
        if (input.title) (session as WizardSession).title = input.title;
        return repo.create(session);
    });
}

export async function getWizardSessionAction(
    sessionId: string,
): Promise<WizardActionResult<WizardSession | null>> {
    return authedOrFail(async uid => {
        const session = await repo.findById(sessionId);
        if (!session) return null;
        if (session.uid !== uid) {
            // Don't leak whether the session exists for another uid.
            return null;
        }
        return session;
    });
}

export async function listWizardSessionsAction(
    limit: number = 20,
): Promise<WizardActionResult<WizardSession[]>> {
    return authedOrFail(async uid => repo.findByUid(uid, limit));
}

export async function appendWizardMessageAction(
    sessionId: string,
    message: WizardMessage,
): Promise<WizardActionResult<true>> {
    const res = await authedOrFail(async uid => {
        const existing = await repo.findById(sessionId);
        if (!existing || existing.uid !== uid) {
            throw new Error('session_not_found_or_forbidden');
        }
        await repo.appendMessage(sessionId, message);
        return true as const;
    });
    return res as WizardActionResult<true>;
}

export async function patchWizardSessionAction(
    sessionId: string,
    patch: Partial<{
        state: WizardSessionState;
        requirements: Partial<BudgetRequirement>;
        leadId: string | null;
        budgetId: string | null;
        lastJobId: string | null;
        clientName: string;
        budgetTitle: string;
        title: string;
    }>,
): Promise<WizardActionResult<true>> {
    const res = await authedOrFail(async uid => {
        const existing = await repo.findById(sessionId);
        if (!existing || existing.uid !== uid) {
            throw new Error('session_not_found_or_forbidden');
        }
        await repo.patch(sessionId, patch);
        return true as const;
    });
    return res as WizardActionResult<true>;
}

export async function deleteWizardSessionAction(
    sessionId: string,
): Promise<WizardActionResult<true>> {
    const res = await authedOrFail(async uid => {
        const existing = await repo.findById(sessionId);
        if (!existing || existing.uid !== uid) {
            throw new Error('session_not_found_or_forbidden');
        }
        await repo.delete(sessionId);
        return true as const;
    });
    return res as WizardActionResult<true>;
}
