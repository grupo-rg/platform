import 'server-only';
import { randomUUID } from 'crypto';
import type { EventHandler } from '@/backend/shared/events/event-dispatcher';
import type { LeadCreatedEvent } from '@/backend/lead/domain/events/lead-created.event';
import type { ReEngagementScheduleRepository, ReEngagementAttempt } from '../domain/schedule-entry';

/**
 * Programa 3 emails de re-engagement para leads cualificados que no han
 * agendado/recibido propuesta todavía. Si en cualquier momento del flujo
 * el lead avanza (booking confirmado, presupuesto enviado, aceptado),
 * los listeners de cancelación marcan estas entries como `cancelledAt`.
 *
 * Sólo aplica a leads `qualified`. Los `review_required` y `rejected` no
 * entran en la cadena automática — esos los gestiona el admin a mano.
 */
export class ScheduleReEngagementOnLeadCreated implements EventHandler<LeadCreatedEvent> {
    constructor(private readonly repo: ReEngagementScheduleRepository) {}

    async handle(event: LeadCreatedEvent): Promise<void> {
        if (event.decision !== 'qualified') return;
        if (!event.leadEmail) return;

        const offsets: { attempt: ReEngagementAttempt; days: number }[] = [
            { attempt: 1, days: 2 },
            { attempt: 2, days: 5 },
            { attempt: 3, days: 10 },
        ];

        const now = new Date();
        const locale = event.locale || 'es';

        for (const { attempt, days } of offsets) {
            const scheduledAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
            await this.repo.save({
                id: randomUUID(),
                leadId: event.leadId,
                leadEmail: event.leadEmail,
                leadName: event.leadName,
                locale,
                attempt,
                scheduledAt,
                createdAt: now,
            });
        }
        console.log(
            `[ReEngagement] Programados 3 emails para lead ${event.leadId} (qualified) en +2d, +5d, +10d.`
        );
    }
}
