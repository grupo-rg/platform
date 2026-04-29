import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Controlamos `fetch` global para mockear al Python.
const originalFetch = globalThis.fetch;
const ORIG_AI_CORE = process.env.AI_CORE_URL;
const ORIG_TOKEN = process.env.INTERNAL_WORKER_TOKEN;

describe('generateBudgetFromSpecsAction — proxy al Python', () => {
    beforeEach(() => {
        process.env.AI_CORE_URL = 'http://ai-core.test';
        process.env.INTERNAL_WORKER_TOKEN = 'test-token-xyz';
    });
    afterEach(() => {
        globalThis.fetch = originalFetch;
        if (ORIG_AI_CORE) process.env.AI_CORE_URL = ORIG_AI_CORE; else delete process.env.AI_CORE_URL;
        if (ORIG_TOKEN) process.env.INTERNAL_WORKER_TOKEN = ORIG_TOKEN; else delete process.env.INTERNAL_WORKER_TOKEN;
        vi.restoreAllMocks();
    });

    async function loadFresh() {
        vi.resetModules();
        return (await import('./generate-budget-from-specs.action')).generateBudgetFromSpecsAction;
    }

    it('envía POST al endpoint Python con header x-internal-token y budgetId propagado', async () => {
        const fetchSpy = vi.fn().mockResolvedValue({
            ok: true,
            status: 202,
            json: async () => ({ status: 'processing', budgetId: 'bid-1' }),
        });
        globalThis.fetch = fetchSpy as any;

        const action = await loadFresh();
        const res = await action(
            'lead-1',
            {
                specs: { propertyType: 'Vivienda', totalArea: 12 } as any,
                detectedNeeds: [],
                createdAt: new Date(),
                status: 'gathering',
                transcriptions: [],
                attachmentUrls: [],
                finalBrief: 'Brief técnico consolidado',
            } as any,
            true,
            'bid-1',
        );

        expect(res.success).toBe(true);
        expect((res as any).isPending).toBe(true);
        expect((res as any).budgetId).toBe('bid-1');
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [url, init] = fetchSpy.mock.calls[0];
        expect(url).toBe('http://ai-core.test/api/v1/jobs/nl-budget');
        expect((init as any).headers['x-internal-token']).toBe('test-token-xyz');
        const body = JSON.parse((init as any).body);
        expect(body.budgetId).toBe('bid-1');
        expect(body.leadId).toBe('lead-1');
        expect(body.narrative).toBe('Brief técnico consolidado');
    });

    it('usa BudgetNarrativeBuilder + detectedNeeds cuando no hay finalBrief', async () => {
        const fetchSpy = vi.fn().mockResolvedValue({
            ok: true,
            status: 202,
            json: async () => ({ budgetId: 'x' }),
        });
        globalThis.fetch = fetchSpy as any;

        const action = await loadFresh();
        await action(
            'lead-2',
            {
                specs: { propertyType: 'Vivienda', totalArea: 90, qualityLevel: 'medium', interventionType: 'total' } as any,
                detectedNeeds: [
                    { category: 'FONTANERIA Y GAS', description: 'Nueva red', requestedMaterial: 'cobre' },
                ],
                createdAt: new Date(),
                status: 'gathering',
                transcriptions: [],
                attachmentUrls: [],
            } as any,
            true,
            'bid-2',
        );
        const body = JSON.parse((fetchSpy.mock.calls[0][1] as any).body);
        expect(body.narrative).toMatch(/Reforma Integral/);
        expect(body.narrative).toMatch(/90 m/);
        expect(body.narrative).toMatch(/FONTANERIA Y GAS/);
        expect(body.narrative).toMatch(/cobre/);
    });

    it('no incluye header x-internal-token cuando INTERNAL_WORKER_TOKEN está vacío', async () => {
        delete process.env.INTERNAL_WORKER_TOKEN;
        const fetchSpy = vi.fn().mockResolvedValue({
            ok: true,
            status: 202,
            json: async () => ({ budgetId: 'x' }),
        });
        globalThis.fetch = fetchSpy as any;

        const action = await loadFresh();
        await action('lead-3', { specs: {}, detectedNeeds: [], createdAt: new Date(), status: 'gathering', transcriptions: [], attachmentUrls: [], finalBrief: 'x' } as any, true, 'b');
        const headers = (fetchSpy.mock.calls[0][1] as any).headers;
        expect(headers['x-internal-token']).toBeUndefined();
        expect(headers['Content-Type']).toBe('application/json');
    });

    it('genera budgetId si no se le pasa uno', async () => {
        const fetchSpy = vi.fn().mockResolvedValue({
            ok: true,
            status: 202,
            json: async () => ({ budgetId: 'x' }),
        });
        globalThis.fetch = fetchSpy as any;

        const action = await loadFresh();
        const res = await action('lead', { specs: {}, detectedNeeds: [], createdAt: new Date(), status: 'gathering', transcriptions: [], attachmentUrls: [], finalBrief: 'x' } as any, true);
        expect((res as any).budgetId).toMatch(/^[0-9a-f]{8}-/); // UUID v4 aparente
    });

    it('devuelve success:false cuando el Python responde 500', async () => {
        const fetchSpy = vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
            text: async () => 'boom',
        });
        globalThis.fetch = fetchSpy as any;

        const action = await loadFresh();
        const res = await action('lead', { specs: {}, detectedNeeds: [], createdAt: new Date(), status: 'gathering', transcriptions: [], attachmentUrls: [], finalBrief: 'x' } as any, true, 'b');
        expect(res.success).toBe(false);
        expect((res as any).error).toMatch(/500/);
    });

    it('captura errores de red (fetch rechaza) y devuelve success:false', async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any;
        const action = await loadFresh();
        const res = await action('lead', { specs: {}, detectedNeeds: [], createdAt: new Date(), status: 'gathering', transcriptions: [], attachmentUrls: [], finalBrief: 'x' } as any, true, 'b');
        expect(res.success).toBe(false);
        expect((res as any).error).toMatch(/ECONNREFUSED/);
    });
});
