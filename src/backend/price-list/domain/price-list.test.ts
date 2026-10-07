import { describe, it, expect } from 'vitest';
import {
    buildHourlyRateStarterRows,
    countPriceListItems,
    formatPriceListReference,
    groupPriceListRows,
    moveRow,
    nextPriceListSeq,
    priceColumnHeader,
    validityDays,
    type PriceListRow,
} from './price-list';

const item = (id: string, unit = 'h', unitPrice: number | null = 10): PriceListRow => ({ id, type: 'item', description: id, unit, unitPrice });
const section = (id: string, title: string): PriceListRow => ({ id, type: 'section', description: title });

describe('referencia automática', () => {
    it('formatea LP-AAAA-NNNN', () => {
        expect(formatPriceListReference(2026, 1)).toBe('LP-2026-0001');
        expect(formatPriceListReference(2026, 123)).toBe('LP-2026-0123');
    });

    it('incrementa dentro del año y reinicia al cambiar de año', () => {
        expect(nextPriceListSeq(undefined, 2026)).toBe(1);
        expect(nextPriceListSeq({ year: 2026, lastSeq: 7 }, 2026)).toBe(8);
        expect(nextPriceListSeq({ year: 2025, lastSeq: 40 }, 2026)).toBe(1);
    });
});

describe('groupPriceListRows', () => {
    it('lista plana → un grupo sin título', () => {
        const g = groupPriceListRows([item('a'), item('b')]);
        expect(g).toHaveLength(1);
        expect(g[0].title).toBeNull();
        expect(g[0].items.map((r) => r.id)).toEqual(['a', 'b']);
    });

    it('con secciones respeta el orden; las líneas previas forman grupo sin título', () => {
        const g = groupPriceListRows([item('suelta'), section('s1', 'Albañilería'), item('a'), section('s2', 'Pintura'), item('b'), item('c')]);
        expect(g.map((s) => s.title)).toEqual([null, 'Albañilería', 'Pintura']);
        expect(g[2].items.map((r) => r.id)).toEqual(['b', 'c']);
    });

    it('conserva secciones vacías y no crea grupo inicial vacío', () => {
        const g = groupPriceListRows([section('s1', 'Vacía'), section('s2', 'Con líneas'), item('a')]);
        expect(g.map((s) => [s.title, s.items.length])).toEqual([['Vacía', 0], ['Con líneas', 1]]);
    });

    it('cuenta solo líneas (no secciones)', () => {
        expect(countPriceListItems([section('s', 'S'), item('a'), item('b')])).toBe(2);
    });
});

describe('priceColumnHeader', () => {
    it('€/h cuando todas las líneas son por hora (tolera mayúsculas)', () => {
        expect(priceColumnHeader([item('a', 'h'), item('b', 'H')])).toBe('€/h');
    });
    it('Precio si hay unidades mezcladas o no hay líneas', () => {
        expect(priceColumnHeader([item('a', 'h'), item('b', 'servicio')])).toBe('Precio');
        expect(priceColumnHeader([])).toBe('Precio');
    });
});

describe('moveRow', () => {
    it('mueve sin mutar el original', () => {
        const rows = ['a', 'b', 'c', 'd'];
        expect(moveRow(rows, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
        expect(moveRow(rows, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
        expect(rows).toEqual(['a', 'b', 'c', 'd']);
        expect(moveRow(rows, 9, 0)).toEqual(rows);
    });
});

describe('tarifa por horas de arranque', () => {
    it('4 oficios con Oficial 1ª/2ª, Peón (h) y Desplazamiento (servicio), sin precios', () => {
        let n = 0;
        const rows = buildHourlyRateStarterRows(() => `id${++n}`);
        const groups = groupPriceListRows(rows);
        expect(groups.map((g) => g.title)).toEqual(['Albañilería', 'Fontanería', 'Electricidad', 'Pintura']);
        for (const g of groups) {
            expect(g.items.map((r) => `${r.description}|${r.unit}`)).toEqual(['Oficial 1ª|h', 'Oficial 2ª|h', 'Peón|h', 'Desplazamiento|servicio']);
            expect(g.items.every((r) => r.unitPrice === null)).toBe(true);
        }
        expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    });
});

describe('validityDays', () => {
    it('días entre fecha y válida hasta', () => {
        expect(validityDays('2026-10-07', '2026-10-22')).toBe(15);
        expect(validityDays('2026-10-07', undefined)).toBeNull();
    });
});
