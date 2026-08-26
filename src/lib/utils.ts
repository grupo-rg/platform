import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatMoneyEUR(amount?: number | null): string {
  if (amount === undefined || amount === null || isNaN(amount)) return '0,00 €';

  // Custom foolproof formatter to ensure strictly "1.234,56 €" regardless of browser engine
  const [integerPart, decimalPart] = Math.abs(amount).toFixed(2).split('.');
  const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const sign = amount < 0 ? "-" : "";

  return `${sign}${formattedInteger},${decimalPart} €`;
}

export const formatCurrency = formatMoneyEUR;

/**
 * Formato número español sin símbolo de moneda. Foolproof — no depende de
 * `Intl.NumberFormat` (que falla en entornos como `@react-pdf/renderer`
 * cuando el ICU no incluye la locale es-ES).
 *
 * Ejemplos:
 *   formatNumberES(5000)    → "5.000,00"
 *   formatNumberES(17595)   → "17.595,00"
 *   formatNumberES(2.345, 3) → "2,345"
 */
export function formatNumberES(value?: number | null, decimals = 2): string {
  if (value === undefined || value === null || isNaN(value)) {
    return decimals > 0 ? `0,${'0'.repeat(decimals)}` : '0';
  }
  const [integerPart, decimalPart] = Math.abs(value).toFixed(decimals).split('.');
  const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const sign = value < 0 ? "-" : "";
  return decimals > 0
    ? `${sign}${formattedInteger},${decimalPart}`
    : `${sign}${formattedInteger}`;
}

/**
 * Parsea un número escrito en formato español (o en formato máquina).
 *
 * Contrapartida de `formatNumberES` / `formatMoneyEUR`: los campos del editor
 * muestran "1.234,56" y el usuario puede teclear coma o punto como separador
 * decimal, así que no basta con `Number(raw)`.
 *
 * Ejemplos:
 *   parseNumberES("1.234,56") → 1234.56
 *   parseNumberES("800,00")   → 800
 *   parseNumberES("1234.56")  → 1234.56
 *   parseNumberES("2,5")      → 2.5
 *   parseNumberES("")         → 0
 */
export function parseNumberES(input?: string | number | null): number {
  if (typeof input === 'number') return Number.isFinite(input) ? input : 0;
  if (input === undefined || input === null) return 0;

  // Deja sólo dígitos, signo y separadores.
  const cleaned = String(input).trim().replace(/[^\d,.-]/g, '');
  if (!cleaned || cleaned === '-') return 0;

  const hasComma = cleaned.includes(',');
  // Con coma presente, la coma es el decimal y el punto es separador de millares.
  // Sin coma, el punto se interpreta como decimal ("2.5" → 2.5).
  const normalized = hasComma
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Convierte un número al texto que se edita en un input: separador decimal
 * español y sin separador de millares (que estorbaría al teclear).
 */
export function toEditableNumberES(value?: number | string | null): string {
  const num = typeof value === 'number' ? value : parseNumberES(value);
  if (!Number.isFinite(num)) return '';
  return String(num).replace('.', ',');
}
