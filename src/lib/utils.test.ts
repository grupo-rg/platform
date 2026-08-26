import { describe, expect, it } from 'vitest';
import {
    formatCurrency,
    formatNumberES,
    parseNumberES,
    toEditableNumberES,
} from './utils';

describe('formatNumberES', () => {
    it('mantiene siempre los decimales, aunque sean ceros', () => {
        expect(formatNumberES(800)).toBe('800,00');
        expect(formatNumberES(800.5)).toBe('800,50');
        expect(formatNumberES(0)).toBe('0,00');
        expect(formatNumberES(1)).toBe('1,00');
    });

    it('separa millares con punto', () => {
        expect(formatNumberES(1234.56)).toBe('1.234,56');
        expect(formatNumberES(17595)).toBe('17.595,00');
        expect(formatNumberES(1000000)).toBe('1.000.000,00');
    });

    it('respeta el número de decimales pedido', () => {
        expect(formatNumberES(2.5, 3)).toBe('2,500');
        expect(formatNumberES(800, 3)).toBe('800,000');
        expect(formatNumberES(800, 0)).toBe('800');
    });

    it('gestiona negativos y valores nulos', () => {
        expect(formatNumberES(-1234.5)).toBe('-1.234,50');
        expect(formatNumberES(null)).toBe('0,00');
        expect(formatNumberES(undefined)).toBe('0,00');
        expect(formatNumberES(NaN)).toBe('0,00');
    });
});

describe('formatCurrency', () => {
    it('añade el símbolo y conserva los dos decimales', () => {
        expect(formatCurrency(800)).toBe('800,00 €');
        expect(formatCurrency(1234.5)).toBe('1.234,50 €');
        expect(formatCurrency(0)).toBe('0,00 €');
        expect(formatCurrency(null)).toBe('0,00 €');
    });
});

describe('parseNumberES', () => {
    it('lee el formato español', () => {
        expect(parseNumberES('800,00')).toBe(800);
        expect(parseNumberES('1.234,56')).toBe(1234.56);
        expect(parseNumberES('2,5')).toBe(2.5);
        expect(parseNumberES('1.000.000,00')).toBe(1000000);
    });

    it('lee también el formato máquina', () => {
        expect(parseNumberES('1234.56')).toBe(1234.56);
        expect(parseNumberES('2.5')).toBe(2.5);
        expect(parseNumberES(800)).toBe(800);
    });

    it('ignora el símbolo de moneda y los espacios', () => {
        expect(parseNumberES('1.234,56 €')).toBe(1234.56);
        expect(parseNumberES('  800,00  ')).toBe(800);
    });

    it('devuelve 0 ante entradas vacías o inválidas', () => {
        expect(parseNumberES('')).toBe(0);
        expect(parseNumberES('-')).toBe(0);
        expect(parseNumberES(null)).toBe(0);
        expect(parseNumberES(undefined)).toBe(0);
        expect(parseNumberES('abc')).toBe(0);
    });

    it('conserva el signo negativo', () => {
        expect(parseNumberES('-1.234,56')).toBe(-1234.56);
    });
});

describe('ida y vuelta formato ↔ parseo', () => {
    it('el valor mostrado se puede volver a leer sin pérdida', () => {
        for (const value of [0, 1, 800, 1234.56, 17595, -42.5, 1000000]) {
            expect(parseNumberES(formatNumberES(value))).toBe(value);
            expect(parseNumberES(formatCurrency(value))).toBe(value);
        }
    });
});

describe('toEditableNumberES', () => {
    it('usa coma decimal y no pone millares', () => {
        expect(toEditableNumberES(1234.56)).toBe('1234,56');
        expect(toEditableNumberES(800)).toBe('800');
        expect(toEditableNumberES(0)).toBe('0');
    });
});
