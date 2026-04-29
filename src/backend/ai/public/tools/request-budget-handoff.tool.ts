import { ai } from '@/backend/ai/core/config/genkit.config';
import {
    BudgetHandoffRequestSchema,
    BudgetHandoffResponseSchema,
    BudgetHandoffResponse,
} from '../protocols/handoff.schema';
import { SubmitLeadIntakeUseCase } from '@/backend/lead/application/submit-lead-intake.use-case';
import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';
import { LinkSessionToLeadUseCase } from '@/backend/chat/application/link-session-to-lead.usecase';
import { FirestoreConversationRepository } from '@/backend/chat/infrastructure/firestore-conversation-repository';

/**
 * Contexto que el flow del agente público inyecta cuando llama a `ai.generate`:
 *   { imageUrls, locale?, suspicious?, chatSessionId? }
 * Las imágenes ya vienen subidas a Storage. Si hay `chatSessionId`, después
 * del handoff vinculamos la conversación anónima al Lead real.
 */
interface PublicAgentToolContext {
    imageUrls?: string[];
    locale?: string;
    suspicious?: boolean;
    chatSessionId?: string;
    /** Si el visitante ya pasó OTP, usamos su leadId existente para no duplicar. */
    existingLeadId?: string;
    /** Sink mutable: el tool escribe aquí el resultado para que el flow lo recupere. */
    handoffSink?: { result?: { leadId: string; decision: 'qualified' | 'review_required' | 'rejected'; bookingSlots?: BudgetHandoffResponse['bookingSlots'] } };
}

/**
 * Tool usada por el agente comercial público para registrar la solicitud del
 * visitante como un Lead cualificable. NO genera presupuesto: cualifica y
 * notifica al admin, que luego dispara el motor IA desde el dashboard.
 */
export const requestBudgetHandoffTool = ai.defineTool(
    {
        name: 'requestBudgetHandoff',
        description:
            'Llama a esta herramienta cuando hayas recopilado los datos mínimos del usuario ' +
            '(nombre, email, tipo de obra, descripción). Esto registra la solicitud en el ' +
            'sistema y notifica al equipo. NO genera precios.',
        inputSchema: BudgetHandoffRequestSchema,
        outputSchema: BudgetHandoffResponseSchema,
    },
    async (input, toolContext): Promise<BudgetHandoffResponse> => {
        const ctx = (toolContext?.context || {}) as PublicAgentToolContext;
        console.log(`[Handoff Tool] Lead handoff for ${input.leadName} <${input.leadEmail}>`);

        try {
            const useCase = new SubmitLeadIntakeUseCase(new FirestoreLeadRepository());
            const result = await useCase.execute({
                name: input.leadName,
                email: input.leadEmail,
                phone: input.leadPhone || '',
                projectType: input.projectType,
                description: input.projectDescription,
                source: 'chat_public',
                approxSquareMeters: input.approxSquareMeters,
                approxBudget: input.approxBudget,
                postalCode: input.postalCode,
                city: input.city,
                timeline: input.timeline,
                images: ctx.imageUrls || [],
                suspicious: ctx.suspicious || false,
                language: ctx.locale,
                contactMethod: 'email',
                chatSessionId: ctx.chatSessionId,
                existingLeadId: ctx.existingLeadId,
            });

            // Si había sesión de chat anónima, migrarla al lead real para que
            // el admin pueda ver toda la conversación previa al handoff.
            if (ctx.chatSessionId && result.leadId) {
                try {
                    await new LinkSessionToLeadUseCase(new FirestoreConversationRepository()).execute(
                        ctx.chatSessionId,
                        result.leadId,
                        input.leadName
                    );
                } catch (err) {
                    console.error('[Handoff Tool] Falló LinkSessionToLead:', err);
                }
            }

            // Si el lead es qualified, cargamos los próximos slots disponibles
            // para ofrecer agenda inline. Para review_required y rejected no
            // ofrecemos agenda automática (el admin decide).
            let bookingSlots: BudgetHandoffResponse['bookingSlots'] = undefined;
            if (result.decision === 'qualified') {
                try {
                    const { getNextAvailableSlotsAction } = await import('@/actions/agenda/get-next-slots.action');
                    const slotsRes = await getNextAvailableSlotsAction(6, 14);
                    if (slotsRes.success && slotsRes.slots && slotsRes.slots.length > 0) {
                        bookingSlots = slotsRes.slots;
                    }
                } catch (err) {
                    console.error('[Handoff Tool] Error cargando slots:', err);
                }
            }

            const suggestedNextStep =
                result.decision === 'rejected'
                    ? 'Despídete cordialmente del usuario indicándole que en este momento no podemos ' +
                      'atender su tipo de proyecto, pero que guardamos sus datos por si cambian las circunstancias. ' +
                      'No prometas un presupuesto ni contacto futuro.'
                    : result.decision === 'qualified' && bookingSlots
                        ? 'Confirma al usuario que su solicitud ha sido registrada (#' +
                          result.leadId.substring(0, 8) +
                          ') y ofrécele agendar una videollamada de 15 minutos. ' +
                          'Indícale que VERÁ los slots disponibles abajo del mensaje y puede pulsarlos directamente para agendar. ' +
                          'NO listes los slots en el texto — la UI los renderiza como botones.'
                        : 'Confirma al usuario que su solicitud ha sido registrada (#' +
                          result.leadId.substring(0, 8) +
                          ') y que un asesor revisará su caso en breve.';

            // Escribimos el resultado en el sink que el flow lee después.
            // Permite al chat-action acceder a `bookingSlots` y `decision`
            // sin parsear la respuesta de texto del modelo.
            if (ctx.handoffSink) {
                ctx.handoffSink.result = {
                    leadId: result.leadId,
                    decision: result.decision,
                    bookingSlots,
                };
            }

            return {
                success: true,
                leadId: result.leadId,
                decision: result.decision,
                suggestedNextStep,
                bookingSlots,
            };
        } catch (error) {
            console.error('[Handoff Tool] Error registrando el lead:', error);
            return {
                success: false,
                leadId: '',
                decision: 'review_required',
                suggestedNextStep:
                    'Hubo un problema técnico al registrar la solicitud. Pide disculpas al usuario ' +
                    'y sugiere que vuelva a intentarlo en unos minutos.',
            };
        }
    }
);
