'use server';

import { getFirestore } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/backend/shared/infrastructure/firebase/admin-app';
import type { AuditEventType } from '@/backend/shared/security/audit-log';

initFirebaseAdminApp();

export interface SecurityAuditEvent {
    id: string;
    type: AuditEventType;
    identity: string | null;
    action: string | null;
    leadId: string | null;
    snippet: string | null;
    matched: string[];
    details: Record<string, any>;
    createdAt: string | null;
}

export async function getSecurityAuditLogsAction(
    limit: number = 100
): Promise<{ success: boolean; events?: SecurityAuditEvent[]; error?: string }> {
    try {
        const db = getFirestore();
        const snap = await db
            .collection('security_audit_logs')
            .orderBy('createdAt', 'desc')
            .limit(limit)
            .get();

        const events: SecurityAuditEvent[] = snap.docs.map(d => {
            const data = d.data();
            return {
                id: d.id,
                type: data.type,
                identity: data.identity ?? null,
                action: data.action ?? null,
                leadId: data.leadId ?? null,
                snippet: data.snippet ?? null,
                matched: Array.isArray(data.matched) ? data.matched : [],
                details: data.details || {},
                createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
            };
        });

        return { success: true, events };
    } catch (error: any) {
        console.error('getSecurityAuditLogsAction Error:', error);
        return { success: false, error: error?.message || 'Error obteniendo logs' };
    }
}
