import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mocks of the two collaborators. The "Big Bang" choice — both must hit
// for the orchestrator to succeed.
const mockUpload = vi.fn();
const mockDispatch = vi.fn();

vi.mock('@/lib/firebase/storage-uploader', () => ({
  uploadPdfForPipelineJob: (...args: any[]) => mockUpload(...args),
}));
vi.mock('@/actions/pipeline/dispatch-pipeline-job.action', () => ({
  dispatchPipelineJobAction: (...args: any[]) => mockDispatch(...args),
}));

import { dispatchMeasurementsJob } from './dispatch-measurements-job';

function fakeFile(name = 'm.pdf'): File {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, {
    type: 'application/pdf',
  });
}

describe('dispatchMeasurementsJob', () => {
  beforeEach(() => {
    mockUpload.mockReset();
    mockDispatch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uploads then dispatches, returning the resulting jobId and budgetId', async () => {
    mockUpload.mockResolvedValue({
      gcsUri: 'gs://b/u/budget-1/m.pdf',
      bucket: 'b',
      fullPath: 'pipeline_uploads/u/j/m.pdf',
    });
    mockDispatch.mockResolvedValue({
      success: true,
      jobId: 'job-abc',
      budgetId: 'budget-1',
      status: 'queued',
    });

    const res = await dispatchMeasurementsJob({
      file: fakeFile(),
      uid: 'u',
      leadId: 'l',
      budgetId: 'budget-1',
      strategy: 'INLINE',
    });

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.jobId).toBe('job-abc');
      expect(res.budgetId).toBe('budget-1');
    }

    // Upload happens first.
    expect(mockUpload).toHaveBeenCalledTimes(1);
    const uploadArgs = mockUpload.mock.calls[0][0];
    expect(uploadArgs.uid).toBe('u');
    expect(uploadArgs.file.name).toBe('m.pdf');

    // Dispatch was called with the gcsUri from upload.
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    const dispatchArgs = mockDispatch.mock.calls[0][0];
    expect(dispatchArgs.jobType).toBe('measurements');
    expect(dispatchArgs.payload.gcsUri).toBe('gs://b/u/budget-1/m.pdf');
    expect(dispatchArgs.payload.strategy).toBe('INLINE');
    expect(dispatchArgs.budgetId).toBe('budget-1');
  });

  it('generates a budgetId when none provided', async () => {
    mockUpload.mockResolvedValue({ gcsUri: 'gs://b/u/x.pdf', bucket: 'b', fullPath: 'p' });
    mockDispatch.mockResolvedValue({
      success: true,
      jobId: 'j',
      budgetId: 'will-be-generated',
      status: 'queued',
    });

    const res = await dispatchMeasurementsJob({
      file: fakeFile(),
      uid: 'u',
      leadId: 'l',
      strategy: 'INLINE',
    });
    expect(res.success).toBe(true);
    // Upload path used a uid + jobId-shaped id (jobId is generated client-side too).
    const uploadArgs = mockUpload.mock.calls[0][0];
    expect(uploadArgs.jobId).toBeTypeOf('string');
    expect(uploadArgs.jobId.length).toBeGreaterThan(0);
  });

  it('returns the upload error WITHOUT calling dispatch when storage fails', async () => {
    mockUpload.mockRejectedValue(new Error('quota exceeded'));

    const res = await dispatchMeasurementsJob({
      file: fakeFile(),
      uid: 'u',
      leadId: 'l',
      strategy: 'INLINE',
    });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/quota exceeded/);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('returns the dispatch error when the server action fails', async () => {
    mockUpload.mockResolvedValue({
      gcsUri: 'gs://b/u/x.pdf',
      bucket: 'b',
      fullPath: 'p',
    });
    mockDispatch.mockResolvedValue({
      success: false,
      error: 'Cloud Run quota exhausted',
      jobId: 'job-failed',
    });

    const res = await dispatchMeasurementsJob({
      file: fakeFile(),
      uid: 'u',
      leadId: 'l',
      strategy: 'INLINE',
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error).toMatch(/quota/);
      expect(res.jobId).toBe('job-failed');
    }
  });

  it('forwards onProgress to the uploader', async () => {
    mockUpload.mockImplementation(async ({ onProgress }) => {
      onProgress?.(0.5);
      onProgress?.(1);
      return { gcsUri: 'gs://b/u/x.pdf', bucket: 'b', fullPath: 'p' };
    });
    mockDispatch.mockResolvedValue({
      success: true,
      jobId: 'j',
      budgetId: 'b',
      status: 'queued',
    });

    const progress: number[] = [];
    await dispatchMeasurementsJob({
      file: fakeFile(),
      uid: 'u',
      leadId: 'l',
      strategy: 'INLINE',
      onUploadProgress: (p) => progress.push(p),
    });
    expect(progress).toEqual([0.5, 1]);
  });
});
