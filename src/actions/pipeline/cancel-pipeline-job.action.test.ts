import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const originalFetch = globalThis.fetch;

async function loadActions() {
  vi.resetModules();
  return import('./cancel-pipeline-job.action');
}

describe('cancelPipelineJobAction', () => {
  beforeEach(() => {
    process.env.AI_CORE_URL = 'http://ai-core.test';
    process.env.INTERNAL_WORKER_TOKEN = 'tok-c';
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('POSTs to /api/v1/jobs/{jobId}/cancel with the token header', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        jobId: 'job-abc',
        status: 'running',
        cancellation_requested: true,
      }),
    });
    globalThis.fetch = fetchSpy as any;

    const { cancelPipelineJobAction } = await loadActions();
    const res = await cancelPipelineJobAction('job-abc');

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.status).toBe('running');
      expect(res.cancellation_requested).toBe(true);
    }
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://ai-core.test/api/v1/jobs/job-abc/cancel');
    expect((init as any).method).toBe('POST');
    expect((init as any).headers['x-internal-token']).toBe('tok-c');
  });

  it('404 returns success=false with not-found error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ detail: "PipelineJob 'x' not found" }),
      text: async () => '',
    }) as any;
    const { cancelPipelineJobAction } = await loadActions();
    const res = await cancelPipelineJobAction('x');
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/not found/);
  });

  it('409 returns success=false (cannot cancel a completed job)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ detail: 'Cannot request cancellation on terminal job' }),
      text: async () => '',
    }) as any;
    const { cancelPipelineJobAction } = await loadActions();
    const res = await cancelPipelineJobAction('job-done');
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error).toMatch(/terminal/);
      expect(res.status).toBe(409);
    }
  });
});
