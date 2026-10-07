import { NextRequest, NextResponse } from 'next/server';
import { blogPostService } from '@/backend/marketing/application/blog-post-service';
import { requireSecretHeader } from '@/app/api/_lib/route-guards';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/marketing/blog/publish
 * Body: { postId: string }
 * Header: x-internal-token debe coincidir con INTERNAL_WORKER_TOKEN.
 *
 * Destino de las Cloud Tasks programadas en `scheduleBlogPostAction`.
 */
export async function POST(req: NextRequest) {
    // Fail-closed + comparación en tiempo constante.
    const denied = requireSecretHeader(req, 'x-internal-token', 'INTERNAL_WORKER_TOKEN');
    if (denied) return denied;

    let body: any;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const postId = body?.postId;
    if (!postId || typeof postId !== 'string') {
        return NextResponse.json({ error: 'postId required' }, { status: 400 });
    }

    try {
        const existing = await blogPostService.findById(postId);
        if (!existing) {
            return NextResponse.json({ error: 'Post not found' }, { status: 404 });
        }
        if (existing.status === 'published') {
            return NextResponse.json({ ok: true, skipped: 'already_published' });
        }

        // Anti-reschedule-collision: si una Cloud Task vieja (de antes de
        // reprogramar) llega a ejecutar, el `publishAt` actual del doc ya no
        // se parece a "ahora". En ese caso skipeamos — la nueva task de la
        // reprogramación se encargará. Margen: ±2h (cubre ejecuciones tardías
        // de Cloud Tasks por retries internos).
        if (existing.publishAt) {
            const diffMs = Math.abs(existing.publishAt.getTime() - Date.now());
            const TWO_HOURS = 2 * 60 * 60 * 1000;
            if (diffMs > TWO_HOURS) {
                return NextResponse.json({
                    ok: true,
                    skipped: 'stale_task',
                    expected: existing.publishAt.toISOString(),
                });
            }
        }

        const published = await blogPostService.publishNow(postId);
        return NextResponse.json({ ok: true, id: published.id, publishedAt: published.publishedAt });
    } catch (e: any) {
        console.error('[blog/publish] error', e);
        try {
            await blogPostService.markFailed(postId, e?.message || 'unknown');
        } catch { /* noop */ }
        return NextResponse.json({ error: e?.message || 'publish failed' }, { status: 500 });
    }
}
