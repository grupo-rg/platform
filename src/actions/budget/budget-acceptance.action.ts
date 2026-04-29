'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { BudgetRepositoryFirestore } from '@/backend/budget/infrastructure/budget-repository-firestore';
import { EventDispatcher } from '@/backend/shared/events/event-dispatcher';
import { BudgetAcceptedEvent } from '@/backend/budget/domain/events/budget-accepted.event';
import { ResendEmailService } from '@/backend/shared/infrastructure/messaging/resend-email.service';
import { sanitizeUserText } from '@/backend/shared/security/input-sanitizer';

const budgetRepo = new BudgetRepositoryFirestore();

/**
 * Datos públicos del budget visibles desde la página de aceptación. NO
 * exponemos clientSnapshot completo ni intake — sólo lo necesario para
 * que el cliente entienda qué está aceptando.
 */
export interface PublicBudgetView {
    id: string;
    refShort: string;
    clientName: string;
    totalEstimated: number;
    pdfUrl?: string;
    sentAt?: string;
    status: 'sent' | 'approved' | 'pending_review' | 'draft';
    /** Si ya hay aceptación o cambio solicitado, lo reflejamos para evitar UI incoherente. */
    acceptedAt?: string;
    acceptedBy?: string;
    pendingChangeRequestAt?: string;
}

interface ActionResult<T = unknown> {
    success: boolean;
    error?: string;
    data?: T;
}

async function getClientIp(): Promise<string | undefined> {
    try {
        const h = await headers();
        const forwarded = h.get('x-forwarded-for');
        if (forwarded) return forwarded.split(',')[0]?.trim();
        return h.get('x-real-ip') || undefined;
    } catch {
        return undefined;
    }
}

async function getUserAgent(): Promise<string | undefined> {
    try {
        const h = await headers();
        return h.get('user-agent') || undefined;
    } catch {
        return undefined;
    }
}

/**
 * Resuelve un token a la vista pública del presupuesto. Devuelve null si
 * el token no existe (no exponemos detalles de error al cliente).
 */
export async function getBudgetByAcceptanceTokenAction(
    token: string
): Promise<ActionResult<PublicBudgetView>> {
    try {
        if (!token || typeof token !== 'string' || token.length < 32) {
            return { success: false, error: 'Token inválido' };
        }
        const budget = await budgetRepo.findByAcceptanceToken(token);
        if (!budget) {
            return { success: false, error: 'Token inválido o expirado' };
        }

        const lastChangeRequest = budget.changeRequests?.length
            ? budget.changeRequests[budget.changeRequests.length - 1]
            : undefined;

        return {
            success: true,
            data: {
                id: budget.id,
                refShort: budget.id.substring(0, 8).toUpperCase(),
                clientName: budget.clientSnapshot?.name || 'Cliente',
                totalEstimated:
                    budget.costBreakdown?.total || budget.totalEstimated || 0,
                pdfUrl: budget.pdfUrl,
                sentAt: budget.sentAt ? budget.sentAt.toISOString() : undefined,
                status: budget.status,
                acceptedAt: budget.acceptance?.acceptedAt?.toISOString(),
                acceptedBy: budget.acceptance?.signatureName,
                pendingChangeRequestAt: lastChangeRequest?.requestedAt?.toISOString(),
            },
        };
    } catch (err: any) {
        console.error('[getBudgetByAcceptanceToken] Error:', err);
        return { success: false, error: 'Error al recuperar el presupuesto' };
    }
}

/**
 * Cliente firma y acepta el presupuesto. Mueve status del budget a
 * `approved` (firma final) y dispara `BudgetAcceptedEvent` que mueve el
 * deal a CLOSED_WON y suma score al lead.
 *
 * NOTA: el budget ya está en `sent` en este punto. Lo dejamos en `sent`
 * + acceptance — el "approved" del dominio significa "aprobado por el
 * admin para enviar". Si se quiere un estado nuevo `accepted`, sería un
 * cambio de tipo. Por ahora la presencia de `acceptance` indica el cierre.
 */
export async function acceptBudgetAction(input: {
    token: string;
    signatureName: string;
}): Promise<ActionResult<{ refShort: string }>> {
    try {
        const token = (input.token || '').trim();
        const sanitizedName = sanitizeUserText(input.signatureName || '', 120);
        const signatureName = sanitizedName.text.trim();

        if (!token) return { success: false, error: 'Token requerido' };
        if (signatureName.length < 2) {
            return { success: false, error: 'Indica tu nombre completo para firmar.' };
        }

        const budget = await budgetRepo.findByAcceptanceToken(token);
        if (!budget) {
            return { success: false, error: 'Token inválido o expirado' };
        }
        if (budget.acceptance) {
            return {
                success: false,
                error: 'Este presupuesto ya fue aceptado anteriormente.',
            };
        }

        const ipAddress = await getClientIp();
        const userAgent = await getUserAgent();
        const acceptedAt = new Date();

        const acceptance = {
            acceptedAt,
            signatureName,
            ...(ipAddress ? { ipAddress } : {}),
            ...(userAgent ? { userAgent } : {}),
        };

        await budgetRepo.updatePartial(budget.id, { acceptance } as any);

        try {
            const { registerEventListeners } = await import('@/backend/shared/events/register-listeners');
            registerEventListeners();
            await EventDispatcher.getInstance().dispatch(
                new BudgetAcceptedEvent(
                    budget.id,
                    budget.leadId,
                    budget.clientSnapshot?.email || '',
                    budget.clientSnapshot?.name || 'Cliente',
                    budget.costBreakdown?.total || budget.totalEstimated || 0,
                    signatureName,
                    acceptedAt,
                    ipAddress
                )
            );
        } catch (err) {
            console.error('[acceptBudget] Falló dispatch BudgetAcceptedEvent:', err);
        }

        // Notificación al admin
        await notifyAdminOfAcceptance({
            budgetId: budget.id,
            clientName: budget.clientSnapshot?.name || 'Cliente',
            signatureName,
            totalEstimated: budget.costBreakdown?.total || budget.totalEstimated || 0,
            ipAddress,
        });

        revalidatePath(`/dashboard/leads/${budget.leadId}`);
        revalidatePath(`/dashboard/admin/budgets/${budget.id}/edit`);

        return {
            success: true,
            data: { refShort: budget.id.substring(0, 8).toUpperCase() },
        };
    } catch (err: any) {
        console.error('[acceptBudget] Error:', err);
        return { success: false, error: 'Error al registrar la aceptación' };
    }
}

