import 'server-only';
import type { LeadRepository } from '../domain/lead-repository';
import type { LeadScoreEvent } from '../domain/lead';

export interface AdjustLeadScoreInput {
    leadId: string;
    /** Δ a aplicar al score actual (clampeado a [0, 100]). */
    delta: number;
    /** ID lógico del evento (e.g. 'booking_confirmed', 'budget_sent'). */
    eventId: string;
    /** Razón humana mostrada al admin en el historial. */
    reason: string;
}

/**
 * Ajusta el score de un lead de forma incremental tras un evento del ciclo
 * de venta (booking confirmado, propuesta enviada, email abierto…). Persiste
 * el ajuste en `qualification.scoreHistory` para auditoría.
 *
 * Idempotencia: si ya hay una entrada con el mismo `eventId` en el historial,
 * no aplica el delta de nuevo. Evita doble suma cuando un evento se reintenta.
 *
 * No reevalúa la `decision` — un lead `qualified` no se vuelve `rejected`
 * por subir score, y un lead `review_required` puede seguir necesitando
 * revisión humana aunque suba puntos. Si se quiere autopromoción, eso es
 * trabajo de un use case aparte (RecomputeDecision).
 */
export class AdjustLeadScoreUseCase {
    constructor(private readonly leadRepo: LeadRepository) {}

    async execute(input: AdjustLeadScoreInput): Promise<{
        applied: boolean;
        previousScore?: number;
        newScore?: number;
    }> {
        const lead = await this.leadRepo.findById(input.leadId);
        if (!lead || !lead.qualification) {
            console.warn(`[AdjustLeadScore] Lead ${input.leadId} no encontrado o sin qualification — skip`);
            return { applied: false };
        }

        const history = lead.qualification.scoreHistory || [];
        const alreadyApplied = history.some(h => h.eventId === input.eventId);
        if (alreadyApplied) {
            console.log(`[AdjustLeadScore] Evento ${input.eventId} ya aplicado a ${lead.id} — idempotente, skip`);
            return { applied: false, previousScore: lead.qualification.score };
        }

        const previousScore = lead.qualification.score;
        const newScore = Math.max(0, Math.min(100, previousScore + input.delta));

        const event: LeadScoreEvent = {
            eventId: input.eventId,
            reason: input.reason,
            delta: input.delta,
            score: newScore,
            timestamp: new Date(),
        };

        lead.qualification = {
            ...lead.qualification,
            score: newScore,
            scoreHistory: [...history, event],
        };
        lead.updatedAt = new Date();

        await this.leadRepo.save(lead);
        console.log(
            `[AdjustLeadScore] Lead ${lead.id}: ${previousScore} → ${newScore} (${input.delta > 0 ? '+' : ''}${input.delta}) · ${input.eventId}`
        );

        return { applied: true, previousScore, newScore };
    }
}
