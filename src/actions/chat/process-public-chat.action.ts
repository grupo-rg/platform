'use server';

import { publicCommercialAgent } from '@/backend/ai/public/agents/public-commercial.agent';
import { sanitizeChatHistory } from '@/backend/ai/public/security/chat-history';
import { sanitizeUserText } from '@/backend/shared/security/input-sanitizer';
import { checkRateLimit, RATE_LIMITS } from '@/backend/shared/security/rate-limiter';
import { getClientIp } from '@/backend/shared/security/client-identity';
import { logSecurityEvent } from '@/backend/shared/security/audit-log';
import { applyOutputGuardrails } from '@/backend/shared/security/output-guardrails';
import { GetOrCreateConversationUseCase } from '@/backend/chat/application/get-or-create-conversation.usecase';
import { SendMessageUseCase } from '@/backend/chat/application/send-message.usecase';
import { LinkSessionToLeadUseCase } from '@/backend/chat/application/link-session-to-lead.usecase';
import { FirestoreConversationRepository } from '@/backend/chat/infrastructure/firestore-conversation-repository';
import { FirestoreMessageRepository } from '@/backend/chat/infrastructure/firestore-message-repository';
import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';
import { getLeadSession, setLeadSession } from '@/backend/lead/infrastructure/lead-session';
import { storeLeadUploadBuffer } from '@/backend/lead/infrastructure/lead-uploads';
import { buildConsents, type ConsentDeclaration } from '@/backend/lead/domain/lead-consent';
import { listLeadBookings } from '@/backend/agenda/application/lead-booking-self-service';
import type { Participant } from '@/backend/chat/domain/conversation';

/**
 * Mantiene `lead.intake.imageUrls` al día con todas las fotos que el visitante
 * sube en el chat — incluidas las que llegan en turnos posteriores al handoff
 * inicial. Sólo para el lead de la SESIÓN (o el recién creado por este
 * navegador en este turno).
 */
async function appendImagesToLeadIntake(leadId: string, newImageRefs: string[]): Promise<void> {
    if (newImageRefs.length === 0) return;
    try {
        const leadRepo = new FirestoreLeadRepository();
        const lead = await leadRepo.findById(leadId);
        if (!lead) return;
        const changed = lead.appendIntakeImages(newImageRefs);
        if (changed) await leadRepo.save(lead);
    } catch (err) {
        console.error('[processPublicChatAction] Falló append de imágenes al lead intake:', err);
    }
}

const ANON_NAME = 'Visitante anónimo';
const ASSISTANT_PARTICIPANT: Participant = { id: 'assistant', type: 'assistant', name: 'Asistente IA Grupo RG' };
const SESSION_ID_RE = /^[a-zA-Z0-9-]{8,64}$/;
const MAX_IMAGES_PER_TURN = 5;
const MAX_BASE64_LENGTH = 14 * 1024 * 1024; // ≈ 10 MB binarios

/**
 * Persiste un par mensaje-usuario / mensaje-agente en la `Conversation`.
 * Sin sesión de lead → conversación anónima `anon-{sessionId}` (se migra
 * al lead real en el handoff si el lead es propio).
 */
