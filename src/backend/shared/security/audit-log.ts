import 'server-only';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/backend/shared/infrastructure/firebase/admin-app';

initFirebaseAdminApp();

export type AuditEventType =
    | 'injection_pattern_detected'
    | 'rate_limit_exceeded'
    | 'agent_error'
    | 'safety_filter_blocked'
    | 'output_guardrail_triggered';

export interface AuditEventInput {
    type: AuditEventType;
    /** Identidad del cliente (IP+UA hash, email, userId, etc.). */
    identity?: string;
    /** Acción asociada (e.g. 'publicChatMessage', 'leadIntakeSubmit'). */
    action?: string;
    /** Lead asociado si ya se ha creado. */
    leadId?: string;
    /** Texto que disparó el incidente, recortado. */
    snippet?: string;
    /** Patrones / categorías matched. */
    matched?: string[];
    /** Información extra estructurada. */
    details?: Record<string, any>;
}

/**
 * Persiste un evento de seguridad en `security_audit_logs/{auto-id}`.
 *
 * Fire-and-forget: no propaga errores al caller (el audit log es secundario,
 * no debe romper el flujo principal).
 */
export async function logSecurityEvent(input: AuditEventInput): Promise<void> {
    try {
        const db = getFirestore();
        await db.collection('security_audit_logs').add({
            type: input.type,
            identity: input.identity || null,
            action: input.action || null,
            leadId: input.leadId || null,
            snippet: input.snippet ? input.snippet.slice(0, 500) : null,
            matched: input.matched || [],
            details: input.details || {},
            createdAt: FieldValue.serverTimestamp(),
        });
    } catch (err) {
        console.error('[audit-log] Falló persistencia de evento de seguridad:', err);
    }
}
