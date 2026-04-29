import { EventHandler } from '../../shared/events/event-dispatcher';
import { LeadCreatedEvent } from '../../lead/domain/events/lead-created.event';
import { DealRepository } from '../domain/deal.repository';
import { Deal } from '../domain/deal';
import { randomUUID } from 'crypto';

const DUPLICATE_WINDOW_MS = 90 * 1000; // 90 segundos

/**
 * Listener CRM: cada solicitud cualificable genera un Deal nuevo en NEW_LEAD.
 *
 * **Diseño**: un mismo Lead puede generar N Deals — cada solicitud es
 * potencialmente una obra distinta (ej. el mismo cliente pide reforma
 * integral en su piso de Palma y meses después una piscina en su casa de
 * Sóller). Por eso NO reusamos el deal abierto: cada `LeadCreatedEvent`
 * crea un Deal con su propio `intakeSnapshot`.
 *
 * **Idempotencia**: para evitar duplicados por doble click o reintento,
 * si en los últimos 90s ya se creó un Deal para este lead con la MISMA
 * descripción, lo skipeamos.
 *
 * Excluye los `rejected` — esos no entran al pipeline.
 */
export class CreateDealOnLeadCreatedUseCase implements EventHandler<LeadCreatedEvent> {
    constructor(private readonly dealRepo: DealRepository) {}

    async handle(event: LeadCreatedEvent): Promise<void> {
        if (event.decision === 'rejected') {
            console.log(`[CRM] Lead ${event.leadId} rechazado, no se crea Deal.`);
            return;
        }

        // Idempotencia: si el deal más reciente del lead se creó hace <90s con
        // la misma descripción, asumimos doble envío y no duplicamos.
        const latestDeal = await this.dealRepo.findByLeadId(event.leadId);
        if (latestDeal) {
            const ageMs = Date.now() - latestDeal.createdAt.getTime();
            const sameDescription = latestDeal.metadata?.intakeSnapshot?.description === event.intakeSnapshot?.description;
            if (ageMs < DUPLICATE_WINDOW_MS && sameDescription) {
                console.log(
                    `[CRM] Lead ${event.leadId}: solicitud duplicada (mismo intake hace ${Math.round(ageMs / 1000)}s). Skip.`
                );
                return;
            }
        }

        // Cada solicitud = oportunidad nueva. Creamos Deal aparte con su propio
        // intake snapshot. El Lead conserva sólo el último intake para inbox/preview;
        // los datos completos viven dentro del Deal.
        const deal = Deal.create(randomUUID(), event.leadId);
        deal.metadata = {
            sourceLeadName: event.leadName,
            sourceLeadEmail: event.leadEmail,
            sourceChannel: event.source,
            qualificationScore: event.score,
            qualificationDecision: event.decision,
            // Snapshot completo del intake — cada deal viaja con su contexto.
            ...(event.intakeSnapshot ? { intakeSnapshot: serializeIntake(event.intakeSnapshot) } : {}),
            ...(latestDeal ? { previousDealId: latestDeal.id, previousDealStage: latestDeal.stage } : {}),
        };
        await this.dealRepo.save(deal);
        console.log(
            `[CRM] Deal ${deal.id} creado en NEW_LEAD para Lead ${event.leadId}` +
                (latestDeal ? ` (oportunidad #${1 + (latestDeal.metadata?.opportunityIndex || 1)} para este lead)` : '')
        );
    }
}

/**
 * Serializa el intake para Firestore: las dates se convierten a ISO strings
 * para evitar pérdidas y mantener compatibilidad con el repo de deals.
 */
function serializeIntake(intake: any): any {
    return {
        ...intake,
        submittedAt: intake.submittedAt instanceof Date
            ? intake.submittedAt.toISOString()
            : intake.submittedAt,
    };
}
