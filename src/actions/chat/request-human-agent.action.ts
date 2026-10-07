'use server';

import { GetOrCreateConversationUseCase } from '@/backend/chat/application/get-or-create-conversation.usecase';
import { LinkSessionToLeadUseCase } from '@/backend/chat/application/link-session-to-lead.usecase';
import { FirestoreConversationRepository } from '@/backend/chat/infrastructure/firestore-conversation-repository';
import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';
import { getLeadSession } from '@/backend/lead/infrastructure/lead-session';
import { ResendEmailService } from '@/backend/shared/infrastructure/messaging/resend-email.service';
import { checkRateLimit, RATE_LIMITS } from '@/backend/shared/security/rate-limiter';
import { getClientIp } from '@/backend/shared/security/client-identity';
import { escapeHtml } from '@/backend/shared/security/html-escape';

const SESSION_ID_RE = /^[a-zA-Z0-9-]{8,64}$/;

/**
 * "Hablar con una persona" (AI Act art. 50 + buena práctica): deja la
 * conversación del chat público en `waiting_for_admin` y avisa al admin por
 * email. No devuelve datos internos.
 */
export async function requestHumanAgentAction(params: {
    chatSessionId?: string;
    /** Nota opcional del visitante (p. ej. "prefiero que me llaméis"). */
    note?: string;
}): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
        const ip = await getClientIp();
        const rl = await checkRateLimit('publicHumanRequest', ip, RATE_LIMITS.publicHumanRequest);
        if (!rl.allowed) {
            return { success: false, error: 'Ya hemos recibido tu solicitud. Un asesor te contactará en breve.' };
        }

        const session = await getLeadSession();
        const chatSessionId = params?.chatSessionId && SESSION_ID_RE.test(params.chatSessionId)
            ? params.chatSessionId
            : undefined;
        if (!session && !chatSessionId) {
            return { success: false, error: 'No se pudo identificar la conversación.' };
        }

        let leadName: string | undefined;
        let leadEmail: string | undefined;
        if (session) {
            const lead = await new FirestoreLeadRepository().findById(session.leadId);
            leadName = lead?.personalInfo.name;
            leadEmail = lead?.personalInfo.email;
        }

        const conversationRepo = new FirestoreConversationRepository();
        const ownerId = session?.leadId || LinkSessionToLeadUseCase.anonymousLeadId(chatSessionId!);
        const conversation = await new GetOrCreateConversationUseCase(conversationRepo).execute(
            ownerId,
            leadName || 'Visitante anónimo'
        );
        conversation.setStatus('waiting_for_admin');
        conversation.metadata = {
            ...conversation.metadata,
            humanRequestedAt: new Date().toISOString(),
            ...(params?.note ? { humanRequestNote: String(params.note).slice(0, 500) } : {}),
        };
        conversation.unreadCount = (conversation.unreadCount || 0) + 1;
        await conversationRepo.save(conversation);

        const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL;
        if (adminEmail) {
            const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:9002';
            const link = session ? `${baseUrl}/dashboard/leads/${encodeURIComponent(session.leadId)}` : `${baseUrl}/dashboard`;
            try {
                await ResendEmailService.send({
                    to: adminEmail,
                    subject: '[Grupo RG] Un visitante del chat pide hablar con una persona',
                    html: `
                        <div style="font-family: Arial, sans-serif; color:#1a1a1a; line-height:1.6;">
                            <h2>Petición de atención humana</h2>
                            <p>Un visitante del chat público ha pulsado <strong>"Hablar con una persona"</strong>.</p>
                            <ul>
                                <li><strong>Nombre:</strong> ${escapeHtml(leadName || 'Anónimo (sin verificar)')}</li>
                                ${leadEmail ? `<li><strong>Email:</strong> ${escapeHtml(leadEmail)}</li>` : ''}
                                <li><strong>Conversación:</strong> <code>${escapeHtml(conversation.id)}</code></li>
                                ${params?.note ? `<li><strong>Nota:</strong> ${escapeHtml(String(params.note).slice(0, 500))}</li>` : ''}
                            </ul>
                            <p><a href="${escapeHtml(link)}">Abrir en el dashboard</a></p>
                        </div>`,
                    tags: [{ name: 'category', value: 'human_handoff_request' }],
                });
            } catch (err) {
                console.error('[requestHumanAgentAction] Email al admin falló (no crítico):', err);
            }
        }

        return {
            success: true,
            message: 'Hemos avisado a nuestro equipo. Una persona revisará la conversación y te contactará lo antes posible.',
        };
    } catch (error) {
        console.error('[requestHumanAgentAction] Error:', error);
        return { success: false, error: 'No se pudo avisar al equipo. Inténtalo de nuevo o llámanos.' };
    }
}
