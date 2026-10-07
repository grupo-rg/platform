import { NextRequest, NextResponse } from 'next/server';
import { FirestoreReEngagementScheduleRepository } from '@/backend/re-engagement/infrastructure/firestore-schedule-repository';
import { ReEngagementMailer } from '@/backend/re-engagement/application/re-engagement-mailer';
import { requireBearerSecret } from '@/app/api/_lib/route-guards';

/**
 * Cron de re-engagement.
 *
 * Recomendado: cron de Vercel cada hora (`vercel.json`). Cada ejecución
 * busca entries due (scheduledAt <= now && !sentAt && !cancelledAt),
 * envía los emails y marca `sentAt`.
 *
 * Seguridad: protegido con `CRON_SECRET` enviado como bearer header
 * `Authorization: Bearer <secret>` (estándar de Vercel Cron). Comparación
 * en tiempo constante y fail-closed: sin `CRON_SECRET` definido, deniega.
 */
export async function GET(request: NextRequest) {
    const denied = requireBearerSecret(request, 'CRON_SECRET');
    if (denied) return denied;

    const repo = new FirestoreReEngagementScheduleRepository();
    const mailer = new ReEngagementMailer();
    const now = new Date();
    const limit = Number(request.nextUrl.searchParams.get('limit') || 50);

    const due = await repo.findDue(now, limit);
    if (due.length === 0) {
        return NextResponse.json({ ok: true, processed: 0, sent: 0 });
    }

    let sent = 0;
    let failed = 0;
    for (const entry of due) {
        const ok = await mailer.send(entry);
        if (ok) {
            entry.sentAt = new Date();
            await repo.save(entry);
            sent++;
        } else {
            failed++;
        }
    }

    return NextResponse.json({
        ok: true,
        processed: due.length,
        sent,
        failed,
    });
}
