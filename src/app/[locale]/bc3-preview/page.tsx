'use client';

/**
 * RUTA DE PREVIEW LOCAL (dev) — NO forma parte del producto.
 *
 * Renderiza el editor real (BudgetEditorWrapper) con un presupuesto BC3 de
 * ejemplo para revisar F5 (doble precio) y F6 (mediciones) sin pipeline ni
 * Firestore. Borrar cuando termine la revisión.
 */

import React from 'react';
import { BudgetEditorWrapper } from '@/components/budget-editor/BudgetEditorWrapper';
import { DEFAULT_COMPANY_CONFIG } from '@/backend/platform/domain/company-config';

type Line = { comment: string; units?: number | null; length?: number | null; width?: number | null; height?: number | null; subtotal?: number | null; is_section?: boolean };

const P = (
    order: number,
    code: string,
    description: string,
    unit: string,
    quantity: number,
    bc3: number,
    ai: number,
    measurements: Line[],
) => ({
    type: 'PARTIDA' as const,
    id: `p-${code}`,
    order,
    code,
    description,
    unit,
    quantity,
    unitPrice: bc3,              // activo por defecto = BC3
    totalPrice: bc3 * quantity,
    bc3_unit_price: bc3,
    ai_unit_price: ai,
    active_price_source: 'bc3' as const,
    measurements,
});

const mockBudget: any = {
    id: 'bc3-preview',
    type: 'measurement',
    source: 'bc3',
    clientName: 'Sasha Cala Murada · PREVIEW',
    title: 'Instalaciones — preview BC3 (doble precio + mediciones)',
    createdAt: new Date().toISOString(),
    config: { marginGG: 13, marginBI: 6, tax: 21 },
    costBreakdown: { materialExecutionPrice: 0, overheadExpenses: 0, industrialBenefit: 0, tax: 0, globalAdjustment: 0, total: 0 },
    chapters: [
        {
            id: 'ch-01', name: '01 Movimiento de tierras', order: 0, totalPrice: 0,
            items: [
                P(1, '01.01', 'Desbroce y limpieza del terreno', 'm2', 200, 3.0, 2.8, [
                    { comment: 'zona piscina', units: 1, length: 200, subtotal: 200 },
                ]),
                P(2, '01.02', 'Excavación con medios mecánicos', 'm3', 313.75, 54.0, 51.2, [
                    { comment: 'Piscina', units: 1, length: 85, height: 2.75, subtotal: 233.75 },
                    { comment: 'SM', units: 1, length: 25, height: 3.2, subtotal: 80 },
                ]),
                P(3, '01.03', 'Excavación en zanjas y pozos', 'm3', 22, 54.0, 60.0, [
                    { comment: 'cimentaciones', units: 1, length: 40, width: 0.5, height: 0.5, subtotal: 10 },
                    { comment: 'zanjas instalaciones', is_section: true },
                    { comment: 'previsión', units: 1, length: 50, width: 0.4, height: 0.6, subtotal: 12 },
                ]),
                P(4, '01.05', 'Relleno con tierras propias', 'm3', 102.5, 28.0, 26.5, [
                    { comment: 'Piscina', units: 1, length: 85, height: 0.5, subtotal: 42.5 },
                    { comment: 'perímetro piscina y sm', units: 1, length: 60, subtotal: 60 },
                ]),
            ],
        },
        {
            id: 'ch-05', name: '05 Instalaciones', order: 1, totalPrice: 0,
            items: [
                P(5, '02EBPLSJ', 'Punto de luz simple JUNG LS 990 blanco', 'ud', 33, 52.62, 55.0, [
                    { comment: 'PLANTA BAJA', is_section: true },
                    { comment: 'Baño 1', units: 2, subtotal: 2 },
                    { comment: 'Dormitorio 1', units: 2, subtotal: 2 },
                    { comment: 'Aseo · Despensa · Lavandería', units: 3, subtotal: 3 },
                    { comment: 'PLANTA PISO', is_section: true },
                    { comment: 'Dormitorios y baños', units: 20, subtotal: 20 },
                    { comment: 'PLANTA CUBIERTA', is_section: true },
                    { comment: 'Barbacoa', units: 1, subtotal: 1 },
                    { comment: 'Otros', units: 5, subtotal: 5 },
                ]),
                P(6, '400712BS990', 'Base enchufe 16 A JUNG LS990', 'ud', 102, 45.0, 51.0, [
                    { comment: 'PLANTA BAJA', is_section: true },
                    { comment: 'Entrada · Baños · Dormitorios', units: 60, subtotal: 60 },
                    { comment: 'PLANTA PISO', is_section: true },
                    { comment: 'Dormitorios · Sala', units: 42, subtotal: 42 },
                ]),
            ],
        },
    ],
};

export default function Bc3PreviewPage() {
    return (
        <div className="min-h-screen bg-background text-foreground p-4 md:p-8">
            <div className="max-w-[1600px] mx-auto mb-4">
                <div className="text-xs uppercase tracking-widest text-amber-600 dark:text-amber-400 font-semibold">Preview local · BC3</div>
                <h1 className="text-2xl font-bold">Editor con doble precio + mediciones</h1>
                <p className="text-sm text-muted-foreground">Presupuesto de ejemplo (sin pipeline). Pulsa un precio para conmutar la fuente; despliega “mediciones” bajo la cantidad.</p>
            </div>
            <BudgetEditorWrapper budget={mockBudget} isAdmin initialCompanyConfig={DEFAULT_COMPANY_CONFIG} />
        </div>
    );
}
