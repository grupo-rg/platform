import { NextRequest, NextResponse } from 'next/server';
import { streamPrivateWizardAgent } from '@/backend/ai/private/agents/private-wizard.agent';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/assistant/stream
 * Body: {
 *   userId: string,
 *   userMessage: string,
 *   history?: Array<{ role: 'user'|'model'|'system', content: any[] }>,
 *   imagesBase64?: string[],
 *   documentBase64?: string
 * }
 *
 * Emite SSE con eventos:
 *   - `text\ndata: {"text": "..."}\n\n`      (token-a-token)
 *   - `done\ndata: {"reply": "...", "updatedRequirements": {...}}\n\n`  (final)
 *   - `error\ndata: {"message": "..."}\n\n`
 */
export async function POST(req: NextRequest) {
    let body: any;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    if (!body?.userId || typeof body.userMessage !== 'string') {
        return NextResponse.json({ error: 'userId and userMessage are required' }, { status: 400 });
    }

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            const send = (event: string, data: any) => {
                controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
            };

            // Heartbeat cada 15s para que proxies no cierren la conexión
            const heartbeat = setInterval(() => {
                controller.enqueue(encoder.encode(`: hb\n\n`));
            }, 15000);

            req.signal.addEventListener('abort', () => {
                clearInterval(heartbeat);
                try { controller.close(); } catch { /* noop */ }
            });

            try {
                for await (const ev of streamPrivateWizardAgent(body)) {
                    if (ev.kind === 'chunk') send('text', { text: ev.text });
                    else if (ev.kind === 'done') send('done', { reply: ev.reply, updatedRequirements: ev.updatedRequirements });
                    else if (ev.kind === 'error') send('error', { message: ev.message });
                }
            } catch (e: any) {
                send('error', { message: e?.message || 'Unexpected error' });
            } finally {
                clearInterval(heartbeat);
                try { controller.close(); } catch { /* noop */ }
            }
        },
    });

    return new NextResponse(stream, {
        headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'X-Accel-Buffering': 'no',
            Connection: 'keep-alive',
        },
    });
}
