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
