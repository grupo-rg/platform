'use server';

import { publicCommercialAgent } from '@/backend/ai/public/agents/public-commercial.agent';
import { sanitizeUserText } from '@/backend/shared/security/input-sanitizer';
import { normalizeToPublicUrls } from '@/backend/shared/infrastructure/storage/upload-public-image';
import { checkRateLimit, RATE_LIMITS } from '@/backend/shared/security/rate-limiter';
import { getClientIdentity } from '@/backend/shared/security/client-identity';
import { logSecurityEvent } from '@/backend/shared/security/audit-log';
import { applyOutputGuardrails } from '@/backend/shared/security/output-guardrails';
import { GetOrCreateConversationUseCase } from '@/backend/chat/application/get-or-create-conversation.usecase';
import { SendMessageUseCase } from '@/backend/chat/application/send-message.usecase';
import { LinkSessionToLeadUseCase } from '@/backend/chat/application/link-session-to-lead.usecase';
import { FirestoreConversationRepository } from '@/backend/chat/infrastructure/firestore-conversation-repository';
import { FirestoreMessageRepository } from '@/backend/chat/infrastructure/firestore-message-repository';
import type { Participant } from '@/backend/chat/domain/conversation';

const ANON_NAME = 'Visitante anónimo';
const ASSISTANT_PARTICIPANT: Participant = { id: 'assistant', type: 'assistant', name: 'Agente Comercial Grupo RG' };

/**
 * Persiste un par mensaje-usuario / mensaje-agente en la `Conversation`
 * vinculada a la sessionId. Antes del handoff la conversación está
 * relacionada con `relatedEntity.id = 'anon-' + sessionId`. Cuando el
 * handoff sucede, otro use case (`LinkSessionToLeadUseCase`) actualiza el
 * id al lead real.
 *
 * Fail-safe: si la persistencia falla, no rompe la respuesta del agente.
 */
async function persistChatTurn(params: {
    sessionId: string;
    /** Si existe, persistimos directamente bajo este leadId real (visitante OTP-verificado). */
    existingLeadId?: string;
    leadName?: string;
    userMessage: string;
    agentReply: string;
    imageUrls: string[];
    suspicious: boolean;
}): Promise<void> {
    try {
        const conversationRepo = new FirestoreConversationRepository();
        const messageRepo = new FirestoreMessageRepository();

        // Con leadId real → conversación vinculada desde el primer turn.
        // Sin leadId → conversación anónima por sessionId, se migra en handoff.
        const conversationLeadId = params.existingLeadId
            || LinkSessionToLeadUseCase.anonymousLeadId(params.sessionId);
        const participantName = params.leadName || ANON_NAME;

        const conversation = await new GetOrCreateConversationUseCase(conversationRepo).execute(
            conversationLeadId,
            participantName
        );

        const sendMessage = new SendMessageUseCase(messageRepo, conversationRepo);

        const userParticipant: Participant = { id: conversationLeadId, type: 'lead', name: participantName };

        await sendMessage.execute({
            conversationId: conversation.id,
            sender: userParticipant,
            content: params.userMessage,
            type: params.imageUrls.length > 0 ? 'image' : 'text',
            attachments: params.imageUrls.map(url => ({
                type: 'image' as const,
                url,
            })),
        });

        await sendMessage.execute({
            conversationId: conversation.id,
            sender: ASSISTANT_PARTICIPANT,
            content: params.agentReply,
            type: 'text',
            attachments: [],
        });

        if (params.suspicious) {
            // Marca el mensaje sospechoso en metadata de la conversación
            try {
                const conv = await conversationRepo.findById(conversation.id);
                if (conv) {
                    conv.metadata = { ...conv.metadata, hasSuspiciousMessage: true };
                    await conversationRepo.save(conv);
                }
            } catch {
                // best-effort
            }
        }
    } catch (err) {
        console.error('[processPublicChatAction] Falló persistChatTurn:', err);
    }
}

export async function processPublicChatAction(
    message: string,
    history: any[],
    base64Files?: string[],
    userId?: string,
    locale?: string,
    chatSessionId?: string,
    /** Si el visitante ya pasó OTP, evitamos pedirle nombre/email otra vez. */
    existingLeadId?: string,
    /** Nombre del visitante verificado, para personalizar la conversación. */
    leadName?: string
) {
    try {
        // 0. Rate limit por IP+UA (defensa anti-flood / scraping).
        const identity = userId || (await getClientIdentity());
        const rateLimit = await checkRateLimit('publicChatMessage', identity, RATE_LIMITS.publicChatMessage);
        if (!rateLimit.allowed) {
            await logSecurityEvent({
                type: 'rate_limit_exceeded',
                identity,
                action: 'publicChatMessage',
                details: { retryAfterSeconds: rateLimit.retryAfterSeconds },
            });
            return {
                success: false,
                error: `Has enviado demasiados mensajes. Vuelve a intentarlo en ${Math.ceil(rateLimit.retryAfterSeconds / 60)} minutos.`,
                rateLimited: true,
            };
        }

        // 1. Sanitizar el mensaje del usuario.
        const sanitized = sanitizeUserText(message, 2000);
        if (!sanitized.text) {
            return {
                success: true,
                response: 'No he recibido ningún mensaje. ¿En qué puedo ayudarte?',
                isComplete: false,
                updatedRequirements: {},
            };
        }
        if (sanitized.suspicious) {
            console.warn(`[processPublicChatAction] Patrones de injection detectados: ${sanitized.matchedPatterns.join(', ')}`);
            await logSecurityEvent({
                type: 'injection_pattern_detected',
                identity,
                action: 'publicChatMessage',
                snippet: sanitized.text,
                matched: sanitized.matchedPatterns,
            });
        }

        // 2. Filtrar PDFs (este agente sólo procesa imágenes).
        const candidateImages = (base64Files || []).filter(b64 => b64 && !b64.startsWith('JVBER'));

        // 3. Subir imágenes a Storage y obtener URLs estables.
        const imageUrls = candidateImages.length > 0
            ? await normalizeToPublicUrls(candidateImages, `chat-${chatSessionId || userId || 'anon'}`)
            : [];

        const result = await publicCommercialAgent({
            userMessage: sanitized.text,
            history,
            imageUrls,
            userId,
            locale,
            suspicious: sanitized.suspicious,
            chatSessionId,
            existingLeadId,
            leadName,
        });

        // Guardrail final sobre la respuesta del agente.
        const guarded = applyOutputGuardrails(result.reply);
        if (guarded.triggered) {
            await logSecurityEvent({
                type: 'output_guardrail_triggered',
                identity,
                action: 'publicChatMessage',
                snippet: result.reply,
                details: { reason: guarded.reason },
            });
        }

        // 4. Persistir el turno en la Conversation (si hay sessionId o leadId).
        if (chatSessionId || existingLeadId) {
            await persistChatTurn({
                sessionId: chatSessionId || `lead-${existingLeadId}`,
                existingLeadId,
                leadName,
                userMessage: sanitized.text,
                agentReply: guarded.reply,
                imageUrls,
                suspicious: sanitized.suspicious,
            });
        }

        return {
            success: true,
            response: guarded.reply,
            isComplete: false,
            updatedRequirements: {},
            suspicious: sanitized.suspicious,
            // Reenvía el resultado del handoff al cliente. Si decision='qualified'
            // y hay bookingSlots, el chat renderiza el InlineBookingPicker.
            handoff: result.handoff,
        };
    } catch (error) {
        console.error("Error processing public client message:", error);
        return { success: false, error: "Failed to process message" };
    }
}
