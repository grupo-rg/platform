'use client';

/**
 * React hook that mirrors the wizard chat state to Firestore so a reload
 * mid-job doesn't lose the conversation.
 *
 * Flow:
 *   1. On mount, look up `localStorage.lastWizardSessionId`.
 *   2. If present, fetch the session via `getWizardSessionAction`.
 *   3. If absent (or fetch returns null), create a new session.
 *   4. Expose `appendMessage`, `patch` and `setLastJobId` helpers that
 *      mirror their server counterparts and update local state.
 *
 * Why a hook (and not just useEffect inside BudgetWizardChat): the chat
 * component is large and complex; isolating the persistence concern in
 * one place keeps it from leaking everywhere and makes it trivial to
 * unit test.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
    appendWizardMessageAction,
    createWizardSessionAction,
    getWizardSessionAction,
    patchWizardSessionAction,
} from '@/actions/wizard/wizard-session.actions';
import type {
    WizardMessage,
    WizardSession,
    WizardSessionState,
} from '@/backend/budget/domain/wizard-session';
import type { BudgetRequirement } from '@/backend/budget/domain/budget-requirements';

export interface UseWizardSessionOptions {
    /** Pass true once auth is ready so we don't try to create a session
     *  for an anonymous user mid-bootstrap. */
    enabled: boolean;
    /** Optional initial leadId to bind the session to. */
    leadId?: string | null;
    /** Override the localStorage key — useful for tests. */
    storageKey?: string;
}

export interface UseWizardSessionResult {
    session: WizardSession | null;
    sessionId: string | null;
    loading: boolean;
    error: string | null;

    appendMessage: (message: WizardMessage) => Promise<void>;
    patch: (patch: Partial<{
        state: WizardSessionState;
        requirements: Partial<BudgetRequirement>;
        leadId: string | null;
        budgetId: string | null;
        lastJobId: string | null;
        clientName: string;
        budgetTitle: string;
        title: string;
    }>) => Promise<void>;
    /** Force-rehydrate from Firestore. */
    refresh: () => Promise<void>;
    /** Start a fresh session and overwrite the localStorage pointer. */
    restart: () => Promise<void>;
}

const DEFAULT_KEY = 'lastWizardSessionId';

export function useWizardSession(options: UseWizardSessionOptions): UseWizardSessionResult {
    const { enabled, leadId, storageKey = DEFAULT_KEY } = options;
    const [session, setSession] = useState<WizardSession | null>(null);
    const [loading, setLoading] = useState<boolean>(enabled);
    const [error, setError] = useState<string | null>(null);
    const bootstrapping = useRef(false);

    const sessionId = session?.id ?? null;

    const persistSessionId = useCallback((id: string | null) => {
        if (typeof window === 'undefined') return;
        try {
            if (id) window.localStorage.setItem(storageKey, id);
            else window.localStorage.removeItem(storageKey);
        } catch {
            // Quota exceeded / private mode — soft-fail; the session is
            // still stored server-side, the only loss is the lazy
            // bootstrap on next reload.
        }
    }, [storageKey]);

    const readSessionId = useCallback((): string | null => {
        if (typeof window === 'undefined') return null;
        try { return window.localStorage.getItem(storageKey); } catch { return null; }
    }, [storageKey]);

    const createFresh = useCallback(async () => {
        const result = await createWizardSessionAction({ leadId: leadId ?? null });
        if (!result.ok) {
            setError(result.error);
            return null;
        }
        persistSessionId(result.data.id);
        setSession(result.data);
        return result.data;
    }, [leadId, persistSessionId]);

    const bootstrap = useCallback(async () => {
        if (bootstrapping.current) return;
        bootstrapping.current = true;
        setLoading(true);
        setError(null);
        try {
            const stored = readSessionId();
            if (stored) {
                const res = await getWizardSessionAction(stored);
                if (res.ok && res.data) {
                    setSession(res.data);
                    return;
                }
                // Stale pointer — clear it and fall through to create-fresh.
                persistSessionId(null);
            }
            await createFresh();
        } finally {
            setLoading(false);
            bootstrapping.current = false;
        }
    }, [readSessionId, persistSessionId, createFresh]);

    useEffect(() => {
        if (!enabled) {
            setLoading(false);
            return;
        }
        bootstrap();
    }, [enabled, bootstrap]);

    const appendMessage = useCallback(async (message: WizardMessage) => {
        if (!sessionId) return;
        // Optimistic local update so the UI reflects instantly.
        setSession(prev => prev ? { ...prev, messages: [...prev.messages, message], updatedAt: new Date().toISOString() } : prev);
        const res = await appendWizardMessageAction(sessionId, message);
        if (!res.ok) {
            setError(`No se pudo persistir mensaje: ${res.error}`);
        }
    }, [sessionId]);

    const patch = useCallback(async (p: Parameters<UseWizardSessionResult['patch']>[0]) => {
        if (!sessionId) return;
        setSession(prev => prev ? { ...prev, ...p, updatedAt: new Date().toISOString() } : prev);
        const res = await patchWizardSessionAction(sessionId, p);
        if (!res.ok) {
            setError(`No se pudo persistir cambio: ${res.error}`);
        }
    }, [sessionId]);

    const refresh = useCallback(async () => {
        if (!sessionId) return;
        const res = await getWizardSessionAction(sessionId);
        if (res.ok && res.data) setSession(res.data);
    }, [sessionId]);

    const restart = useCallback(async () => {
        persistSessionId(null);
        setSession(null);
        await createFresh();
    }, [createFresh, persistSessionId]);

    return {
        session,
        sessionId,
        loading,
        error,
        appendMessage,
        patch,
        refresh,
        restart,
    };
}