async function persistChatTurn(params: {
    sessionId: string;
    sessionLeadId?: string;
    leadName?: string;
    userMessage: string;
    agentReply: string;
    imageRefs: string[];
    suspicious: boolean;
}): Promise<void> {
    try {
        const conversationRepo = new FirestoreConversationRepository();
        const messageRepo = new FirestoreMessageRepository();

        const conversationLeadId = params.sessionLeadId
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
            type: params.imageRefs.length > 0 ? 'image' : 'text',
            attachments: params.imageRefs.map(url => ({ type: 'image' as const, url })),
        });

        await sendMessage.execute({
            conversationId: conversation.id,
            sender: ASSISTANT_PARTICIPANT,
            content: params.agentReply,
            type: 'text',
            attachments: [],
        });

        if (params.suspicious) {
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

export interface ProcessPublicChatInput {
    message: string;
    /** Historial del navegador (sólo user/model y texto; se sanea en servidor). */
    history?: unknown;
    /** Imágenes en base64 (sin prefijo data:). */
    files?: string[];
    locale?: string;
    /** UUID de la sesión de chat (sessionStorage). */
    chatSessionId?: string;
    /** Casillas RGPD marcadas en el chat. */
    consent?: ConsentDeclaration;
}

export interface ProcessPublicChatResult {
    success: boolean;
    response?: string;
    error?: string;
    rateLimited?: boolean;
    suspicious?: boolean;
    isComplete?: boolean;
    updatedRequirements?: Record<string, unknown>;
    /** Resultado del handoff SIN identificadores internos. */
    handoff?: {
        decision: 'qualified' | 'review_required' | 'rejected';
        bookingSlots?: { date: string; startTime: string; endTime: string; label: string }[];
        identityUnverified?: boolean;
    };
    availableSlots?: { date: string; startTime: string; endTime: string; label: string }[];
    /** true si hay sesión de lead (cookie) tras este turno → el picker puede reservar. */
    canBook?: boolean;
    /** El agente intentó registrar la solicitud sin la casilla de privacidad. */
    consentRequired?: boolean;
}

/**
 * Chat comercial público.
 *
 * Identidad: SÓLO la cookie firmada `rg_lead_session`. Cualquier
 * `userId`/`existingLeadId`/`leadName` que enviara el cliente antes se ha
 * eliminado de la firma. Rate limit por IP.
 */
export async function processPublicChatAction(input: ProcessPublicChatInput): Promise<ProcessPublicChatResult> {
    try {
        // 0. Rate limit por IP (no por identificadores que controle el cliente).
        const ip = await getClientIp();
        const rateLimit = await checkRateLimit('publicChatMessage', ip, RATE_LIMITS.publicChatMessage);
        if (!rateLimit.allowed) {
            await logSecurityEvent({
                type: 'rate_limit_exceeded',
                identity: ip,
                action: 'publicChatMessage',
                details: { retryAfterSeconds: rateLimit.retryAfterSeconds },
            });
            return {
                success: false,
                error: `Has enviado demasiados mensajes. Vuelve a intentarlo en ${Math.ceil(rateLimit.retryAfterSeconds / 60)} minutos.`,
                rateLimited: true,
            };
        }

        const chatSessionId = input?.chatSessionId && SESSION_ID_RE.test(input.chatSessionId)
            ? input.chatSessionId
            : undefined;
        const locale = typeof input?.locale === 'string' ? input.locale.slice(0, 5) : undefined;

        // 1. Sanitizar el mensaje del usuario.
        const sanitized = sanitizeUserText(String(input?.message ?? ''), 2000);
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
                identity: ip,
                action: 'publicChatMessage',
                snippet: sanitized.text,
                matched: sanitized.matchedPatterns,
            });
        }

        // 2. Identidad desde la cookie firmada.
        const session = await getLeadSession();
        let sessionLeadId: string | undefined;
        let leadName: string | undefined;
        if (session) {
            const lead = await new FirestoreLeadRepository().findById(session.leadId);
            if (lead) {
                sessionLeadId = lead.id;
                leadName = lead.personalInfo.name;
            }
        }

        // 3. Historial saneado (sin 'system', sólo texto, acotado).
        const history = sanitizeChatHistory(input?.history);

        // 4. Imágenes: sólo base64 de imagen real (magic bytes) → almacenamiento
        //    privado. Las URLs http(s) del cliente se ignoran.
        const images: { base64: string; mime: string }[] = [];
        const imageRefs: string[] = [];
        const owner = sessionLeadId || `chat-${chatSessionId || 'anon'}`;
        for (const raw of (Array.isArray(input?.files) ? input.files : []).slice(0, MAX_IMAGES_PER_TURN)) {
            if (typeof raw !== 'string' || !raw || raw.length > MAX_BASE64_LENGTH) continue;
            const b64 = raw.replace(/^data:[^;]+;base64,/, '');
            try {
                const stored = await storeLeadUploadBuffer(Buffer.from(b64, 'base64'), owner);
                if (stored.type.kind !== 'image') continue;
                images.push({ base64: b64, mime: stored.type.mime });
                imageRefs.push(stored.ref);
            } catch (err: any) {
                console.warn('[processPublicChatAction] Imagen descartada:', err?.message || err);
            }
        }

        // 5. Reservas activas del lead de la sesión (contexto para el agente).
        let activeBookings: Array<{ id: string; date: string; timeSlot: string; label: string; status: string }> | undefined;
        if (sessionLeadId) {
            const bookingsRes = await listLeadBookings(sessionLeadId);
            if (bookingsRes.success && bookingsRes.bookings && bookingsRes.bookings.length > 0) {
                activeBookings = bookingsRes.bookings.map(b => ({
                    id: b.id, date: b.date, timeSlot: b.timeSlot, label: b.label, status: b.status,
                }));
            }
        }

        const privacyConsentGranted = input?.consent?.privacyAccepted === true;
        const consents = privacyConsentGranted ? buildConsents(input.consent!, 'chat_public', ip) : [];

        const result = await publicCommercialAgent({
            userMessage: sanitized.text,
            history,
            images,
            attachmentRefs: imageRefs,
            locale,
            suspicious: sanitized.suspicious,
            chatSessionId,
            sessionLeadId,
            sessionVerified: !!session?.verified,
            leadName,
            activeBookings,
            privacyConsentGranted,
            consents,
        });

        // Guardrail final sobre la respuesta del agente.
        const guarded = applyOutputGuardrails(result.reply);
        if (guarded.triggered) {
            await logSecurityEvent({
                type: 'output_guardrail_triggered',
                identity: ip,
                action: 'publicChatMessage',
                snippet: result.reply,
                details: { reason: guarded.reason },
            });
        }

        // 6. Lead recién creado por este navegador → sesión de propietario (v=0).
        const grantedLeadId = !sessionLeadId ? result.handoff?.grantOwnerSessionLeadId : undefined;
        if (grantedLeadId) {
            await setLeadSession(grantedLeadId, false);
        }
        const effectiveLeadId = sessionLeadId || grantedLeadId;

        // 7. Persistir el turno.
        if (chatSessionId || sessionLeadId) {
            await persistChatTurn({
                sessionId: chatSessionId || `lead-${sessionLeadId}`,
                sessionLeadId,
                leadName,
                userMessage: sanitized.text,
                agentReply: guarded.reply,
                imageRefs,
                suspicious: sanitized.suspicious,
            });
        }

        // 8. Append idempotente de imágenes al intake del lead PROPIO.
        if (effectiveLeadId && imageRefs.length > 0 && !result.handoff?.identityUnverified) {
            await appendImagesToLeadIntake(effectiveLeadId, imageRefs);
        }

        return {
            success: true,
            response: guarded.reply,
            isComplete: false,
            updatedRequirements: {},
            suspicious: sanitized.suspicious,
            ...(result.handoff
                ? {
                      handoff: {
                          decision: result.handoff.decision,
                          bookingSlots: result.handoff.identityUnverified ? undefined : result.handoff.bookingSlots,
                          ...(result.handoff.identityUnverified ? { identityUnverified: true } : {}),
                      },
                  }
                : {}),
            availableSlots: result.availableSlots,
            canBook: !!effectiveLeadId,
            ...(result.consentRequired ? { consentRequired: true } : {}),
        };
    } catch (error) {
        console.error("Error processing public client message:", error);
        return { success: false, error: "Failed to process message" };
    }
}
