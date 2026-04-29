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
