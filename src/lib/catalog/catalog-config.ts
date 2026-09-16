/**
 * Puntero de versión del catálogo de precios (lado Node/Next) — fuente ÚNICA
 * del año/edición activos, espejo de `services/ai-core/.../catalog_config.py`.
 *
 * Resolución del año activo (prioridad):
 *   1. Puntero Firestore `catalog_config/active.year` — flip en caliente sin
 *      redeploy. Se lee en background (async) y se cachea con TTL; las funciones
 *      síncronas devuelven el último valor cacheado.
 *   2. Env `CATALOG_YEAR` — fallback si el puntero no existe / no responde.
 *   3. `2025` — default duro.
 *
 * Solo se usa server-side (server actions + repos backend); el admin SDK se
 * importa de forma perezosa para no arrastrarlo a ningún bundle de cliente.
 */

const DEFAULT_CATALOG_YEAR = 2025;
const POINTER_TTL_MS = 30_000;

let cachedYear: number | null = null;
let cachedAt = 0;
let refreshing: Promise<void> | null = null;

function envOrDefaultYear(): number {
  const n = Number.parseInt((process.env.CATALOG_YEAR || '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CATALOG_YEAR;
}

async function readPointerYear(): Promise<number | null> {
  try {
    const { adminFirestore } = await import(
      '@/backend/shared/infrastructure/firebase/admin-app'
    );
    const doc = await adminFirestore.collection('catalog_config').doc('active').get();
    if (!doc.exists) return null;
    const y = (doc.data() || {}).year;
    if (typeof y === 'number' && Number.isFinite(y) && y > 0) return Math.trunc(y);
    if (typeof y === 'string' && /^\d+$/.test(y.trim())) return Number.parseInt(y.trim(), 10);
    return null;
  } catch {
    return null;
  }
}

function scheduleRefresh(): void {
  const now = Date.now();
  if (cachedYear !== null && now - cachedAt < POINTER_TTL_MS) return;
  if (refreshing) return;
  refreshing = readPointerYear()
    .then((y) => {
      cachedYear = y ?? envOrDefaultYear();
      cachedAt = Date.now();
    })
    .catch(() => {
      /* deja el valor cacheado / fallback */
    })
    .finally(() => {
      refreshing = null;
    });
}

/** Año activo (síncrono). Devuelve el último valor cacheado del puntero; dispara
 *  un refresco en background si está vencido. En arranque en frío devuelve el
 *  env/default hasta que el primer refresco resuelve el puntero. */
export function catalogYear(): number {
  scheduleRefresh();
  return cachedYear ?? envOrDefaultYear();
}

/** Año activo garantizando lectura fresca del puntero (await). Para call-sites
 *  que necesiten el valor correcto de inmediato (ej. tras un flip). */
export async function catalogYearFresh(): Promise<number> {
  const y = await readPointerYear();
  cachedYear = y ?? envOrDefaultYear();
  cachedAt = Date.now();
  return cachedYear;
}

/** Escribe el puntero (go-live / rollback) e invalida la caché local. */
export async function setActiveYear(year: number, updatedBy = 'system'): Promise<void> {
  const { adminFirestore } = await import(
    '@/backend/shared/infrastructure/firebase/admin-app'
  );
  await adminFirestore
    .collection('catalog_config')
    .doc('active')
    .set(
      { year: Math.trunc(year), updated_at: new Date(), updated_by: updatedBy },
      { merge: true },
    );
  cachedYear = Math.trunc(year);
  cachedAt = Date.now();
}

export const priceBookCollection = (): string => `price_book_${catalogYear()}`;
export const laborRatesCollection = (): string => `labor_rates_${catalogYear()}`;
export const machineryRatesCollection = (): string => `machinery_rates_${catalogYear()}`;
export const sourceBook = (): string => `COAATMCA_${catalogYear()}`;
