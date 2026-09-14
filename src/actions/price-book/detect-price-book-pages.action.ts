'use server';

/**
 * Compuerta 1 del asistente de actualización del libro de precios: reenvía el PDF
 * subido al endpoint Python `POST /api/v1/admin/price-book/detect-pages`, que
 * clasifica cada página por densidad y devuelve los rangos de páginas de precios.
 * NO escribe nada — es solo el preview para que el admin confirme las páginas.
 */

export interface DetectedPage {
  page: number;
  prices: number;
  codes: number;
  images: number;
  is_price: boolean;
}

export interface PageDetectionResult {
  total_pages: number;
  price_page_count: number;
  ranges: [number, number][];
  pages: DetectedPage[];
  signal: string;
}

export type DetectPagesResult =
  | { success: true; detection: PageDetectionResult }
  | { success: false; error: string };

export async function detectPriceBookPagesAction(
  gcsUri: string,
): Promise<DetectPagesResult> {
  try {
    if (!gcsUri || !gcsUri.startsWith('gs://')) {
      return { success: false, error: 'Falta la referencia del PDF (gs://...).' };
    }

    const AI_CORE_URL = process.env.AI_CORE_URL || 'http://127.0.0.1:8080';
    const token = process.env.INTERNAL_WORKER_TOKEN;

    const forward = new FormData();
    forward.append('gcsUri', gcsUri);

    const headers: Record<string, string> = {};
    if (token) headers['x-internal-token'] = token;

    const res = await fetch(`${AI_CORE_URL}/api/v1/admin/price-book/detect-pages`, {
      method: 'POST',
      headers,
      body: forward,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => `HTTP ${res.status}`);
      return { success: false, error: `La detección de páginas falló: ${body}` };
    }

    const detection = (await res.json()) as PageDetectionResult;
    return { success: true, detection };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error desconocido en la detección.' };
  }
}
