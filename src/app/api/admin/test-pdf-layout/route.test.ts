/**
 * Sprint 4 Fase B (B4) — tests para el proxy admin
 * `/api/admin/test-pdf-layout`.
 *
 * Cubrimos:
 *   1. 403 si verifyAuth devuelve null (no admin).
 *   2. 400 si no se envía un file.
 *   3. 400 si el file no es .pdf.
 *   4. 413 si el file supera el cap (50 MB).
 *   5. 200 happy path — proxy a ai-core y devuelve su payload.
 *   6. 502 cuando fetch a ai-core falla.
 *   7. 5xx upstream → 502 mapped.
 *
 * Mocks:
 *   - `@/backend/auth/auth.middleware.verifyAuth` para controlar la auth.
 *   - `global.fetch` para simular ai-core.
 *
 * NOTA: este test corre en `environment: node` (vitest.config). La Route
 * Handler de Next 15 acepta un `NextRequest`; lo construimos vía `new Request`
 * + cast, lo que basta porque el handler solo lee `formData()` y devuelve
 * `NextResponse.json`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock chain: el módulo del middleware exporta `verifyAuth`. Inyectamos una
// fake controlable por test.
const verifyAuthMock = vi.fn();
vi.mock('@/backend/auth/auth.middleware', () => ({
    verifyAuth: (...args: any[]) => verifyAuthMock(...args),
}));

// Importamos el handler DESPUÉS del mock para que la sustitución aplique.
async function loadPost() {
    const mod = await import('./route');
    return mod.POST;
}

function makeFormData(file: File | null): FormData {
    const fd = new FormData();
    if (file) fd.append('file', file, file.name);
    return fd;
}

function makeRequest(form: FormData): any {
    // Construimos un Request real con el FormData como body; el handler
    // únicamente invoca `request.formData()`.
    return new Request('http://localhost/api/admin/test-pdf-layout', {
        method: 'POST',
        body: form,
    });
}

describe('POST /api/admin/test-pdf-layout — auth + error paths', () => {
    beforeEach(() => {
        verifyAuthMock.mockReset();
        // Limpiamos cualquier mock previo de fetch.
        if ((global as any).fetch?.mockReset) (global as any).fetch.mockReset();
    });

    it('returns 403 when verifyAuth returns null (non-admin)', async () => {
        verifyAuthMock.mockResolvedValueOnce(null);
        const POST = await loadPost();
        const res = await POST(makeRequest(makeFormData(null)));
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.error).toBe('forbidden');
    });

    it('returns 400 when no file is provided', async () => {
        verifyAuthMock.mockResolvedValueOnce({ userId: 'u1', role: 'admin', claims: {} });
        const POST = await loadPost();
        const res = await POST(makeRequest(makeFormData(null)));
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe('missing_file');
    });

    it('returns 400 when file is not a .pdf', async () => {
        verifyAuthMock.mockResolvedValueOnce({ userId: 'u1', role: 'admin', claims: {} });
        const txt = new File(['hello'], 'notes.txt', { type: 'text/plain' });
        const POST = await loadPost();
        const res = await POST(makeRequest(makeFormData(txt)));
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe('invalid_file_type');
    });

    it('returns 413 when file exceeds 50 MB', async () => {
        verifyAuthMock.mockResolvedValueOnce({ userId: 'u1', role: 'admin', claims: {} });
        // 51 MB de bytes vacíos. Usamos Blob.size sin alocar memoria real —
        // creamos un Blob compuesto de muchos chunks.
        const bigArray = new Uint8Array(51 * 1024 * 1024);
        const big = new File([bigArray], 'huge.pdf', { type: 'application/pdf' });
        const POST = await loadPost();
        const res = await POST(makeRequest(makeFormData(big)));
        expect(res.status).toBe(413);
        const body = await res.json();
        expect(body.error).toBe('file_too_large');
    });

    it('returns 200 and ai-core payload on happy path', async () => {
        verifyAuthMock.mockResolvedValueOnce({ userId: 'u1', role: 'admin', claims: {} });
        const samplePayload = {
            viable: true,
            reason: null,
            partidasCount: 12,
            qtyRate: 0.95,
            chapterRate: 0.91,
            pagesTotal: 4,
            pagesWithHeader: 3,
            durationSeconds: 1.23,
            items: [],
            truncated: false,
            pageMetrics: [],
        };
        const fetchMock = vi.fn().mockResolvedValueOnce(
            new Response(JSON.stringify(samplePayload), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            }),
        );
        (global as any).fetch = fetchMock;

        const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'sample.pdf', {
            type: 'application/pdf',
        });
        const POST = await loadPost();
        const res = await POST(makeRequest(makeFormData(pdf)));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual(samplePayload);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toMatch(/\/api\/v1\/admin\/test-tabular-parser$/);
        expect(init.method).toBe('POST');
        // Body es el FormData reenviado.
        expect(init.body).toBeInstanceOf(FormData);
    });

    it('returns 502 when ai-core fetch fails (network error)', async () => {
        verifyAuthMock.mockResolvedValueOnce({ userId: 'u1', role: 'admin', claims: {} });
        const fetchMock = vi.fn().mockRejectedValueOnce(new Error('ECONNREFUSED'));
        (global as any).fetch = fetchMock;

        const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'sample.pdf', {
            type: 'application/pdf',
        });
        const POST = await loadPost();
        const res = await POST(makeRequest(makeFormData(pdf)));
        expect(res.status).toBe(502);
        const body = await res.json();
        expect(body.error).toBe('ai_core_unreachable');
    });

    it('returns 502 when ai-core returns a 5xx', async () => {
        verifyAuthMock.mockResolvedValueOnce({ userId: 'u1', role: 'admin', claims: {} });
        const fetchMock = vi.fn().mockResolvedValueOnce(
            new Response(JSON.stringify({ detail: 'Internal Server Error' }), {
                status: 500,
                headers: { 'content-type': 'application/json' },
            }),
        );
        (global as any).fetch = fetchMock;

        const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'sample.pdf', {
            type: 'application/pdf',
        });
        const POST = await loadPost();
        const res = await POST(makeRequest(makeFormData(pdf)));
        expect(res.status).toBe(502);
        const body = await res.json();
        expect(body.error).toBe('ai_core_error');
    });

    it('propagates 4xx from ai-core verbatim', async () => {
        verifyAuthMock.mockResolvedValueOnce({ userId: 'u1', role: 'admin', claims: {} });
        const fetchMock = vi.fn().mockResolvedValueOnce(
            new Response(JSON.stringify({ detail: 'Only PDF files are allowed' }), {
                status: 400,
                headers: { 'content-type': 'application/json' },
            }),
        );
        (global as any).fetch = fetchMock;

        const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'sample.pdf', {
            type: 'application/pdf',
        });
        const POST = await loadPost();
        const res = await POST(makeRequest(makeFormData(pdf)));
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe('ai_core_error');
        expect(body.detail).toMatch(/Only PDF/);
    });
});
