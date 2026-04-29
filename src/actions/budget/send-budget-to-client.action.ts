'use server';

import { randomBytes } from 'crypto';
import { revalidatePath } from 'next/cache';
import { BudgetRepositoryFirestore } from '@/backend/budget/infrastructure/budget-repository-firestore';
import { uploadBuffer } from '@/backend/shared/infrastructure/storage/upload-public-image';
import { ResendEmailService } from '@/backend/shared/infrastructure/messaging/resend-email.service';
import { EventDispatcher } from '@/backend/shared/events/event-dispatcher';
import { BudgetSentEvent } from '@/backend/budget/domain/events/budget-sent.event';
import { verifyAuth } from '@/backend/auth/auth.middleware';

interface SendBudgetToClientInput {
    budgetId: string;
    /** PDF generado en cliente (base64 sin el prefijo `data:application/pdf;base64,`). */
    pdfBase64: string;
    /** Mensaje opcional adicional del admin para el cuerpo del email. */
    customMessage?: string;
}

interface SendBudgetToClientResult {
    success: boolean;
    pdfUrl?: string;
    error?: string;
}

const budgetRepo = new BudgetRepositoryFirestore();

const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25 MB — límite blando para evitar abusos.

export async function sendBudgetToClientAction(
    input: SendBudgetToClientInput
): Promise<SendBudgetToClientResult> {
    try {
        const auth = await verifyAuth(true);
        if (!auth) {
            return { success: false, error: 'No autorizado.' };
        }

        const { budgetId, pdfBase64, customMessage } = input;
        if (!budgetId || !pdfBase64) {
            return { success: false, error: 'Faltan budgetId o pdfBase64.' };
        }

        const budget = await budgetRepo.findById(budgetId);
        if (!budget) {
            return { success: false, error: 'Presupuesto no encontrado.' };
        }
        if (budget.status !== 'approved') {
            return {
                success: false,
                error: `El presupuesto debe estar aprobado para enviarlo. Estado actual: ${budget.status}.`,
            };
        }
        const clientEmail = budget.clientSnapshot?.email?.trim();
        const clientName = budget.clientSnapshot?.name?.trim() || 'cliente';
        if (!clientEmail) {
            return { success: false, error: 'El presupuesto no tiene email de cliente asignado.' };
        }

        const cleanedBase64 = pdfBase64.replace(/^data:application\/pdf;base64,/, '');
        const pdfBuffer = Buffer.from(cleanedBase64, 'base64');
        if (pdfBuffer.length === 0) {
            return { success: false, error: 'El PDF recibido está vacío.' };
        }
        if (pdfBuffer.length > MAX_PDF_BYTES) {
            return { success: false, error: 'El PDF excede el tamaño máximo permitido (25 MB).' };
        }

        const objectPath = `budgets/${budgetId}/v${budget.version}-${Date.now()}.pdf`;
        const pdfUrl = await uploadBuffer(pdfBuffer, objectPath, 'application/pdf');

        // Token random opaque para la página pública de aceptación.
        // Se regenera en cada envío — un reenvío invalida el link anterior.
        const acceptanceToken = randomBytes(32).toString('hex');
        const acceptanceTokenIssuedAt = new Date();

        const sentAt = new Date();
        await budgetRepo.updatePartial(budgetId, {
            status: 'sent',
            sentAt,
            pdfUrl,
            acceptanceToken,
            acceptanceTokenIssuedAt,
        } as any);

        const subject = `Tu presupuesto de Grupo RG está listo · ${budget.id.substring(0, 8).toUpperCase()}`;
        const totalFmt = (budget.totalEstimated || budget.costBreakdown?.total || 0).toLocaleString('es-ES', {
            style: 'currency',
            currency: 'EUR',
            maximumFractionDigits: 0,
        });
        const acceptanceUrl = buildAcceptanceUrl(acceptanceToken);
        const html = renderClientEmailHtml({
            clientName,
            pdfUrl,
            totalFmt,
            customMessage,
            acceptanceUrl,
        });

        const emailResult = await ResendEmailService.send({
            to: clientEmail,
            subject,
            html,
            tags: [
                { name: 'budget_id', value: budgetId },
                { name: 'lead_id', value: budget.leadId },
                { name: 'event', value: 'budget_sent' },
            ],
        });
        if (emailResult.error) {
            console.warn(`[send-budget-to-client] Email no enviado a ${clientEmail}:`, emailResult.error);
            // No revertimos: el budget ya está marcado como enviado y el PDF subido. El admin
            // verá el estado y podrá reenviar manualmente. El error vuelve al caller.
            return {
                success: false,
                error: `Email no enviado (${emailResult.error}). El presupuesto se marcó como enviado y el PDF está disponible.`,
                pdfUrl,
            };
        }

        try {
            const { registerEventListeners } = await import('@/backend/shared/events/register-listeners');
            registerEventListeners();
            await EventDispatcher.getInstance().dispatch(
                new BudgetSentEvent(
                    budget.id,
                    budget.leadId,
                    clientEmail,
                    clientName,
                    budget.totalEstimated || budget.costBreakdown?.total || 0,
                    pdfUrl,
                    budget.version
                )
            );
        } catch (err) {
            console.error('[send-budget-to-client] Falló dispatch BudgetSentEvent:', err);
        }

        revalidatePath('/dashboard/admin/budgets');
        revalidatePath(`/dashboard/admin/budgets/${budgetId}/edit`);
        revalidatePath(`/dashboard/leads/${budget.leadId}`);

        return { success: true, pdfUrl };
    } catch (error: any) {
        console.error('[send-budget-to-client] Error:', error);
        return { success: false, error: error?.message || 'Error inesperado al enviar el presupuesto.' };
    }
}

