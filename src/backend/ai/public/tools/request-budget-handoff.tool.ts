import { ai } from '@/backend/ai/core/config/genkit.config';
import {
    BudgetHandoffRequestSchema,
    BudgetHandoffResponseSchema,
    BudgetHandoffResponse,
} from '../protocols/handoff.schema';
import { SubmitLeadIntakeUseCase } from '@/backend/lead/application/submit-lead-intake.use-case';
import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';
import { hasPrivacyConsent, type LeadConsent } from '@/backend/lead/domain/lead-consent';
import { LinkSessionToLeadUseCase } from '@/backend/chat/application/link-session-to-lead.usecase';
import { FirestoreConversationRepository } from '@/backend/chat/infrastructure/firestore-conversation-repository';
import type { HandoffSink } from '../agents/public-commercial.agent';

/**
 * Contexto que el flow del agente público inyecta en `ai.generate`.
 * `sessionLeadId` viene SIEMPRE de la cookie firmada `rg_lead_session`
 * (resuelta en la server action); nunca del navegador ni del modelo.
 */
interface PublicAgentToolContext {
    attachmentRefs?: string[];
    locale?: string;
    suspicious?: boolean;
    chatSessionId?: string;
    sessionLeadId?: string;
    privacyConsentGranted?: boolean;
    consents?: LeadConsent[];
    handoffSink?: HandoffSink;
}

const CONSENT_REQUIRED_STEP =
    'NO se ha registrado la solicitud: falta que el visitante acepte la política de privacidad. ' +
    'Pídele amablemente que marque la casilla "He leído la política de privacidad" que aparece debajo del chat ' +
    'y que te avise; entonces vuelve a llamar a esta herramienta con los mismos datos.';

