import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const originalFetch = globalThis.fetch;
const ORIG_AI_CORE = process.env.AI_CORE_URL;
const ORIG_TOKEN = process.env.INTERNAL_WORKER_TOKEN;

async function loadAction() {
  // resetModules so each test sees fresh env values.
  vi.resetModules();
  return (await import('./dispatch-pipeline-job.action')).dispatchPipelineJobAction;
}

describe('dispatchPipelineJobAction', () => {
  beforeEach(() => {
    process.env.AI_CORE_URL = 'http://ai-core.test';
    process.env.INTERNAL_WORKER_TOKEN = 'tok-123';
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (ORIG_AI_CORE) process.env.AI_CORE_URL = ORIG_AI_CORE;
    else delete process.env.AI_CORE_URL;
    if (ORIG_TOKEN) process.env.INTERNAL_WORKER_TOKEN = ORIG_TOKEN;
    else delete process.env.INTERNAL_WORKER_TOKEN;
    vi.restoreAllMocks();
  });

  it('measurements dispatch posts the right JSON body to /dispatch', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({
        jobId: 'job-abc',
        status: 'queued',
        executionName: 'exec-x',
      }),
    });
    globalThis.fetch = fetchSpy as any;

    const action = await loadAction();
    const res = await action({
      jobType: 'measurements',
      uid: 'user-1',
      leadId: 'lead-1',
      budgetId: 'budget-1',
      payload: {
        gcsUri: 'gs://b/u/budget-1/x.pdf',
        strategy: 'INLINE',
      },
    });

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.jobId).toBe('job-abc');
      expect(res.status).toBe('queued');
    }

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://ai-core.test/api/v1/jobs/dispatch');
    expect((init as any).method).toBe('POST');
    expect((init as any).headers['x-internal-token']).toBe('tok-123');
    expect((init as any).headers['Content-Type']).toBe('application/json');
    const body = JSON.parse((init as any).body as string);
    expect(body).toEqual({
      jobType: 'measurements',
      uid: 'user-1',
      leadId: 'lead-1',
      budgetId: 'budget-1',
      payload: {
        gcsUri: 'gs://b/u/budget-1/x.pdf',
        strategy: 'INLINE',
      },
    });
  });

  it('nl-budget dispatch passes narrative payload', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({ jobId: 'job-nl', status: 'queued' }),
    });
    globalThis.fetch = fetchSpy as any;

    const action = await loadAction();
    const res = await action({
      jobType: 'nl-budget',
      uid: 'user-1',
      leadId: 'lead-1',
      budgetId: 'budget-nl',
      payload: { narrative: 'Casa de 100m2 con 3 habitaciones' },
    });

    expect(res.success).toBe(true);
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as any).body as string);
    expect(body.payload.narrative).toBe('Casa de 100m2 con 3 habitaciones');
  });

  it('500 with jobId in body bubbles up the jobId for UI to display the failed state', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({
        detail: 'Failed to start Cloud Run Job: quota exhausted',
        jobId: 'job-failed',
      }),
      text: async () => '',
    }) as any;

    const action = await loadAction();
    const res = await action({
      jobType: 'measurements',
      uid: 'u',
      leadId: 'l',
      budgetId: 'b',
      payload: { gcsUri: 'gs://b/p.pdf' },
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error).toMatch(/quota exhausted/);
      expect(res.jobId).toBe('job-failed');
    }
  });

  it('400 validation error returns a clean error message', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ detail: 'payload.gcsUri is required' }),
      text: async () => '',
    }) as any;

    const action = await loadAction();
    const res = await action({
      jobType: 'measurements',
      uid: 'u',
      leadId: 'l',
      budgetId: 'b',
      payload: {} as any,
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error).toMatch(/gcsUri/);
    }
  });

  it('omits x-internal-token header when env is empty (local dev)', async () => {
    delete process.env.INTERNAL_WORKER_TOKEN;
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({ jobId: 'job-no-token', status: 'queued' }),
    });
    globalThis.fetch = fetchSpy as any;

    const action = await loadAction();
    await action({
      jobType: 'measurements',
      uid: 'u',
      leadId: 'l',
      budgetId: 'b',
      payload: { gcsUri: 'gs://b/p.pdf' },
    });
    const init = fetchSpy.mock.calls[0][1] as any;
    expect(init.headers['x-internal-token']).toBeUndefined();
  });

  it('network error returns a structured failure (no throw)', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error('ENOTFOUND ai-core.test')) as any;

    const action = await loadAction();
    const res = await action({
      jobType: 'measurements',
      uid: 'u',
      leadId: 'l',
      budgetId: 'b',
      payload: { gcsUri: 'gs://b/p.pdf' },
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error).toMatch(/ENOTFOUND/);
    }
  });
});
