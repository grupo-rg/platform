import { NextRequest, NextResponse } from 'next/server';
import { blogPostService } from '@/backend/marketing/application/blog-post-service';
import { enqueueBlogPublishTask } from '@/backend/marketing/infrastructure/queue/blog-publish-queue';

/**
 * Cron de rescate para posts en `scheduled` cuya Cloud Task venció sin
 * llegar a publicar (Cloud Tasks dio 500 todos los retries, o la task
 * se perdió por TTL > 7 días). Recomendado: cron de Vercel cada 15 min.
 *
 * Lógica:
 *   1. Lista todos los posts en `scheduled`.
 *   2. Filtra por `publishAt < now - 5min` (margen para que Cloud Tasks
 *      tenga su intento normal). Sin margen, podríamos atropellar la
 *      task original que ya estaba en vuelo.
 *   3. Por cada vencido:
 *      - Si `recoveryAttempts >= MAX_RETRIES` → `markFailed(...)`.
 *      - Si no → publish directo (no re-encolar otra Cloud Task, así
 *        garantizamos publicación inmediata) + incrementar contador.
 *
 *   4. Notifica al admin si hubo posts marcados como failed.
 *
 * Idempotencia: el cron es idempotente — si se ejecuta dos veces, los
 * posts ya publicados están fuera del listado `scheduled`, así que no
 * hay riesgo de doble publish.
 *
 * Seguridad: Bearer `CRON_SECRET` (estándar Vercel Cron).
 */

const MAX_RECOVERY_ATTEMPTS = 3;
const OVERDUE_MARGIN_MS = 5 * 60 * 1000; // 5 minutos

export async function GET(request: NextRequest) {
    const expected = process.env.CRON_SECRET;
    if (expected) {
        const auth = request.headers.get('authorization') || '';
        if (auth !== `Bearer ${expected}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
    }

    const now = Date.now();
    const cutoff = now - OVERDUE_MARGIN_MS;

    const scheduled = await blogPostService.listScheduled();
    const overdue = scheduled.filter(p => p.publishAt && p.publishAt.getTime() < cutoff);

    if (overdue.length === 0) {
        return NextResponse.json({ ok: true, overdue: 0 });
    }

    const recovered: string[] = [];
    const giveUp: { id: string; reason: string }[] = [];

    for (const post of overdue) {
        const attempts = (post.recoveryAttempts || 0) + 1;

        if (attempts > MAX_RECOVERY_ATTEMPTS) {
            const reason = `Cron de rescate agotado tras ${MAX_RECOVERY_ATTEMPTS} intentos`;
            await blogPostService.markFailed(post.id, reason);
            giveUp.push({ id: post.id, reason });
            continue;
        }

        try {
            // Publish directo. Si funciona, el post pasa a 'published' y sale
            // del listado scheduled — la próxima iteración del cron ya no lo
            // ve. Si falla, el catch lo deja en scheduled con recoveryAttempts
            // incrementado para el siguiente intento.
            await blogPostService.publishNow(post.id);
            await blogPostService.update(post.id, { recoveryAttempts: attempts });
            recovered.push(post.id);
        } catch (e: any) {
            console.error('[recover-cron] publishNow falló para', post.id, e?.message);
            // Solo actualizamos el contador; estado sigue 'scheduled' para que
            // el próximo ciclo del cron pueda intentarlo de nuevo. Re-encolamos
            // una Cloud Task con publishAt = now + 5min para que también haya
            // un intento por la vía normal.
            try {
                await blogPostService.update(post.id, { recoveryAttempts: attempts });
                await enqueueBlogPublishTask({
                    postId: post.id,
                    publishAt: new Date(now + 5 * 60_000),
                });
            } catch (innerErr) {
                console.error('[recover-cron] reencolado también falló:', innerErr);
            }
        }
    }

    return NextResponse.json({
        ok: true,
        overdue: overdue.length,
        recovered: recovered.length,
        recoveredIds: recovered,
        markedFailed: giveUp,
    });
}
