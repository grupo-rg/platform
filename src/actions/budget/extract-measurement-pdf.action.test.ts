import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const originalFetch = globalThis.fetch;
const ORIG_AI_CORE = process.env.AI_CORE_URL;
const ORIG_TOKEN = process.env.INTERNAL_WORKER_TOKEN;

function makeFormDataWithPdf() {
    const fd = new FormData();
    fd.append('file', new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'm.pdf', { type: 'application/pdf' }));
    return fd;
}

describe('extractMeasurementPdfAction — proxy a Cloud Run', () => {
    beforeEach(() => {
        process.env.AI_CORE_URL = 'http://ai-core.test';
        process.env.INTERNAL_WORKER_TOKEN = 'pdf-token-abc';
    });
    afterEach(() => {
        globalThis.fetch = originalFetch;
        if (ORIG_AI_CORE) process.env.AI_CORE_URL = ORIG_AI_CORE; else delete process.env.AI_CORE_URL;
        if (ORIG_TOKEN) process.env.INTERNAL_WORKER_TOKEN = ORIG_TOKEN; else delete process.env.INTERNAL_WORKER_TOKEN;
        vi.restoreAllMocks();
    });

    async function loadFresh() {
        vi.resetModules();
        return (await import('./extract-measurement-pdf.action')).extractMeasurementPdfAction;
    }

    it('envía FormData al endpoint measurements con header y campos leadId/budgetId/strategy', async () => {
        const fetchSpy = vi.fn().mockResolvedValue({
            ok: true,
            status: 202,
            json: async () => ({ status: 'processing', budgetId: 'bid-pdf-1' }),
        });
        globalThis.fetch = fetchSpy as any;

        const action = await loadFresh();
        const fd = makeFormDataWithPdf();
        const res = await action(fd, 'admin-user', 'INLINE', 'bid-pdf-1');

        expect(res.success).toBe(true);
        expect((res as any).isPending).toBe(true);
        expect((res as any).budgetId).toBe('bid-pdf-1');

        const [url, init] = fetchSpy.mock.calls[0];
        expect(url).toBe('http://ai-core.test/api/v1/jobs/measurements');
        expect((init as any).headers['x-internal-token']).toBe('pdf-token-abc');

        // Los campos se añaden al FormData; basta con verificar que están presentes.
        const sentFd = (init as any).body as FormData;
        expect(sentFd.get('leadId')).toBe('admin-user');
        expect(sentFd.get('budgetId')).toBe('bid-pdf-1');
        expect(sentFd.get('strategy')).toBe('INLINE');
    });

    it('si INTERNAL_WORKER_TOKEN vacío no envía headers (permite dev local)', async () => {
        delete process.env.INTERNAL_WORKER_TOKEN;
        const fetchSpy = vi.fn().mockResolvedValue({
            ok: true,
            status: 202,
            json: async () => ({ budgetId: 'b' }),
        });
        globalThis.fetch = fetchSpy as any;

        const action = await loadFresh();
        await action(makeFormDataWithPdf(), 'lead', 'ANNEXED', 'b');
        expect((fetchSpy.mock.calls[0][1] as any).headers).toBeUndefined();
    });

    it('genera budgetId si no se provee', async () => {
        const fetchSpy = vi.fn().mockResolvedValue({
            ok: true,
            status: 202,
            json: async () => ({ budgetId: 'server-generated' }),
        });
        globalThis.fetch = fetchSpy as any;

        const action = await loadFresh();
        const res = await action(makeFormDataWithPdf(), 'lead', 'INLINE');
        // El backend puede devolver otro — preferimos el del backend.
        expect((res as any).budgetId).toBe('server-generated');
    });

    it('500 del Python se devuelve como error', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
            text: async () => 'internal boom',
        }) as any;
        const action = await loadFresh();
        const res = await action(makeFormDataWithPdf(), 'lead', 'INLINE', 'b');
        expect(res.success).toBe(false);
        expect((res as any).error).toMatch(/500/);
    });

    it('valida que hay file en el FormData', async () => {
        const action = await loadFresh();
        const emptyFd = new FormData();
        const res = await action(emptyFd, 'lead', 'INLINE', 'b');
        expect(res.success).toBe(false);
        expect((res as any).error).toMatch(/No file/);
    });
});
