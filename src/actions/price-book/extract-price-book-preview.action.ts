'use server';

import { checkAdmin, unauthorizedResult } from '@/actions/_guards';

/**
 * Compuerta 2 del asistente de actualización: reenvía el PDF + las páginas
 * confirmadas al endpoint Python `POST /api/v1/admin/price-book/extract-preview`,
 * que extrae una MUESTRA representativa y la contrasta con el libro activo.
 * NO escribe nada — es el preview para que el admin valide precios antes de
 * ingestar.
 */

export interface DiffSample {
  code: string;
  description: string;
  unit: string;
  status: 'new' | 'changed' | 'unchanged';
  new_price: number;
  old_price: number | null;
  delta_abs: number | null;
  delta_pct: number | null;
}

export interface DiffSummary {
  extracted: number;
  new: number;
  changed: number;
  unchanged: number;
  matched: number;
  avg_change_pct: number | null;
}

export interface ItemPreview {
  code: string;
  unit: string;
  description: string;
  price_total: number;
  breakdown_count: number;
  page: number;
  chapter: string | null;
}

export interface ExtractPreviewResult {
  target_year: number | null;
  active_collection: string;
  pages_confirmed: number;
  pages_sampled: number[];
  sampled_count: number;
  extracted_count: number;
  active_item_count: number;
  items_preview: ItemPreview[];
  diff: { summary: DiffSummary; samples: DiffSample[] };
}

export type ExtractPreviewActionResult =
  | { success: true; preview: ExtractPreviewResult }
  | { success: false; error: string };

export async function extractPriceBookPreviewAction(args: {
  gcsUri: string;
  pages: string;
  year: number | string;
  limit?: number | string;
}): Promise<ExtractPreviewActionResult> {
  if (!(await checkAdmin())) return unauthorizedResult();
  try {
    const { gcsUri } = args;
    if (!gcsUri || !gcsUri.startsWith('gs://')) {
      return { success: false, error: 'Falta la referencia del PDF (gs://...).' };
    }
    const pages = String(args.pages ?? '');
    if (!pages) {
      return { success: false, error: 'No hay páginas confirmadas.' };
    }
    const year = String(args.year ?? '');
    const limit = String(args.limit ?? '30');

    const AI_CORE_URL = process.env.AI_CORE_URL || 'http://127.0.0.1:8080';
    const token = process.env.INTERNAL_WORKER_TOKEN;

    const forward = new FormData();
    forward.append('gcsUri', gcsUri);
    forward.append('pages', pages);
    if (year) forward.append('year', year);
    forward.append('limit', limit);

    const headers: Record<string, string> = {};
    if (token) headers['x-internal-token'] = token;

    const res = await fetch(`${AI_CORE_URL}/api/v1/admin/price-book/extract-preview`, {
      method: 'POST',
      headers,
      body: forward,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => `HTTP ${res.status}`);
      return { success: false, error: `La extracción de preview falló: ${body}` };
    }

    const preview = (await res.json()) as ExtractPreviewResult;
    return { success: true, preview };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error desconocido en la extracción.' };
  }
}