/**
 * Tool usada por el agente comercial público para registrar la solicitud del
 * visitante como un Lead cualificable. NO genera presupuesto: cualifica y
 * notifica al admin, que luego dispara el motor IA desde el dashboard.
 *
 * Reglas de identidad (ver SubmitLeadIntakeUseCase):
 *  - Con sesión → se actualiza el lead de la sesión.
 *  - Sin sesión y email nuevo → lead nuevo; la action emite sesión v=0.
 *  - Sin sesión y email EXISTENTE → no se toca ese lead ni se le vincula la
 *    conversación; Deal nuevo marcado `identityUnverified`. Nunca se
 *    devuelve el leadId ajeno al navegador.
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
        const leadRepository = new FirestoreLeadRepository();

        // Identidad: la de la sesión manda sobre lo que diga el modelo.
        let resolvedEmail = input.leadEmail;
        let resolvedName = input.leadName;
        let sessionLeadHasPrivacyConsent = false;
        if (ctx.sessionLeadId) {
            const existing = await leadRepository.findById(ctx.sessionLeadId);
            if (existing) {
                resolvedEmail = existing.personalInfo.email;
                resolvedName = existing.personalInfo.name;
                sessionLeadHasPrivacyConsent = hasPrivacyConsent(existing);
            }
        }

        // Consentimiento de privacidad obligatorio antes del handoff.
        if (!ctx.privacyConsentGranted && !sessionLeadHasPrivacyConsent) {
            if (ctx.handoffSink) ctx.handoffSink.consentRequired = true;
            return { success: false, leadId: '', decision: 'review_required', suggestedNextStep: CONSENT_REQUIRED_STEP };
        }

        if (!resolvedEmail || !resolvedName) {
            console.error('[Handoff Tool] Faltan datos de identidad (session=%s)', ctx.sessionLeadId ? 'yes' : 'no');
            return {
                success: false,
                leadId: '',
                decision: 'review_required',
                suggestedNextStep:
                    'Pide al usuario su nombre y email para poder registrar la solicitud, ' +
                    'y vuelve a llamar a la herramienta cuando los tengas.',
            };
        }

        try {
            const useCase = new SubmitLeadIntakeUseCase(leadRepository);
            const result = await useCase.execute({
                name: resolvedName,
                email: resolvedEmail,
                phone: input.leadPhone || '',
                projectType: input.projectType,
                description: input.projectDescription,
                source: 'chat_public',
                approxSquareMeters: input.approxSquareMeters,
                approxBudget: input.approxBudget,
                postalCode: input.postalCode,
                city: input.city,
                timeline: input.timeline,
                images: ctx.attachmentRefs || [],
                suspicious: ctx.suspicious || false,
                language: ctx.locale,
                contactMethod: 'email',
                chatSessionId: ctx.chatSessionId,
                sessionLeadId: ctx.sessionLeadId,
                consents: ctx.privacyConsentGranted ? ctx.consents : undefined,
            });

            const conversationRepo = new FirestoreConversationRepository();

            if (result.identityUnverified) {
                // Email de un lead existente sin sesión verificada: NO vinculamos
                // la conversación a ese lead. Sólo la marcamos para el admin.
                if (ctx.chatSessionId) {
                    try {
                        const anonId = LinkSessionToLeadUseCase.anonymousLeadId(ctx.chatSessionId);
                        const convs = await conversationRepo.findByLeadId(anonId);
                        for (const conv of convs) {
                            conv.metadata = {
                                ...conv.metadata,
                                identityUnverified: true,
                                claimedEmailMatchesLeadId: result.leadId,
                                pendingVerificationAt: new Date().toISOString(),
                            };
                            await conversationRepo.save(conv);
                        }
                    } catch (err) {
                        console.error('[Handoff Tool] No se pudo marcar la conversación como no verificada:', err);
                    }
                }
                if (ctx.handoffSink) {
                    ctx.handoffSink.result = { leadId: '', decision: result.decision, identityUnverified: true };
                }
                return {
                    success: true,
                    leadId: '',
                    decision: result.decision,
                    suggestedNextStep:
                        'Confirma al usuario que su solicitud ha quedado registrada y que un asesor la revisará. ' +
                        'Indícale que ese email ya tenía una cuenta con nosotros: para ver o gestionar citas desde el chat ' +
                        'tendrá que verificar su email con el código que puede solicitar en "Empieza tu proyecto". ' +
                        'NO ofrezcas agendar en el chat ahora y NO menciones ningún dato de la cuenta existente.',
                };
            }

            // Lead propio (de la sesión o recién creado): vinculamos la
            // conversación anónima para que el admin vea todo el contexto.
            if (ctx.chatSessionId && result.leadId) {
                try {
                    await new LinkSessionToLeadUseCase(conversationRepo).execute(
                        ctx.chatSessionId,
                        result.leadId,
                        resolvedName
                    );
                } catch (err) {
                    console.error('[Handoff Tool] Falló LinkSessionToLead:', err);
                }
            }

            // Si el lead es qualified, cargamos los próximos slots disponibles
            // para ofrecer agenda inline.
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

            const reference = result.leadId.substring(0, 8);
            const suggestedNextStep =
                result.decision === 'rejected'
                    ? 'Despídete cordialmente del usuario indicándole que en este momento no podemos ' +
                      'atender su tipo de proyecto, pero que guardamos sus datos por si cambian las circunstancias. ' +
                      'No prometas un presupuesto ni contacto futuro.'
                    : result.decision === 'qualified' && bookingSlots
                        ? 'Confirma al usuario que su solicitud ha sido registrada (#' + reference +
                          ') y ofrécele agendar una videollamada de 15 minutos. ' +
                          'Indícale que VERÁ los slots disponibles abajo del mensaje y puede pulsarlos directamente para agendar. ' +
                          'NO listes los slots en el texto — la UI los renderiza como botones.'
                        : 'Confirma al usuario que su solicitud ha sido registrada (#' + reference +
                          ') y que un asesor revisará su caso en breve.';

            if (ctx.handoffSink) {
                ctx.handoffSink.result = {
                    leadId: result.leadId,
                    decision: result.decision,
                    bookingSlots,
                    ...(result.canGrantOwnerSession && !ctx.sessionLeadId
                        ? { grantOwnerSessionLeadId: result.leadId }
                        : {}),
                };
            }

            return {
                success: true,
                // El modelo no necesita el id interno (evita que lo repita).
                leadId: '',
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
