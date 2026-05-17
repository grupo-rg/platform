import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const originalFetch = globalThis.fetch;

async function loadActions() {
  vi.resetModules();
  return import('./retry-pipeline-job.action');
}

describe('retryPipelineJobAction', () => {
  beforeEach(() => {
    process.env.AI_CORE_URL = 'http://ai-core.test';
    process.env.INTERNAL_WORKER_TOKEN = 'tok-r';
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('POSTs to /api/v1/jobs/{jobId}/retry', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({
        jobId: 'job-abc',
        status: 'queued',
        executionName: 'exec-retry',
      }),
    });
    globalThis.fetch = fetchSpy as any;

    const { retryPipelineJobAction } = await loadActions();
    const res = await retryPipelineJobAction('job-abc');

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.status).toBe('queued');
      expect(res.executionName).toBe('exec-retry');
    }
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://ai-core.test/api/v1/jobs/job-abc/retry');
    expect((init as any).method).toBe('POST');
    expect((init as any).headers['x-internal-token']).toBe('tok-r');
  });

  it('409 when job is still running', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ detail: 'Cannot retry job from status running' }),
      text: async () => '',
    }) as any;
    const { retryPipelineJobAction } = await loadActions();
    const res = await retryPipelineJobAction('job-running');
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error).toMatch(/running/);
      expect(res.status).toBe(409);
    }
  });

  it('500 when the dispatcher could not start a new execution', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({
        detail: 'Failed to start Cloud Run Job: quota',
        jobId: 'job-failed',
      }),
      text: async () => '',
    }) as any;
    const { retryPipelineJobAction } = await loadActions();
    const res = await retryPipelineJobAction('job-failed');
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/quota/);
  });
});
