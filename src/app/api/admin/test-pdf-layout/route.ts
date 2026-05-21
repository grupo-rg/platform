/**
 * Sprint 4 Fase B — proxy admin para el parser TABULAR del ai-core.
 *
 * POST /api/admin/test-pdf-layout
 *
 * Acepta `multipart/form-data` con `file` (un PDF, max 50 MB) y lo reenvía
 * al endpoint `POST /api/v1/admin/test-tabular-parser` del servicio Python
 * (ai-core). Inyecta `x-internal-token` desde `INTERNAL_WORKER_TOKEN`.
 *
 * No genera Budget, no toca Firestore, no lanza el Swarm. Solo evaluación
 * pura del parser para QA y diagnóstico de layouts cliente nuevos.
 *
 * Auth: admin only (claim `admin:true` o `role:'super-admin'`).
 *
 * Respuesta exitosa (200):
 *   { viable, reason, partidasCount, qtyRate, chapterRate,
 *     pagesTotal, pagesWithHeader, durationSeconds, items[],
 *     truncated, pageMetrics[] }
 *
 * Errores:
 *   - 401/403 si no admin (response del middleware verifyAuth).
 *   - 400 si no se envió file o no es PDF.
 *   - 413 si el PDF supera 50 MB.
 *   - 502 si el ai-core devolvió un error de red / 5xx.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/backend/auth/auth.middleware';

export const dynamic = 'force-dynamic';
// Permitir uploads grandes; Next defaults a 4 MB en route handlers.
export const maxDuration = 120;

// Mismo cap que el endpoint Python.
const MAX_PDF_BYTES = 50 * 1024 * 1024;

export interface TestPdfLayoutItem {
    code: string;
    description: string;
    unit: string;
    quantity: number | null;
    chapter: string;
    sub_chapter: string | null;
    apartado: string | null;
    page: number | null;
}

export interface TestPdfLayoutPageMetric {
    page: number;
    hasHeader: boolean;
    rowsFound: number;
    partidasExtracted: number;
    qtyFound: number;
}

export interface TestPdfLayoutResponse {
    viable: boolean;
    reason: string | null;
    /** Modo del parser: "INLINE" | "ANNEXED" | "MU02_INLINE" | null */
    mode: string | null;
    partidasCount: number;
    qtyRate: number;
    chapterRate: number;
    pagesTotal: number;
    pagesWithHeader: number;
    durationSeconds: number;
    /** Sprint 4 Fase F — metadata del documento extraída de la primera página. */
    documentTitle: string | null;
    documentAddress: string | null;
    items: TestPdfLayoutItem[];
    truncated: boolean;
    pageMetrics: TestPdfLayoutPageMetric[];
}

function aiCoreUrl(): { base: string; token: string | undefined } {
    return {
        base: process.env.AI_CORE_URL || 'http://127.0.0.1:8080',
        token: process.env.INTERNAL_WORKER_TOKEN,
    };
}

export async function POST(request: NextRequest) {
    const auth = await verifyAuth(true);
    if (!auth) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    let form: FormData;
    try {
        form = await request.formData();
    } catch (err: any) {
        return NextResponse.json(
            { error: 'invalid_multipart', detail: err?.message ?? 'unknown' },
            { status: 400 },
        );
    }

    const fileEntry = form.get('file');
    if (!fileEntry || typeof fileEntry === 'string') {
        return NextResponse.json(
            { error: 'missing_file', detail: 'Field "file" with a PDF blob is required.' },
            { status: 400 },
        );
    }

    const file = fileEntry as File;
    if (!file.name?.toLowerCase().endsWith('.pdf')) {
        return NextResponse.json(
            { error: 'invalid_file_type', detail: 'Only .pdf files are accepted.' },
            { status: 400 },
        );
    }
    if (file.size > MAX_PDF_BYTES) {
        return NextResponse.json(
            {
                error: 'file_too_large',
                detail: `PDF must be <= ${MAX_PDF_BYTES} bytes (got ${file.size}).`,
            },
            { status: 413 },
        );
    }

    // Reconstruimos el multipart hacia ai-core. Reutilizamos el File tal cual
    // — FormData/Blob acepta el handle directamente.
    const outForm = new FormData();
    outForm.append('file', file, file.name);

    const { base, token } = aiCoreUrl();
    const headers: Record<string, string> = {};
    if (token) headers['x-internal-token'] = token;

    let upstream: Response;
    try {
        upstream = await fetch(`${base}/api/v1/admin/test-tabular-parser`, {
            method: 'POST',
            headers,
            body: outForm,
        });
    } catch (err: any) {
        console.error('[test-pdf-layout] upstream fetch failed', err);
        return NextResponse.json(
            { error: 'ai_core_unreachable', detail: err?.message ?? 'fetch_failed' },
            { status: 502 },
        );
    }

    const text = await upstream.text();
    let body: any = null;
    try {
        body = text ? JSON.parse(text) : null;
    } catch {
        body = text;
    }

    if (!upstream.ok) {
        const detail = typeof body === 'object' && body !== null && 'detail' in body
            ? body.detail
            : typeof body === 'string' ? body : `HTTP ${upstream.status}`;
        return NextResponse.json(
            { error: 'ai_core_error', detail, downstreamStatus: upstream.status },
            { status: upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502 },
        );
    }

    return NextResponse.json(body as TestPdfLayoutResponse, { status: 200 });
}
