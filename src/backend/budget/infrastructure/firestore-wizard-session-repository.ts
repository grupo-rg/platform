import { adminFirestore } from '@/backend/shared/infrastructure/firebase/admin-app';
import { FieldValue } from 'firebase-admin/firestore';
import {
    WizardSession,
    WizardMessage,
    WizardSessionState,
} from '../domain/wizard-session';
import type { BudgetRequirement } from '../domain/budget-requirements';

const COLLECTION = 'wizard_sessions';

function toIso(value: any): string {
    if (!value) return new Date().toISOString();
    if (typeof value === 'string') return value;
    if (value instanceof Date) return value.toISOString();
    if (typeof value.toDate === 'function') return (value.toDate() as Date).toISOString();
    return new Date().toISOString();
}

function normaliseMessage(raw: any): WizardMessage {
    return {
        id: raw.id ?? String(Math.random()),
        role: raw.role || 'assistant',
        content: raw.content || '',
        createdAt: toIso(raw.createdAt),
        attachments: Array.isArray(raw.attachments) ? raw.attachments : undefined,
        extractedInfo: Array.isArray(raw.extractedInfo) ? raw.extractedInfo : undefined,
    };
}

function fromDoc(data: any, id: string): WizardSession {
    return {
        id,
        uid: data.uid,
        leadId: data.leadId ?? null,
        budgetId: data.budgetId ?? null,
        lastJobId: data.lastJobId ?? null,
        messages: Array.isArray(data.messages) ? data.messages.map(normaliseMessage) : [],
        state: (data.state as WizardSessionState) || 'idle',
        requirements: data.requirements || {},
        clientName: data.clientName,
        budgetTitle: data.budgetTitle,
        title: data.title,
        createdAt: toIso(data.createdAt),
        updatedAt: toIso(data.updatedAt),
    };
}

/**
 * Firestore-backed repository for `WizardSession` entities. Always
 * accessed via the admin SDK from server actions; the corresponding
 * Firestore rule allows the owner to READ their own session for direct
 * client-side subscription (used for the "active job" banner so we don't
 * eat a round-trip on every page bootstrap).
 */
export class FirestoreWizardSessionRepository {
    async create(session: WizardSession): Promise<WizardSession> {
        const ref = adminFirestore.collection(COLLECTION).doc(session.id);
        const payload = {
            ...session,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        };
        await ref.set(payload);
        const snap = await ref.get();
        return fromDoc(snap.data(), snap.id);
    }

    async findById(sessionId: string): Promise<WizardSession | null> {
        const snap = await adminFirestore.collection(COLLECTION).doc(sessionId).get();
        if (!snap.exists) return null;
        return fromDoc(snap.data(), snap.id);
    }

    async findByUid(uid: string, limit: number = 20): Promise<WizardSession[]> {
        const snap = await adminFirestore
            .collection(COLLECTION)
            .where('uid', '==', uid)
            .orderBy('updatedAt', 'desc')
            .limit(limit)
            .get();
        return snap.docs.map(d => fromDoc(d.data(), d.id));
    }

    /**
     * Append a message to the session. Uses `arrayUnion` so two writes
     * with the same `WizardMessage` id will not create duplicates — the
     * UI can therefore optimistically retry on transient errors.
     */
    async appendMessage(sessionId: string, message: WizardMessage): Promise<void> {
        const ref = adminFirestore.collection(COLLECTION).doc(sessionId);
        // We can't use arrayUnion with an object that contains a Date — it
        // serialises identically though, so we cast createdAt to ISO before
        // unioning to maximise the dedupe potential.
        const safeMessage = { ...message, createdAt: toIso(message.createdAt) };
        await ref.update({
            messages: FieldValue.arrayUnion(safeMessage),
            updatedAt: FieldValue.serverTimestamp(),
        });
    }

    async patch(
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
    ): Promise<void> {
        const ref = adminFirestore.collection(COLLECTION).doc(sessionId);
        await ref.update({
            ...patch,
            updatedAt: FieldValue.serverTimestamp(),
        });
    }

    async delete(sessionId: string): Promise<void> {
        await adminFirestore.collection(COLLECTION).doc(sessionId).delete();
    }
}
