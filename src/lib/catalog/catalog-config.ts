/**
 * Puntero de versión del catálogo de precios (lado Node/Next) — fuente ÚNICA
 * del año/edición activos, espejo de `services/ai-core/.../catalog_config.py`.
 *
 * Sustituye los literales `'price_book_2025'` (y `labor_rates_2025` /
 * `machinery_rates_2025`) dispersos. El año se resuelve de `process.env.CATALOG_YEAR`
 * (default 2025) → HOY es un no-op (mismo comportamiento). Al subir el Libro 2026,
 * `CATALOG_YEAR=2026` reapunta TODAS las colecciones a la vez; volver a 2025 = rollback.
 */

const DEFAULT_CATALOG_YEAR = 2025;

/** Año/edición activo del catálogo. `CATALOG_YEAR` del entorno o 2025. */
export function catalogYear(): number {
  const n = Number.parseInt((process.env.CATALOG_YEAR || '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CATALOG_YEAR;
}

export const priceBookCollection = (): string => `price_book_${catalogYear()}`;
export const laborRatesCollection = (): string => `labor_rates_${catalogYear()}`;
export const machineryRatesCollection = (): string => `machinery_rates_${catalogYear()}`;
export const sourceBook = (): string => `COAATMCA_${catalogYear()}`;
