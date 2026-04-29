import Link from 'next/link';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
    CheckCircle2,
    AlertTriangle,
    XCircle,
    Mail,
    Phone,
    MapPin,
    Image as ImageIcon,
    ShieldAlert,
    ArrowRight,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { getAdminLeadsAction } from '@/actions/lead/get-admin-leads.action';
import type { LeadIntakeSource, QualificationDecision } from '@/backend/lead/domain/lead';

const DECISION_META: Record<QualificationDecision, { label: string; className: string; Icon: any }> = {
    qualified: {
        label: 'Cualificado',
        className: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300',
        Icon: CheckCircle2,
    },
    review_required: {
        label: 'Revisar',
        className: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300',
        Icon: AlertTriangle,
    },
    rejected: {
        label: 'Rechazado',
        className: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300',
        Icon: XCircle,
    },
};

const SOURCE_LABEL: Record<LeadIntakeSource, string> = {
    chat_public: 'Chat público',
    wizard: 'Wizard',
    quick_form: 'Form. rápido',
    detailed_form: 'Form. detallado',
    new_build_form: 'Obra nueva',
    demo: 'Demo',
};

const PROJECT_TYPE_LABEL: Record<string, string> = {
    bathroom: 'Baño',
    kitchen: 'Cocina',
    integral: 'Integral',
    new_build: 'Obra nueva',
    pool: 'Piscina',
    other: 'Otro',
};

interface LeadsInboxProps {
    decisions?: QualificationDecision[];
    sources?: LeadIntakeSource[];
    textQuery?: string;
    /** Base de URL donde construir filtros y links de detalle. */
    baseHref?: string;
}

/**
 * Inbox de leads cualificables. Server component.
 * Muestra stats, filtros (toggle vía query params), y una tabla con
 * decisión / score / origen. Click en fila → detalle del lead.
 */
