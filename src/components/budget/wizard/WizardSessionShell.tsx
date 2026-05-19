'use client';

/**
 * Thin Client Component that bootstraps the WizardSession and renders the
 * active-job banner above the existing `<BudgetWizardChat />` tree.
 *
 * Why a shell wrapper instead of editing BudgetWizardChat directly: that
 * component is ~1200 lines with deep state coupling. Adding persistence
 * inside it would require threading state through dozens of call sites.
 * The shell pattern lets us reload-survival features incrementally
 * without rewriting the chat.
 *
 * Behaviour:
 *   - On mount, reads ?session=… from the URL and replays it into
 *     localStorage so deep links work (`/dashboard/asistente?session=xxx`).
 *   - Bootstraps a WizardSession entity (`useWizardSession`).
 *   - Renders the active-job banner pulled from `session.lastJobId`.
 *
 * The chat's internal multi-conversation state (`useBudgetWizard` hook)
 * stays unchanged. The shell + WizardSession persists CROSS-RELOAD chat
 * context; the chat hook persists IN-MEMORY context. They cooperate
 * cleanly because they target different lifetimes.
 */

import { useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useWizardSession } from '@/hooks/use-wizard-session';
import { ActiveJobBanner } from './ActiveJobBanner';

export interface WizardSessionShellProps {
    children: React.ReactNode;
    locale: string;
    sessionParam?: string;
}

const STORAGE_KEY = 'lastWizardSessionId';

export function WizardSessionShell({ children, locale, sessionParam }: WizardSessionShellProps) {
    const { user, loading: authLoading } = useAuth();

    // Honour ?session=<id> in the URL by pinning it into localStorage BEFORE
    // the hook runs. Deep links from email / admin tools land directly on the
    // correct session.
    useEffect(() => {
        if (!sessionParam) return;
        try {
            window.localStorage.setItem(STORAGE_KEY, sessionParam);
        } catch {
            // Quota / private mode: still safe; the URL itself is the
            // source of truth and the next render will re-fetch.
        }
    }, [sessionParam]);

    const { session } = useWizardSession({
        enabled: !authLoading && !!user,
        storageKey: STORAGE_KEY,
    });

    return (
        <div className="flex flex-col flex-1 min-h-0">
            {session?.lastJobId && (
                <div className="px-4 pt-4">
                    <ActiveJobBanner
                        jobId={session.lastJobId}
                        budgetId={session.budgetId ?? undefined}
                        locale={locale}
                    />
                </div>
            )}
            <div className="flex-1 min-h-0">{children}</div>
        </div>
    );
}
