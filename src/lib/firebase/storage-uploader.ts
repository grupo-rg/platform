'use client';

/**
 * Client-side uploader for the new pipeline-jobs flow.
 *
 * The user picks a PDF in the browser; this helper uploads it directly to
 * Firebase Storage under a deterministic path and returns the resulting
 * `gs://...` URI. The Server Action then only passes the URI to the
 * dispatcher endpoint — no more 512MB FormData round trips through the
 * Next.js Server Actions boundary.
 *
 * Design notes:
 *   - Path layout: `pipeline_uploads/{uid}/{jobId}/{filename}`. Storage
 *     rules constrain writes to the authenticated user's own folder.
 *   - We pre-check size + content type to surface a clean error before
 *     the upload starts; the Storage rules ALSO enforce these on the
 *     server, this is just to fail fast in the UI.
 *   - We use `uploadBytesResumable` (not `uploadBytes`) so progress and
 *     resume work for the 250+ page PDFs that motivated the rewrite.
 */

import { ref, uploadBytesResumable } from 'firebase/storage';

import { getSafeStorage } from '@/lib/firebase/client';

export interface UploadPdfArgs {
  file: File;
  uid: string;
  jobId: string;
  /** 0–1 fractional progress; called whenever Firebase emits state_changed. */
  onProgress?: (fraction: number) => void;
}

export interface UploadPdfResult {
  gcsUri: string;
  bucket: string;
  fullPath: string;
}

/**
 * The bucket used by the pipeline-jobs flow. Keep in sync with the
 * `${PROJECT_ID}-pipeline-uploads` bucket created by
 * `services/ai-core/scripts/setup-infrastructure.sh`.
 *
 * We READ from a public env var so deploys can target staging vs prod
 * buckets independently of the default Firebase bucket.
 */
const PIPELINE_BUCKET =
  process.env.NEXT_PUBLIC_PIPELINE_UPLOADS_BUCKET ||
  'grupo-rg-a9929-pipeline-uploads';

const MAX_BYTES = 100 * 1024 * 1024; // 100MB — matches the Storage rule

export async function uploadPdfForPipelineJob({
  file,
  uid,
  jobId,
  onProgress,
}: UploadPdfArgs): Promise<UploadPdfResult> {
  // Fast-fail validations — better UX than waiting for Storage to refuse.
  if (file.type !== 'application/pdf') {
    throw new Error(
      `uploadPdfForPipelineJob: expected application/pdf, got ${file.type}`,
    );
  }
  if (file.size > MAX_BYTES) {
    throw new Error(
      `uploadPdfForPipelineJob: file exceeds 100MB cap (size=${file.size})`,
    );
  }
  if (!uid || !jobId) {
    throw new Error('uploadPdfForPipelineJob: uid and jobId are required');
  }

  const storage = getSafeStorage();
  const objectPath = `pipeline_uploads/${uid}/${jobId}/${file.name}`;
  const fileRef = ref(storage, objectPath);

  const task = uploadBytesResumable(fileRef, file, {
    contentType: 'application/pdf',
    customMetadata: {
      uid,
      jobId,
    },
  });

  await new Promise<void>((resolve, reject) => {
    task.on(
      'state_changed',
      (snapshot: any) => {
        if (!onProgress) return;
        const total = snapshot.totalBytes || 1;
        onProgress(snapshot.bytesTransferred / total);
      },
      (err: Error) => reject(err),
      () => resolve(),
    );
  });

  // `task.snapshot.ref.fullPath` should equal `objectPath`, but read it
  // from the snapshot rather than trusting our local string in case Firebase
  // ever normalises it (trailing slash, percent-encoding, etc.).
  const fullPath = task.snapshot.ref.fullPath || objectPath;
  return {
    gcsUri: `gs://${PIPELINE_BUCKET}/${fullPath}`,
    bucket: PIPELINE_BUCKET,
    fullPath,
  };
}
