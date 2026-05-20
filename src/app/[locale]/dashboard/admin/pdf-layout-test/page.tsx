/**
 * Sprint 4 Fase B (B1) — Admin "PDF Layout Test" page.
 *
 * Permite al Owner subir un PDF cliente y ver la salida cruda del parser
 * TABULAR (Sprint 4 Fase A) sin generar Budget ni invocar el Swarm. Usa el
 * endpoint POST `/api/admin/test-pdf-layout` (proxy hacia el ai-core).
 *
 * Acceso: admin only (`verifyAuth(true)`). Non-admin → redirect `/dashboard`.
 */

import { redirect } from 'next/navigation';
import { verifyAuth } from '@/backend/auth/auth.middleware';
import { PdfLayoutTestClient } from './PdfLayoutTestClient';
import { FileText } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

export const dynamic = 'force-dynamic';
export const metadata = {
    title: 'PDF Layout Test | NexoAI Admin',
};

export default async function PdfLayoutTestPage() {
    const auth = await verifyAuth(true);
    if (!auth) redirect('/dashboard');

    const t = await getTranslations('dashboard');
    const ns = t.raw('pdfLayoutAdmin') as Record<string, any>;

    return (
        <div className="flex-1 space-y-6 max-w-6xl mx-auto p-4 md:p-8">
            <header className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                    <FileText className="w-6 h-6 text-primary" />
                </div>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">
                        {ns?.title ?? 'PDF Layout Test'}
                    </h1>
                    <p className="text-muted-foreground">
                        {ns?.subtitle ??
                            'Diagnóstico del parser TABULAR coord-based sobre un PDF cliente. No genera presupuesto.'}
                    </p>
                </div>
            </header>

            <PdfLayoutTestClient
                labels={{
                    dropTitle: ns?.dropTitle ?? 'Suelta el PDF aquí',
                    dropSubtitle:
                        ns?.dropSubtitle ?? 'o haz clic para seleccionar (máx. 50 MB)',
                    chooseFile: ns?.chooseFile ?? 'Elegir archivo',
                    analyze: ns?.analyze ?? 'Analizar PDF',
                    analyzing: ns?.analyzing ?? 'Analizando…',
                    clear: ns?.clear ?? 'Limpiar',
                    fileSize: ns?.fileSize ?? 'Tamaño',
                    fileLabel: ns?.fileLabel ?? 'PDF seleccionado',
                    errorTitle: ns?.errorTitle ?? 'Error al analizar el PDF',
                    viableTitle: ns?.viableTitle ?? 'Parser TABULAR viable',
                    notViableTitle: ns?.notViableTitle ?? 'Parser TABULAR NO viable',
                    notViableHint:
                        ns?.notViableHint ??
                        'El pipeline productivo caería al fallback (heurística legacy o LLM Vision).',
                    metricPartidas: ns?.metricPartidas ?? 'Partidas extraídas',
                    metricQtyRate: ns?.metricQtyRate ?? 'Cantidad detectada',
                    metricChapterRate: ns?.metricChapterRate ?? 'Capítulo detectado',
                    metricDuration: ns?.metricDuration ?? 'Tiempo',
                    metricPages: ns?.metricPages ?? 'Páginas analizadas',
                    metricPagesWithHeader: ns?.metricPagesWithHeader ?? 'Páginas con cabecera',
                    itemsTitle: ns?.itemsTitle ?? 'Partidas extraídas',
                    itemsHint:
                        ns?.itemsHint ??
                        'Listado completo de partidas con su jerarquía y cantidad.',
                    truncatedWarning:
                        ns?.truncatedWarning ??
                        'Mostrando las primeras 200 partidas (el PDF generó más).',
                    colCode: ns?.colCode ?? 'Código',
                    colDescription: ns?.colDescription ?? 'Descripción',
                    colQty: ns?.colQty ?? 'Cantidad',
                    colUnit: ns?.colUnit ?? 'Unidad',
                    colChapter: ns?.colChapter ?? 'Capítulo',
                    colSubChapter: ns?.colSubChapter ?? 'Subcapítulo',
                    colPage: ns?.colPage ?? 'Pág.',
                    emptyItems: ns?.emptyItems ?? 'El parser no extrajo ninguna partida.',
                    pageMetricsTitle: ns?.pageMetricsTitle ?? 'Métricas por página',
                    pmColPage: ns?.pmColPage ?? 'Pág.',
                    pmColHeader: ns?.pmColHeader ?? 'Cabecera',
                    pmColRows: ns?.pmColRows ?? 'Filas',
                    pmColPartidas: ns?.pmColPartidas ?? 'Partidas',
                    pmColQty: ns?.pmColQty ?? 'Con qty',
                    reasonLabel: ns?.reasonLabel ?? 'Razón',
                }}
            />
        </div>
    );
}
