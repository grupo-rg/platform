'use server';

/**
 * Pre-flight to the heavy measurements/vision pipeline. Once the client has
 * uploaded a PDF to `gs://...` we call this action which proxies to the
 * Python `POST /api/v1/jobs/extract-metadata` endpoint, runs Gemini Flash
 * on the FIRST page only, and returns {clientName, budgetTitle,
 * projectAddress, confidence}.
 *
 * Failure semantics: extraction never fails the request — the Python side
 * returns 200 with empty fields when the PDF can't be downloaded or
 * rendered, so the UI keeps an editable form regardless.
 */

export interface ExtractPdfMetadataInput {
  gcsUri: string;
}

export interface ExtractedBudgetMetadata {
  clientName: string | null;
  budgetTitle: string | null;
  projectAddress: string | null;
  confidence: number;
}

export type ExtractPdfMetadataResult =
  | { success: true; metadata: ExtractedBudgetMetadata }
  | { success: false; error: string };

export async function extractPdfMetadataAction(
  input: ExtractPdfMetadataInput,
): Promise<ExtractPdfMetadataResult> {
  try {
    const AI_CORE_URL = process.env.AI_CORE_URL || 'http://127.0.0.1:8080';
    const targetUrl = `${AI_CORE_URL}/api/v1/jobs/extract-metadata`;
    const token = process.env.INTERNAL_WORKER_TOKEN;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['x-internal-token'] = token;

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ gcsUri: input.gcsUri }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => `HTTP ${response.status}`);
      return { success: false, error: `Metadata extraction failed: ${body}` };
    }

    const data = (await response.json()) as ExtractedBudgetMetadata;
    return { success: true, metadata: data };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Unknown error' };
  }
}
