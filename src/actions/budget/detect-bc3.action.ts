'use server';

/**
 * Detección rápida de un archivo BC3 (FIEBDC-3) para la tarjeta de importación
 * del chat. Reenvía el archivo al servicio Python `ai-core` (`/api/v1/bc3/detect`),
 * que lo parsea y devuelve conteos (capítulos, partidas, con precio, mediciones).
 * No dispara el pipeline — es de milisegundos.
 */

const AI_CORE_URL = process.env.AI_CORE_URL || 'http://127.0.0.1:8080';

export interface Bc3DetectResult {
    filename: string;
    version: string;
    encoding: string;
    currency: string;
    title: string;
    chapters: number;
    partidas: number;
    priced_partidas: number;
    measurements: number;
    has_prices: boolean;
}

export type DetectBc3Response =
    | { ok: true; data: Bc3DetectResult }
    | { ok: false; error: string };

export async function detectBc3Action(formData: FormData): Promise<DetectBc3Response> {
    const file = formData.get('file');
    if (!(file instanceof Blob)) {
        return { ok: false, error: 'No se recibió el archivo BC3.' };
    }

    try {
        const res = await fetch(`${AI_CORE_URL}/api/v1/bc3/detect`, {
            method: 'POST',
            body: formData,
        });

        if (!res.ok) {
            const txt = await res.text().catch(() => '');
            return { ok: false, error: `Detección BC3 falló (${res.status}): ${txt.slice(0, 200)}` };
        }

        const data = (await res.json()) as Bc3DetectResult;
        return { ok: true, data };
    } catch (e: any) {
        return { ok: false, error: e?.message || 'Error de red al detectar el BC3.' };
    }
}
