/**
 * Genera PDFs de ejemplo (sin Firestore) para revisar visualmente el
 * presupuesto con/sin plantilla de condiciones y la lista de precios.
 *
 *   npx tsx scripts/render-sample-pdfs.tsx <directorio-salida>
 *
 * Salida: pdf_presupuesto_default.pdf, pdf_presupuesto_plantilla.pdf,
 *         pdf_lista_precios.pdf (con IVA), pdf_lista_precios_sin_iva.pdf
 */
import React from 'react';
import path from 'node:path';
import { renderToFile } from '@react-pdf/renderer';
import { BudgetDocument } from '@/components/pdf/BudgetDocument';
import { PriceListDocument, type PriceListDocumentData } from '@/components/pdf/PriceListDocument';
import { DEFAULT_BUDGET_BLOCKS } from '@/backend/document-template/domain/default-budget-template';
import { buildHourlyRateStarterRows } from '@/backend/price-list/domain/price-list';

const outDir = process.argv[2] || '.';

const company: any = {
    id: 'company',
    name: 'Grupo RG',
    legalName: 'Grupo RG S.L.',
    cif: 'B12345678',
    address: 'C/ Ejemplo 1, 07001 Palma',
    phone: '+34 600 000 000',
    email: 'info@ejemplo.es',
    web: 'https://ejemplo.es',
    tagline: 'Construcción y reformas en Mallorca',
    footerText: 'Inscrita en el Registro Mercantil de Baleares',
    updatedAt: new Date('2026-10-01'),
    updatedBy: 'system',
};

const budgetItems: any[] = [
    {
        id: 'i1', chapter: '01 Demoliciones', originalTask: 'Demolición de alicatado de paredes',
        item: {
            code: 'DEM01', description: 'Demolición de alicatado con medios manuales', unit: 'm2', quantity: 25, unitPrice: 12.5, totalPrice: 312.5,
            breakdown: [
                { code: 'MO001', description: 'Peón ordinario', unit: 'h', quantity: 0.4, price: 22, total: 8.8 },
                { code: '%MA', description: 'Medios auxiliares', unit: '%', quantity: 2, price: 3.7, total: 3.7 },
            ],
        },
    },
    {
        id: 'i2', chapter: '02 Revestimientos', originalTask: 'Alicatado con azulejo cerámico',
        item: { code: 'REV01', description: 'Alicatado con azulejo cerámico 30x60 tomado con adhesivo', unit: 'm2', quantity: 25, unitPrice: 48.2, totalPrice: 1205 },
    },
];
const costBreakdown: any = { materialExecutionPrice: 1517.5, overheadExpenses: 0, industrialBenefit: 0, tax: 151.75, total: 1669.25 };

const budgetProps = {
    budgetNumber: '2026-10/0001',
    clientName: 'María Pérez',
    clientEmail: 'maria@ejemplo.es',
    clientAddress: 'C/ Mayor 5, Palma',
    items: budgetItems,
    costBreakdown,
    date: '7 de octubre de 2026',
    notes: 'Incluye 12 meses de garantía.',
    budgetConfig: { tax: 10, marginGG: 0, marginBI: 0 },
    company,
};

// Plantilla "editada": bloques propios + marcadores + viñetas + bloque de lista.
const editedTemplate = {
    disclaimer: '* Presupuesto para {{cliente}} emitido por {{empresa}} el {{fecha}}. Válido {{validez_dias}} días.',
    blocks: [
        {
            id: 'e1',
            title: 'Condiciones particulares',
            body: 'Estimado/a {{cliente}}, el importe total de **{{total}}** se abonará según el siguiente calendario:\n\n- 40 % a la firma del presupuesto\n- 40 % a mitad de obra\n- 20 % a la finalización',
        },
        {
            id: 'e2',
            title: 'Materiales no incluidos',
            format: 'list' as const,
            body: 'Sanitarios y grifería\nMobiliario de cocina\nElectrodomésticos',
        },
        DEFAULT_BUDGET_BLOCKS[5],
        { id: 'e3', title: '', variant: 'highlight' as const, body: 'Gracias por confiar en {{empresa}}.' },
    ],
};

// Tarifa por horas de 4 oficios (arranque + precios de ejemplo).
let n = 0;
const rows = buildHourlyRateStarterRows(() => `r${++n}`);
const samplePrices: Record<string, number[]> = {
    Albañilería: [32, 28, 22, 35],
    Fontanería: [36, 30, 22, 40],
    Electricidad: [37, 31, 22, 40],
    Pintura: [30, 26, 21],
};
let currentTrade = '';
let idx = 0;
const priceRows = rows
    .filter((r) => {
        // Pintura sin desplazamiento → su columna de precio se rotula "€/h".
        if (r.type === 'section') currentTrade = r.description;
        return !(currentTrade === 'Pintura' && r.description === 'Desplazamiento');
    })
    .map((r) => {
        if (r.type === 'section') {
            currentTrade = r.description;
            idx = 0;
            return r;
        }
        const price = samplePrices[currentTrade]?.[idx++];
        return { ...r, unitPrice: price ?? null };
    });

const priceList: PriceListDocumentData = {
    title: 'Tarifa de precios por hora 2026',
    reference: 'LP-2026-0001',
    clientName: 'Inmobiliaria Ejemplo S.L.',
    clientEmail: 'compras@inmo-ejemplo.es',
    clientAddress: 'Av. Jaime III 10, 07012 Palma',
    date: '2026-10-07',
    validUntil: '2026-12-31',
    pricesIncludeVat: true,
    vatRate: 21,
    intro:
        'Tarifa de mano de obra por horas para trabajos de mantenimiento y pequeñas reformas en los inmuebles de {{cliente}}\nLos precios se aplican por categoría profesional y oficio.',
    notes: 'Horario laborable de lunes a viernes de 8:00 a 17:00.',
    items: priceRows,
    blocks: [
        {
            id: 'b1',
            title: 'Materiales no incluidos',
            format: 'list',
            body: 'Materiales de obra y consumibles\nSanitarios, grifería y mecanismos eléctricos\nAlquiler de maquinaria y contenedores',
        },
        {
            id: 'b2',
            title: 'Condiciones',
            body: '- **Validez:** hasta la fecha indicada en la cabecera ({{validez_dias}} días).\n- **Facturación:** tiempo efectivo de trabajo por categoría profesional.\n- **Forma de pago:** transferencia a 30 días desde la fecha de factura.',
        },
    ],
    disclaimer: '* Precios orientativos; cada trabajo se confirma con su orden de trabajo.',
};

(async () => {
    const out = (f: string) => path.join(outDir, f);
    await renderToFile(<BudgetDocument {...budgetProps} />, out('pdf_presupuesto_default.pdf'));
    await renderToFile(<BudgetDocument {...budgetProps} conditions={editedTemplate} />, out('pdf_presupuesto_plantilla.pdf'));
    await renderToFile(<PriceListDocument priceList={priceList} company={company} />, out('pdf_lista_precios.pdf'));
    await renderToFile(
        <PriceListDocument priceList={{ ...priceList, pricesIncludeVat: false, title: 'Tarifa de precios por hora 2026 (sin IVA)' }} company={company} />,
        out('pdf_lista_precios_sin_iva.pdf'),
    );
    console.log('PDFs generados en', path.resolve(outDir));
})();
