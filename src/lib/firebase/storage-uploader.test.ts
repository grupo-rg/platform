import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We mock the `firebase/storage` module so the upload code doesn't need a
// real Firebase init. The mocks return controllable behaviours per test.

const mockRef = vi.fn();
const mockUploadBytesResumable = vi.fn();

vi.mock('firebase/storage', () => ({
  ref: (...args: any[]) => mockRef(...args),
  uploadBytesResumable: (...args: any[]) => mockUploadBytesResumable(...args),
}));

vi.mock('@/lib/firebase/client', () => ({
  getSafeStorage: () => ({ /* opaque — only passed through to ref() */ }),
}));

import { uploadPdfForPipelineJob } from './storage-uploader';

function fakePdf(name = 'sample.pdf', sizeBytes = 1024): File {
  const buf = new Uint8Array(sizeBytes);
  return new File([buf], name, { type: 'application/pdf' });
}

function setupUploadTaskMock({
  resolveWithFullPath,
  fail,
  progressEvents,
}: {
  resolveWithFullPath?: string;
  fail?: Error;
  progressEvents?: Array<{ bytesTransferred: number; totalBytes: number }>;
}) {
  // uploadBytesResumable returns an UploadTask: an EventEmitter-like object
  // with `.on(event, onNext, onError, onComplete)` + a `.snapshot.ref` once
  // complete. We simulate that surface.
  let task: any;
  task = {
    snapshot: {
      ref: {
        bucket: 'grupo-rg-a9929-pipeline-uploads',
        fullPath: resolveWithFullPath ?? '',
      },
    },
    on: vi.fn((event: string, onNext: any, onError: any, onComplete: any) => {
      if (event !== 'state_changed') throw new Error(`unexpected event ${event}`);
      // Simulate progress events synchronously.
      for (const p of progressEvents ?? []) {
        onNext({ bytesTransferred: p.bytesTransferred, totalBytes: p.totalBytes });
      }
      // Then either complete or error.
      if (fail) {
        // Defer to a microtask so the caller's `.on(...)` returns first.
        Promise.resolve().then(() => onError(fail));
      } else {
        Promise.resolve().then(() => {
          task.snapshot.ref.fullPath = resolveWithFullPath ?? task.snapshot.ref.fullPath;
          onComplete();
        });
      }
    }),
  };
  mockUploadBytesResumable.mockReturnValue(task);
  return task;
}

describe('uploadPdfForPipelineJob', () => {
  beforeEach(() => {
    mockRef.mockClear();
    mockUploadBytesResumable.mockClear();
    mockRef.mockImplementation((_storage, path) => ({ fullPath: path }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('places the PDF at pipeline_uploads/{uid}/{jobId}/{filename}', async () => {
    setupUploadTaskMock({ resolveWithFullPath: 'pipeline_uploads/user-1/job-abc/m.pdf' });

    const result = await uploadPdfForPipelineJob({
      file: fakePdf('m.pdf'),
      uid: 'user-1',
      jobId: 'job-abc',
    });

    expect(mockRef).toHaveBeenCalledTimes(1);
    expect(mockRef.mock.calls[0][1]).toBe('pipeline_uploads/user-1/job-abc/m.pdf');
    expect(result.gcsUri).toBe(
      'gs://grupo-rg-a9929-pipeline-uploads/pipeline_uploads/user-1/job-abc/m.pdf',
    );
  });

  it('passes the file blob to uploadBytesResumable with content type metadata', async () => {
    setupUploadTaskMock({ resolveWithFullPath: 'pipeline_uploads/u/j/x.pdf' });

    const file = fakePdf('x.pdf', 2048);
    await uploadPdfForPipelineJob({ file, uid: 'u', jobId: 'j' });

    expect(mockUploadBytesResumable).toHaveBeenCalledTimes(1);
    const [, blob, metadata] = mockUploadBytesResumable.mock.calls[0];
    expect(blob).toBe(file);
    expect(metadata.contentType).toBe('application/pdf');
  });

  it('reports progress via the onProgress callback', async () => {
    setupUploadTaskMock({
      resolveWithFullPath: 'pipeline_uploads/u/j/p.pdf',
      progressEvents: [
        { bytesTransferred: 0, totalBytes: 1000 },
        { bytesTransferred: 500, totalBytes: 1000 },
        { bytesTransferred: 1000, totalBytes: 1000 },
      ],
    });

    const progress: number[] = [];
    await uploadPdfForPipelineJob({
      file: fakePdf(),
      uid: 'u',
      jobId: 'j',
      onProgress: (pct) => progress.push(pct),
    });

    expect(progress).toEqual([0, 0.5, 1]);
  });

  it('rejects when the upload errors out', async () => {
    setupUploadTaskMock({ fail: new Error('quota exceeded') });

    await expect(
      uploadPdfForPipelineJob({
        file: fakePdf(),
        uid: 'u',
        jobId: 'j',
      }),
    ).rejects.toThrow(/quota exceeded/);
  });

  it('rejects non-PDF files defensively (UX guard, not security)', async () => {
    const fakeImage = new File([new Uint8Array([0])], 'photo.png', {
      type: 'image/png',
    });
    await expect(
      uploadPdfForPipelineJob({
        file: fakeImage as File,
        uid: 'u',
        jobId: 'j',
      }),
    ).rejects.toThrow(/application\/pdf/);
    expect(mockUploadBytesResumable).not.toHaveBeenCalled();
  });

  it('rejects files exceeding the 100MB soft cap', async () => {
    const huge = fakePdf('huge.pdf', 100 * 1024 * 1024 + 1);
    await expect(
      uploadPdfForPipelineJob({
        file: huge,
        uid: 'u',
        jobId: 'j',
      }),
    ).rejects.toThrow(/100MB/);
    expect(mockUploadBytesResumable).not.toHaveBeenCalled();
  });
});
