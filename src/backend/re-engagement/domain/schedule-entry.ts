/**
 * Una entrada programada de re-engagement: un email que se enviará al lead
 * en `scheduledAt` salvo que se haya cancelado antes (booking confirmado,
 * presupuesto enviado, aceptación, etc.).
 *
 * Modelo simple: cada entry es independiente. Si se quieren 3 emails al
 * mismo lead se persisten 3 entries distintas con `attempt` 1/2/3.
 */
export type ReEngagementAttempt = 1 | 2 | 3;

export interface ReEngagementScheduleEntry {
    id: string;
    leadId: string;
    leadEmail: string;
    leadName: string;
    /** Idioma del lead — usado para elegir plantilla del email. */
    locale: string;
    attempt: ReEngagementAttempt;
    scheduledAt: Date;
    /** Cuando se envió. Si null, sigue pendiente. */
    sentAt?: Date;
    /** Cuando se canceló (porque el lead respondió, agendó, etc.). */
    cancelledAt?: Date;
    cancelledReason?: string;
    /** Razón de cancelación human-readable. */
    createdAt: Date;
}

export interface ReEngagementScheduleRepository {
    save(entry: ReEngagementScheduleEntry): Promise<void>;
    findById(id: string): Promise<ReEngagementScheduleEntry | null>;
    /** Devuelve entries due (scheduledAt <= now && sin sentAt && sin cancelledAt). */
    findDue(now: Date, limit: number): Promise<ReEngagementScheduleEntry[]>;
    /** Cancela todas las entries activas (no enviadas, no canceladas) de un lead. */
    cancelAllForLead(leadId: string, reason: string): Promise<number>;
}