function buildAcceptanceUrl(token: string): string {
    const baseUrl = (
        process.env.NEXT_PUBLIC_SITE_URL || 'https://constructoresenmallorca.com'
    ).replace(/\/$/, '');
    // Locale por defecto 'es'. La página acepta cualquier locale gestionado
    // por next-intl pero por convención los emails al cliente apuntan a 'es'.
    return `${baseUrl}/es/aceptar-presupuesto/${token}`;
}

function renderClientEmailHtml(args: {
    clientName: string;
    pdfUrl: string;
    totalFmt: string;
    customMessage?: string;
    acceptanceUrl: string;
}): string {
    const customBlock = args.customMessage
        ? `<p style="margin: 16px 0; padding: 12px 16px; background: #f8fafc; border-left: 3px solid #94a3b8; border-radius: 4px; color: #334155; font-style: italic;">${escapeHtml(args.customMessage)}</p>`
        : '';

    return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"></head>
<body style="margin:0; padding:24px; background:#f5f5f4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1f2937;">
  <div style="max-width:560px; margin:0 auto; background:white; border-radius:12px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.06);">
    <div style="padding: 24px 28px; background: linear-gradient(135deg, #0f172a 0%, #334155 100%); color: white;">
      <p style="margin:0; font-size:12px; letter-spacing:0.06em; text-transform:uppercase; opacity:0.7;">Grupo RG · Constructores en Mallorca</p>
      <h1 style="margin:8px 0 0; font-size:22px; font-weight:600;">Tu presupuesto está listo</h1>
    </div>
    <div style="padding: 28px;">
      <p style="margin:0 0 12px;">Hola ${escapeHtml(args.clientName)},</p>
      <p style="margin:0 0 16px; line-height:1.55;">
        Hemos preparado el presupuesto de tu obra. Puedes revisarlo, aceptarlo o solicitar cambios desde tu portal personal — el detalle completo del PDF está disponible para descarga.
      </p>
      ${customBlock}
      <div style="margin: 20px 0 12px; padding: 16px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px;">
        <p style="margin:0; font-size:12px; text-transform:uppercase; letter-spacing:0.06em; color:#64748b;">Importe estimado</p>
        <p style="margin:4px 0 0; font-size:24px; font-weight:700; color:#0f172a;">${args.totalFmt}</p>
        <p style="margin:6px 0 0; font-size:12px; color:#64748b;">IVA incluido. Detalle completo en el PDF.</p>
      </div>
      <p style="margin: 24px 0 12px;">
        <a href="${args.acceptanceUrl}" style="display:inline-block; padding: 12px 22px; background:#0f172a; color:white; text-decoration:none; border-radius:8px; font-weight:600;">Revisar y aceptar presupuesto</a>
      </p>
      <p style="margin: 0 0 24px;">
        <a href="${args.pdfUrl}" style="display:inline-block; padding: 10px 18px; background:#ffffff; color:#0f172a; text-decoration:none; border-radius:8px; font-weight:500; border:1px solid #e2e8f0;">Descargar PDF</a>
      </p>
      <p style="margin: 24px 0 0; font-size:12px; color:#64748b; line-height:1.5;">
        Si los botones no funcionan, copia y pega esta dirección en tu navegador:<br>
        <span style="word-break: break-all;">${args.acceptanceUrl}</span>
      </p>
    </div>
    <div style="padding: 16px 28px; background:#f8fafc; border-top:1px solid #e2e8f0; font-size:12px; color:#64748b;">
      Grupo RG · Mallorca · constructoresenmallorca.com
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