export async function LeadsInbox({
    decisions,
    sources,
    textQuery,
    baseHref = '/dashboard/leads',
}: LeadsInboxProps) {
    const result = await getAdminLeadsAction({
        decisions,
        sources,
        textQuery,
        limit: 100,
    });

    const leads = result.leads ?? [];
    const counts = {
        qualified: leads.filter(l => l.qualification?.decision === 'qualified').length,
        review_required: leads.filter(l => l.qualification?.decision === 'review_required').length,
        rejected: leads.filter(l => l.qualification?.decision === 'rejected').length,
        suspicious: leads.filter(l => l.intake?.suspicious).length,
    };

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="Cualificados" value={counts.qualified} tone="emerald" />
                <StatCard label="Por revisar" value={counts.review_required} tone="amber" />
                <StatCard label="Rechazados" value={counts.rejected} tone="rose" />
                <StatCard label="Sospechosos" value={counts.suspicious} tone="indigo" Icon={ShieldAlert} />
            </div>

            <FilterBar
                selected={{ decisions, sources, q: textQuery }}
                baseHref={baseHref}
            />

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">
                        {leads.length} {leads.length === 1 ? 'lead' : 'leads'}
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    {leads.length === 0 ? (
                        <div className="p-12 text-center text-muted-foreground">
                            No hay leads que coincidan con los filtros.
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Cliente</TableHead>
                                    <TableHead>Solicitud</TableHead>
                                    <TableHead className="text-center">Score</TableHead>
                                    <TableHead>Estado</TableHead>
                                    <TableHead>Origen</TableHead>
                                    <TableHead>Recibido</TableHead>
                                    <TableHead className="w-12"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {leads.map(lead => {
                                    const decision = lead.qualification?.decision || 'review_required';
                                    const meta = DECISION_META[decision];
                                    const detailHref = `${baseHref}/${lead.id}`;
                                    return (
                                        <TableRow key={lead.id} className="hover:bg-muted/50">
                                            <TableCell>
                                                <Link href={detailHref} className="block hover:underline">
                                                    <div className="font-medium">{lead.name}</div>
                                                    <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                                                        <Mail className="h-3 w-3" />
                                                        {lead.email}
                                                    </div>
                                                    {lead.phone && (
                                                        <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                                                            <Phone className="h-3 w-3" />
                                                            {lead.phone}
                                                        </div>
                                                    )}
                                                </Link>
                                            </TableCell>
                                            <TableCell className="max-w-md">
                                                {lead.intake ? (
                                                    <div className="space-y-1">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <Badge variant="outline" className="font-normal">
                                                                {PROJECT_TYPE_LABEL[lead.intake.projectType] || lead.intake.projectType}
                                                            </Badge>
                                                            {lead.intake.approxSquareMeters && (
                                                                <span className="text-xs text-muted-foreground">
                                                                    {lead.intake.approxSquareMeters} m²
                                                                </span>
                                                            )}
                                                            {(lead.intake.postalCode || lead.intake.city) && (
                                                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                                                    <MapPin className="h-3 w-3" />
                                                                    {lead.intake.postalCode} {lead.intake.city}
                                                                </span>
                                                            )}
                                                            {lead.intake.imagesCount > 0 && (
                                                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                                                    <ImageIcon className="h-3 w-3" />
                                                                    {lead.intake.imagesCount}
                                                                </span>
                                                            )}
                                                            {lead.intake.suspicious && (
                                                                <Badge className="bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300">
                                                                    <ShieldAlert className="h-3 w-3 mr-1" />
                                                                    Sospechoso
                                                                </Badge>
                                                            )}
                                                            {lead.qualification?.lowTrust && (
                                                                <Badge
                                                                    className="bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300"
                                                                    title={(lead.qualification.lowTrustReasons || []).join(' · ')}
                                                                >
                                                                    Baja confianza
                                                                </Badge>
                                                            )}
                                                        </div>
                                                        <p className="text-xs text-muted-foreground line-clamp-2">
                                                            {lead.intake.descriptionPreview}
                                                        </p>
                                                    </div>
                                                ) : (
                                                    <span className="text-xs text-muted-foreground">Sin intake</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-center font-mono text-sm">
                                                {lead.qualification?.score ?? '—'}
                                            </TableCell>
                                            <TableCell>
                                                <Badge className={meta.className}>
                                                    <meta.Icon className="h-3 w-3 mr-1" />
                                                    {meta.label}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-xs text-muted-foreground">
                                                {lead.intake?.source ? SOURCE_LABEL[lead.intake.source] : '—'}
                                            </TableCell>
                                            <TableCell className="text-xs text-muted-foreground">
                                                {format(new Date(lead.createdAt), 'dd MMM HH:mm', { locale: es })}
                                            </TableCell>
                                            <TableCell>
                                                <Link
                                                    href={detailHref}
                                                    className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-muted"
                                                    aria-label="Ver detalle"
                                                >
                                                    <ArrowRight className="h-4 w-4" />
                                                </Link>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

function StatCard({
    label,
    value,
    tone,
    Icon,
}: {
    label: string;
    value: number;
    tone: 'emerald' | 'amber' | 'rose' | 'indigo';
    Icon?: any;
}) {
    const toneClass = {
        emerald: 'text-emerald-600 dark:text-emerald-400',
        amber: 'text-amber-600 dark:text-amber-400',
        rose: 'text-rose-600 dark:text-rose-400',
        indigo: 'text-indigo-600 dark:text-indigo-400',
    }[tone];

    return (
        <Card>
            <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">{label}</span>
                    {Icon && <Icon className={`h-4 w-4 ${toneClass}`} />}
                </div>
                <div className={`mt-2 text-3xl font-semibold ${toneClass}`}>{value}</div>
            </CardContent>
        </Card>
    );
}

function FilterBar({
    selected,
    baseHref,
}: {
    selected: { decisions?: QualificationDecision[]; sources?: LeadIntakeSource[]; q?: string };
    baseHref: string;
}) {
    const decisionFilters: { value: QualificationDecision; label: string }[] = [
        { value: 'qualified', label: 'Cualificados' },
        { value: 'review_required', label: 'Por revisar' },
        { value: 'rejected', label: 'Rechazados' },
    ];

    const sourceFilters: { value: LeadIntakeSource; label: string }[] = [
        { value: 'chat_public', label: 'Chat' },
        { value: 'quick_form', label: 'Form. rápido' },
        { value: 'detailed_form', label: 'Form. detallado' },
        { value: 'new_build_form', label: 'Obra nueva' },
        { value: 'wizard', label: 'Wizard' },
    ];

    const isDecisionActive = (d: QualificationDecision) => selected.decisions?.includes(d);
    const isSourceActive = (s: LeadIntakeSource) => selected.sources?.includes(s);

    function buildHref(toggle: 'decision' | 'source', value: string) {
        const params = new URLSearchParams();
        const selectedDecisions = new Set(selected.decisions || []);
        const selectedSources = new Set(selected.sources || []);

        if (toggle === 'decision') {
            if (selectedDecisions.has(value as QualificationDecision)) {
                selectedDecisions.delete(value as QualificationDecision);
            } else {
                selectedDecisions.add(value as QualificationDecision);
            }
        } else {
            if (selectedSources.has(value as LeadIntakeSource)) {
                selectedSources.delete(value as LeadIntakeSource);
            } else {
                selectedSources.add(value as LeadIntakeSource);
            }
        }

        // Mantener tab=inbox para que el filtrado no salte al kanban.
        params.set('tab', 'inbox');
        if (selectedDecisions.size > 0) params.set('decision', [...selectedDecisions].join(','));
        if (selectedSources.size > 0) params.set('source', [...selectedSources].join(','));
        if (selected.q) params.set('q', selected.q);

        return `${baseHref}?${params.toString()}`;
    }

    return (
        <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-xs text-muted-foreground">Decisión:</span>
            {decisionFilters.map(f => (
                <Link
                    key={f.value}
                    href={buildHref('decision', f.value)}
                    className={`px-2.5 py-1 rounded-full border text-xs transition-colors ${
                        isDecisionActive(f.value)
                            ? 'bg-foreground text-background border-foreground'
                            : 'border-border hover:bg-muted'
                    }`}
                >
                    {f.label}
                </Link>
            ))}
            <span className="text-xs text-muted-foreground ml-4">Origen:</span>
            {sourceFilters.map(f => (
                <Link
                    key={f.value}
                    href={buildHref('source', f.value)}
                    className={`px-2.5 py-1 rounded-full border text-xs transition-colors ${
                        isSourceActive(f.value)
                            ? 'bg-foreground text-background border-foreground'
                            : 'border-border hover:bg-muted'
                    }`}
                >
                    {f.label}
                </Link>
            ))}
        </div>
    );
}
