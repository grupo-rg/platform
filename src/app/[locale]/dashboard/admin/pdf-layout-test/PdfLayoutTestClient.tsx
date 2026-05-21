'use client';

/**
 * Sprint 4 Fase B (B1) — Client component para `/dashboard/admin/pdf-layout-test`.
 *
 * Flujo:
 *   1. Drop zone (o file picker) acepta un PDF (max 50 MB).
 *   2. Al pulsar "Analizar", POST multipart/form-data a
 *      `/api/admin/test-pdf-layout` (proxy a ai-core).
 *   3. Renderiza métricas + tabla de partidas + métricas por página.
 *
 * El componente NO maneja i18n directamente — recibe `labels` desde el Server
 * Component padre (que las resuelve vía `next-intl`).
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
    Upload,
    FileText,
    CheckCircle2,
    AlertTriangle,
    XCircle,
    Loader2,
    Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type {
    TestPdfLayoutResponse,
    TestPdfLayoutItem,
    TestPdfLayoutPageMetric,
} from '@/app/api/admin/test-pdf-layout/route';

const MAX_PDF_BYTES = 50 * 1024 * 1024;

export interface PdfLayoutTestLabels {
    dropTitle: string;
    dropSubtitle: string;
    chooseFile: string;
    analyze: string;
    analyzing: string;
    clear: string;
    fileSize: string;
    fileLabel: string;
    errorTitle: string;
    viableTitle: string;
    notViableTitle: string;
    notViableHint: string;
    metricPartidas: string;
    metricQtyRate: string;
    metricChapterRate: string;
    metricDuration: string;
    metricPages: string;
    metricPagesWithHeader: string;
    itemsTitle: string;
    itemsHint: string;
    truncatedWarning: string;
    colCode: string;
    colDescription: string;
    colQty: string;
    colUnit: string;
    colChapter: string;
    colSubChapter: string;
    colPage: string;
    emptyItems: string;
    pageMetricsTitle: string;
    pmColPage: string;
    pmColHeader: string;
    pmColRows: string;
    pmColPartidas: string;
    pmColQty: string;
    reasonLabel: string;
}

function fmtBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function fmtPct(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
}

function fmtNumber(value: number | null | undefined): string {
    if (value == null) return '—';
    return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(value);
}

export function PdfLayoutTestClient({ labels }: { labels: PdfLayoutTestLabels }) {
    const [file, setFile] = useState<File | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [result, setResult] = useState<TestPdfLayoutResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);

    const acceptFile = useCallback((next: File | null) => {
        setError(null);
        setResult(null);
        if (!next) {
            setFile(null);
            return;
        }
        if (!next.name.toLowerCase().endsWith('.pdf')) {
            setError('Solo se aceptan archivos .pdf.');
            return;
        }
        if (next.size > MAX_PDF_BYTES) {
            setError(`El PDF supera el límite (${fmtBytes(MAX_PDF_BYTES)}).`);
            return;
        }
        setFile(next);
    }, []);

    const handleDrop = useCallback(
        (e: React.DragEvent<HTMLDivElement>) => {
            e.preventDefault();
            setIsDragging(false);
            const dropped = e.dataTransfer.files?.[0] ?? null;
            acceptFile(dropped);
        },
        [acceptFile],
    );

    const handleAnalyze = useCallback(async () => {
        if (!file) return;
        setIsAnalyzing(true);
        setError(null);
        setResult(null);

        try {
            const fd = new FormData();
            fd.append('file', file, file.name);
            const res = await fetch('/api/admin/test-pdf-layout', {
                method: 'POST',
                body: fd,
            });
            const text = await res.text();
            let json: any = null;
            try {
                json = text ? JSON.parse(text) : null;
            } catch {
                json = null;
            }
            if (!res.ok) {
                const detail =
                    json?.detail ??
                    json?.error ??
                    `HTTP ${res.status}: ${text || 'Sin detalle'}`;
                throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
            }
            setResult(json as TestPdfLayoutResponse);
        } catch (err: any) {
            console.error('[pdf-layout-test] analyze failed', err);
            setError(err?.message ?? 'Error desconocido');
        } finally {
            setIsAnalyzing(false);
        }
    }, [file]);

    const handleClear = useCallback(() => {
        setFile(null);
        setResult(null);
        setError(null);
        if (inputRef.current) inputRef.current.value = '';
    }, []);

    return (
        <div className="space-y-6">
            <Card>
                <CardContent className="p-6">
                    <div
                        onDragOver={(e) => {
                            e.preventDefault();
                            setIsDragging(true);
                        }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={handleDrop}
                        className={cn(
                            'relative flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-lg px-6 py-12 transition-colors cursor-pointer',
                            isDragging
                                ? 'border-primary bg-primary/5'
                                : 'border-border bg-muted/30 hover:bg-muted/50',
                        )}
                        onClick={() => inputRef.current?.click()}
                    >
                        <input
                            ref={inputRef}
                            type="file"
                            accept=".pdf,application/pdf"
                            className="hidden"
                            onChange={(e) => acceptFile(e.target.files?.[0] ?? null)}
                        />
                        <Upload className="h-10 w-10 text-muted-foreground" />
                        <div className="text-center">
                            <p className="text-base font-medium text-foreground">{labels.dropTitle}</p>
                            <p className="text-xs text-muted-foreground mt-1">{labels.dropSubtitle}</p>
                        </div>
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={(e) => {
                                e.stopPropagation();
                                inputRef.current?.click();
                            }}
                            disabled={isAnalyzing}
                        >
                            {labels.chooseFile}
                        </Button>
                    </div>

                    {file && (
                        <div className="mt-4 flex flex-wrap items-center gap-3 p-3 rounded-md border bg-card">
                            <FileText className="h-5 w-5 text-muted-foreground" />
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-foreground truncate">
                                    {file.name}
                                </p>
                                <p className="text-[11px] text-muted-foreground">
                                    {labels.fileSize}: {fmtBytes(file.size)}
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <Button
                                    type="button"
                                    size="sm"
                                    onClick={handleAnalyze}
                                    disabled={isAnalyzing}
                                >
                                    {isAnalyzing ? (
                                        <>
                                            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                            {labels.analyzing}
                                        </>
                                    ) : (
                                        labels.analyze
                                    )}
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    onClick={handleClear}
                                    disabled={isAnalyzing}
                                    aria-label={labels.clear}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {error && (
                <Alert variant="destructive">
                    <XCircle className="h-4 w-4" />
                    <AlertTitle>{labels.errorTitle}</AlertTitle>
                    <AlertDescription className="text-xs font-mono whitespace-pre-wrap break-all">
                        {error}
                    </AlertDescription>
                </Alert>
            )}

            {result && (
                <PdfLayoutTestResult result={result} labels={labels} />
            )}
        </div>
    );
}

function PdfLayoutTestResult({
    result,
    labels,
}: {
    result: TestPdfLayoutResponse;
    labels: PdfLayoutTestLabels;
}) {
    return (
        <div className="space-y-6">
            <Card
                className={cn(
                    'border-2',
                    result.viable
                        ? 'border-emerald-500/40 bg-emerald-500/5'
                        : 'border-amber-500/40 bg-amber-500/5',
                )}
            >
                <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-lg">
                        {result.viable ? (
                            <>
                                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                                {labels.viableTitle}
                            </>
                        ) : (
                            <>
                                <AlertTriangle className="h-5 w-5 text-amber-500" />
                                {labels.notViableTitle}
                            </>
                        )}
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {!result.viable && (
                        <div className="text-sm text-amber-700 dark:text-amber-300">
                            <p>
                                <span className="font-semibold">{labels.reasonLabel}:</span>{' '}
                                <code className="font-mono text-xs">
                                    {result.reason ?? 'unknown'}
                                </code>
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                                {labels.notViableHint}
                            </p>
                        </div>
                    )}

                    {/* Sprint 4 Fase F — metadata del documento (título + address). */}
                    {(result.documentTitle || result.documentAddress || result.mode) && (
                        <div className="rounded-md border bg-muted/30 p-3 space-y-1.5">
                            {result.documentTitle && (
                                <div>
                                    <div className="text-xs text-muted-foreground uppercase tracking-wide">
                                        Proyecto
                                    </div>
                                    <div className="text-sm font-semibold text-foreground">
                                        {result.documentTitle}
                                    </div>
                                </div>
                            )}
                            {result.documentAddress && (
                                <div>
                                    <div className="text-xs text-muted-foreground uppercase tracking-wide">
                                        Ubicación
                                    </div>
                                    <div className="text-sm text-foreground">
                                        {result.documentAddress}
                                    </div>
                                </div>
                            )}
                            {result.mode && (
                                <div className="pt-1">
                                    <Badge variant="outline" className="font-mono text-xs">
                                        mode: {result.mode}
                                    </Badge>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                        <Metric label={labels.metricPartidas} value={String(result.partidasCount)} />
                        <Metric
                            label={labels.metricQtyRate}
                            value={fmtPct(result.qtyRate)}
                            tone={result.qtyRate >= 0.8 ? 'emerald' : result.qtyRate >= 0.5 ? 'amber' : 'rose'}
                        />
                        <Metric
                            label={labels.metricChapterRate}
                            value={fmtPct(result.chapterRate)}
                            tone={
                                result.chapterRate >= 0.8
                                    ? 'emerald'
                                    : result.chapterRate >= 0.5
                                        ? 'amber'
                                        : 'rose'
                            }
                        />
                        <Metric
                            label={labels.metricDuration}
                            value={`${result.durationSeconds.toFixed(2)} s`}
                        />
                        <Metric label={labels.metricPages} value={String(result.pagesTotal)} />
                        <Metric
                            label={labels.metricPagesWithHeader}
                            value={String(result.pagesWithHeader)}
                        />
                    </div>
                </CardContent>
            </Card>

            <ItemsTable items={result.items} truncated={result.truncated} labels={labels} />

            <PageMetricsTable pageMetrics={result.pageMetrics} labels={labels} />
        </div>
    );
}

function Metric({
    label,
    value,
    tone,
}: {
    label: string;
    value: string;
    tone?: 'emerald' | 'amber' | 'rose';
}) {
    const toneClass = tone === 'emerald'
        ? 'text-emerald-600 dark:text-emerald-400'
        : tone === 'amber'
            ? 'text-amber-600 dark:text-amber-400'
            : tone === 'rose'
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-foreground';
    return (
        <div className="rounded-md border bg-card p-3">
            <p className="text-[11px] text-muted-foreground">{label}</p>
            <p className={cn('text-xl font-semibold tabular-nums mt-1', toneClass)}>{value}</p>
        </div>
    );
}

function ItemsTable({
    items,
    truncated,
    labels,
}: {
    items: TestPdfLayoutItem[];
    truncated: boolean;
    labels: PdfLayoutTestLabels;
}) {
    const sample = useMemo(() => items, [items]);
    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between gap-2">
                    <span>{labels.itemsTitle}</span>
                    <Badge variant="secondary" className="font-normal text-xs">
                        {items.length}
                    </Badge>
                </CardTitle>
                <p className="text-xs text-muted-foreground">{labels.itemsHint}</p>
                {truncated && (
                    <Alert className="mt-2 border-amber-500/40 bg-amber-500/5">
                        <AlertTriangle className="h-4 w-4 text-amber-500" />
                        <AlertDescription className="text-xs">
                            {labels.truncatedWarning}
                        </AlertDescription>
                    </Alert>
                )}
            </CardHeader>
            <CardContent className="p-0">
                {sample.length === 0 ? (
                    <p className="p-8 text-center text-sm text-muted-foreground">
                        {labels.emptyItems}
                    </p>
                ) : (
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[110px]">{labels.colCode}</TableHead>
                                    <TableHead>{labels.colDescription}</TableHead>
                                    <TableHead className="text-right w-[90px]">
                                        {labels.colQty}
                                    </TableHead>
                                    <TableHead className="w-[70px]">{labels.colUnit}</TableHead>
                                    <TableHead className="w-[180px]">{labels.colChapter}</TableHead>
                                    <TableHead className="w-[180px]">{labels.colSubChapter}</TableHead>
                                    <TableHead className="w-[60px] text-right">
                                        {labels.colPage}
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {sample.map((item, idx) => (
                                    <TableRow key={`${item.code}-${idx}`}>
                                        <TableCell className="font-mono text-xs">
                                            {item.code || '—'}
                                        </TableCell>
                                        <TableCell className="text-xs max-w-md">
                                            <span className="line-clamp-2 break-words">
                                                {item.description || '—'}
                                            </span>
                                        </TableCell>
                                        <TableCell
                                            className={cn(
                                                'text-right tabular-nums font-mono text-xs',
                                                item.quantity == null && 'text-rose-500',
                                            )}
                                        >
                                            {fmtNumber(item.quantity)}
                                        </TableCell>
                                        <TableCell className="text-xs">
                                            {item.unit || '—'}
                                        </TableCell>
                                        <TableCell className="text-xs text-muted-foreground">
                                            <span className="line-clamp-1 break-words">
                                                {item.chapter || '—'}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-xs text-muted-foreground">
                                            <span className="line-clamp-1 break-words">
                                                {item.sub_chapter || '—'}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-right text-xs tabular-nums">
                                            {item.page ?? '—'}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function PageMetricsTable({
    pageMetrics,
    labels,
}: {
    pageMetrics: TestPdfLayoutPageMetric[];
    labels: PdfLayoutTestLabels;
}) {
    if (pageMetrics.length === 0) return null;
    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between gap-2">
                    <span>{labels.pageMetricsTitle}</span>
                    <Badge variant="secondary" className="font-normal text-xs">
                        {pageMetrics.length}
                    </Badge>
                </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
                <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                    <Table>
                        <TableHeader className="sticky top-0 bg-card">
                            <TableRow>
                                <TableHead className="w-[60px]">{labels.pmColPage}</TableHead>
                                <TableHead className="w-[100px]">{labels.pmColHeader}</TableHead>
                                <TableHead className="text-right">{labels.pmColRows}</TableHead>
                                <TableHead className="text-right">{labels.pmColPartidas}</TableHead>
                                <TableHead className="text-right">{labels.pmColQty}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {pageMetrics.map((pm) => (
                                <TableRow key={pm.page}>
                                    <TableCell className="font-mono text-xs">{pm.page}</TableCell>
                                    <TableCell>
                                        {pm.hasHeader ? (
                                            <Badge variant="secondary" className="text-[10px]">
                                                <CheckCircle2 className="h-2.5 w-2.5 mr-1 text-emerald-500" />
                                                {pm.hasHeader ? 'sí' : 'no'}
                                            </Badge>
                                        ) : (
                                            <Badge variant="outline" className="text-[10px]">
                                                no
                                            </Badge>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-right text-xs tabular-nums">
                                        {pm.rowsFound}
                                    </TableCell>
                                    <TableCell className="text-right text-xs tabular-nums">
                                        {pm.partidasExtracted}
                                    </TableCell>
                                    <TableCell className="text-right text-xs tabular-nums">
                                        {pm.qtyFound}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    );
}