/**
 * Cliente solicita cambios al presupuesto desde la página pública. Añade
 * la entrada al historial, vuelve el budget a `pending_review` (para que
 * el admin lo edite), y notifica al admin por email.
 */
export async function requestBudgetChangesAction(input: {
    token: string;
    comment: string;
}): Promise<ActionResult> {
    try {
        const token = (input.token || '').trim();
        const sanitizedComment = sanitizeUserText(input.comment || '', 2000);
        const comment = sanitizedComment.text.trim();

        if (!token) return { success: false, error: 'Token requerido' };
        if (comment.length < 10) {
            return { success: false, error: 'Describe brevemente qué cambios necesitas (mín. 10 caracteres).' };
        }

        const budget = await budgetRepo.findByAcceptanceToken(token);
        if (!budget) {
            return { success: false, error: 'Token inválido o expirado' };
        }
        if (budget.acceptance) {
            return { success: false, error: 'El presupuesto ya fue aceptado y no admite cambios.' };
        }

        const ipAddress = await getClientIp();
        const newRequest = {
            requestedAt: new Date(),
            comment,
            ...(ipAddress ? { ipAddress } : {}),
        };

        const changeRequests = [...(budget.changeRequests || []), newRequest];

        await budgetRepo.updatePartial(budget.id, {
            changeRequests,
            status: 'pending_review',
        } as any);

        await notifyAdminOfChangeRequest({
            budgetId: budget.id,
            clientName: budget.clientSnapshot?.name || 'Cliente',
            comment,
            ipAddress,
        });

        revalidatePath(`/dashboard/leads/${budget.leadId}`);
        revalidatePath(`/dashboard/admin/budgets/${budget.id}/edit`);

        return { success: true };
    } catch (err: any) {
        console.error('[requestBudgetChanges] Error:', err);
        return { success: false, error: 'Error al registrar la solicitud' };
    }
}

async function notifyAdminOfAcceptance(args: {
    budgetId: string;
    clientName: string;
    signatureName: string;
    totalEstimated: number;
    ipAddress?: string;
}) {
    const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL;
    if (!adminEmail) return;
    const totalFmt = args.totalEstimated.toLocaleString('es-ES', {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: 0,
    });
    const html = `<!doctype html><html><body style="font-family:sans-serif;color:#1f2937;padding:24px;">
        <h2 style="color:#059669;">✅ Presupuesto aceptado por el cliente</h2>
        <p><b>Cliente:</b> ${escapeHtml(args.clientName)}</p>
        <p><b>Firmado por:</b> ${escapeHtml(args.signatureName)}</p>
        <p><b>Importe:</b> ${totalFmt}</p>
        <p><b>Ref:</b> #${args.budgetId.substring(0, 8).toUpperCase()}</p>
        ${args.ipAddress ? `<p style="font-size:12px;color:#64748b;">IP de aceptación: ${escapeHtml(args.ipAddress)}</p>` : ''}
        <p style="margin-top:24px;">El deal CRM se ha movido automáticamente a <b>Ganado</b>.</p>
        </body></html>`;
    await ResendEmailService.send({
        to: adminEmail,
        subject: `🎉 Presupuesto aceptado · ${args.clientName} · ${totalFmt}`,
        html,
        tags: [
            { name: 'budget_id', value: args.budgetId },
            { name: 'event', value: 'budget_accepted' },
        ],
    });
}

async function notifyAdminOfChangeRequest(args: {
    budgetId: string;
    clientName: string;
    comment: string;
    ipAddress?: string;
}) {
    const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL;
    if (!adminEmail) return;
    const html = `<!doctype html><html><body style="font-family:sans-serif;color:#1f2937;padding:24px;">
        <h2 style="color:#d97706;">✏️ Cliente solicita cambios al presupuesto</h2>
        <p><b>Cliente:</b> ${escapeHtml(args.clientName)}</p>
        <p><b>Ref:</b> #${args.budgetId.substring(0, 8).toUpperCase()}</p>
        <p><b>Comentario:</b></p>
        <blockquote style="border-left:3px solid #d97706;padding-left:12px;color:#78350f;background:#fffbeb;padding:12px;border-radius:4px;">${escapeHtml(args.comment).replace(/\n/g, '<br>')}</blockquote>
        ${args.ipAddress ? `<p style="font-size:12px;color:#64748b;">IP del cliente: ${escapeHtml(args.ipAddress)}</p>` : ''}
        <p style="margin-top:24px;">El presupuesto volvió a estado <b>Pre-presupuesto</b> para que lo edites y reenvíes.</p>
        </body></html>`;
    await ResendEmailService.send({
        to: adminEmail,
        subject: `✏️ Cambios solicitados · ${args.clientName} · #${args.budgetId.substring(0, 8).toUpperCase()}`,
        html,
        tags: [
            { name: 'budget_id', value: args.budgetId },
            { name: 'event', value: 'change_request' },
        ],
    });
}

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
