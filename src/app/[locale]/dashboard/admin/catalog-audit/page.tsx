/**
 * Admin "Catalog Audit" page.
 *
 * Muestra el resultado del audit de calidad del catálogo COAATMCA generado
 * por `services/ai-core/scripts/audit_catalog_data_quality.py`, leyendo los
 * CSVs persistidos en `data/audit/`.
 *
 * Sirve tres propósitos:
 *   1. Visualizar el estado de calidad del catálogo en producción (Firestore).
 *   2. Comparar contra el JSON source-of-truth y detectar bugs de ingest.
 *   3. (Futuro) servir de punto de entrada para acciones de datafix
 *      (fusionar duplicados, normalizar units, etc.).
 *
 * Acceso: admin only (verifyAuth(true)). Non-admin → redirect /dashboard.
 */

import { redirect } from 'next/navigation';
import { verifyAuth } from '@/backend/auth/auth.middleware';
import { getCatalogAuditAction } from '@/actions/admin/get-catalog-audit.action';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AuditIssuesTable } from '@/components/admin/catalog-audit/audit-issues-table';
import { ClipboardList, AlertCircle, AlertTriangle, Info, Database, FileJson, Layers } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function CatalogAuditPage() {
    const auth = await verifyAuth(true);
    if (!auth) redirect('/dashboard');

    const audit = await getCatalogAuditAction();

    if (!audit.hasReport) {
        return (
            <div className="flex-1 space-y-6 max-w-5xl mx-auto p-4 md:p-8">
                <PageHeader />
                <Card>
                    <CardContent className="p-12 text-center space-y-3">
                        <ClipboardList className="w-12 h-12 mx-auto text-muted-foreground" />
                        <p className="text-lg font-medium">No hay reportes de audit</p>
                        <p className="text-sm text-muted-foreground max-w-md mx-auto">
                            Para generar el reporte, ejecuta el script de audit y guarda los CSVs
                            en <code className="bg-muted px-1 py-0.5 rounded">data/audit/</code>:
                        </p>
                        <pre className="text-left text-xs bg-muted p-4 rounded max-w-xl mx-auto overflow-x-auto">
{`# Audit del JSON local source-of-truth
python services/ai-core/scripts/audit_catalog_data_quality.py \\
    --json prices/coaatmca_2025_price_book.json \\
    --output data/audit/audit_catalog_json_source.csv

# Audit de Firestore production
python services/ai-core/scripts/audit_catalog_data_quality.py \\
    --output data/audit/audit_catalog_firestore.csv`}
                        </pre>
                    </CardContent>
                </Card>
            </div>
        );
    }

    const issueTypes = Object.keys(audit.summary.byIssueType).sort();

    return (
        <div className="flex-1 space-y-6 max-w-7xl mx-auto p-4 md:p-8">
            <PageHeader generatedAt={audit.generatedAt} />

            {/* Stat cards: severity */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard
                    icon={<AlertCircle className="h-4 w-4" />}
                    label="Errores"
                    value={audit.summary.bySeverity.error}
                    tone="text-red-600 dark:text-red-400"
                />
                <StatCard
                    icon={<AlertTriangle className="h-4 w-4" />}
                    label="Warnings"
                    value={audit.summary.bySeverity.warning}
                    tone="text-amber-600 dark:text-amber-400"
                />
                <StatCard
                    icon={<Info className="h-4 w-4" />}
                    label="Info"
                    value={audit.summary.bySeverity.info}
                    tone="text-sky-600 dark:text-sky-400"
                />
                <StatCard
                    icon={<Layers className="h-4 w-4" />}
                    label="Total issues únicos"
                    value={audit.summary.totalIssues}
                    tone="text-zinc-700 dark:text-zinc-300"
                />
            </div>

            {/* Source breakdown */}
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-base">Comparación JSON source-of-truth vs Firestore production</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="flex items-center gap-3 p-3 rounded-md border border-violet-500/30 bg-violet-500/5">
                            <FileJson className="h-5 w-5 text-violet-600" />
                            <div>
                                <div className="text-xs text-muted-foreground">Solo en JSON</div>
                                <div className="text-2xl font-bold text-violet-700 dark:text-violet-300">
                                    {audit.deltas.onlyInJson}
                                </div>
                                <div className="text-[10px] text-muted-foreground">
                                    Issues que el ingest pipeline arregla
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-3 p-3 rounded-md border border-zinc-500/30 bg-zinc-500/5">
                            <Layers className="h-5 w-5" />
                            <div>
                                <div className="text-xs text-muted-foreground">En ambos</div>
                                <div className="text-2xl font-bold">{audit.deltas.inBoth}</div>
                                <div className="text-[10px] text-muted-foreground">
                                    Issues reales del catálogo (requieren datafix)
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-3 p-3 rounded-md border border-emerald-500/30 bg-emerald-500/5">
                            <Database className="h-5 w-5 text-emerald-600" />
                            <div>
                                <div className="text-xs text-muted-foreground">Solo en Firestore</div>
                                <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">
                                    {audit.deltas.onlyInFirestore}
                                </div>
                                <div className="text-[10px] text-muted-foreground">
                                    Issues introducidos por el ingest (¿bug?)
                                </div>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Issue type breakdown */}
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-base">Issues por tipo</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-wrap gap-2">
                        {issueTypes.map(t => (
                            <Badge key={t} variant="secondary" className="text-xs">
                                <code className="mr-1">{t}</code>
                                <span className="font-bold">×{audit.summary.byIssueType[t]}</span>
                            </Badge>
                        ))}
                    </div>
                </CardContent>
            </Card>

            {/* Issues table */}
            <AuditIssuesTable issues={audit.issues} issueTypes={issueTypes} />
        </div>
    );
}

function PageHeader({ generatedAt }: { generatedAt?: string }) {
    return (
        <div className="flex flex-col gap-2 mb-2">
            <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                    <ClipboardList className="w-6 h-6 text-primary" />
                </div>
                <div>
                    <h1 className="text-3xl font-display font-bold tracking-tight">Catalog Audit</h1>
                    <p className="text-muted-foreground">
                        Calidad de datos del catálogo COAATMCA: descripciones duplicadas,
                        unidades raras, mismatches matemáticos y huérfanos del DAG.
                    </p>
                    {generatedAt && (
                        <p className="text-xs text-muted-foreground mt-1">
                            Último reporte: <span className="font-mono">{new Date(generatedAt).toLocaleString('es-ES')}</span>
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}

function StatCard({
    icon,
    label,
    value,
    tone,
}: {
    icon: React.ReactNode;
    label: string;
    value: number;
    tone: string;
}) {
    return (
        <Card className="border-white/5">
            <CardContent className="p-4 flex items-center gap-3">
                <div className={`p-2 rounded-md bg-zinc-100 dark:bg-zinc-800 ${tone}`}>{icon}</div>
                <div>
                    <div className={`text-2xl font-bold ${tone}`}>{value}</div>
                    <div className="text-xs text-muted-foreground">{label}</div>
                </div>
            </CardContent>
        </Card>
    );
}
