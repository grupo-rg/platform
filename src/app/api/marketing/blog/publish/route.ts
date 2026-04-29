import { NextRequest, NextResponse } from 'next/server';
import { blogPostService } from '@/backend/marketing/application/blog-post-service';

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
    const expected = process.env.INTERNAL_WORKER_TOKEN;
    const provided = req.headers.get('x-internal-token') || '';
    if (!expected || provided !== expected) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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
