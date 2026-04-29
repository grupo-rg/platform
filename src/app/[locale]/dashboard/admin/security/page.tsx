import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import Link from 'next/link';
import { Shield, AlertTriangle, Ban, ZapOff, FileWarning } from 'lucide-react';
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
import { getSecurityAuditLogsAction } from '@/actions/admin/get-security-audit-logs.action';
import type { AuditEventType } from '@/backend/shared/security/audit-log';

const TYPE_META: Record<AuditEventType, { label: string; className: string; Icon: any }> = {
    injection_pattern_detected: {
        label: 'Inyección detectada',
        className: 'bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300',
        Icon: AlertTriangle,
    },
    rate_limit_exceeded: {
        label: 'Rate limit',
        className: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300',
        Icon: ZapOff,
    },
    agent_error: {
        label: 'Error del agente',
        className: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300',
        Icon: Ban,
    },
    safety_filter_blocked: {
        label: 'Bloqueo Gemini',
        className: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300',
        Icon: Ban,
    },
    output_guardrail_triggered: {
        label: 'Guardrail output',
        className: 'bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-300',
        Icon: FileWarning,
    },
};

export default async function SecurityAuditPage() {
    const result = await getSecurityAuditLogsAction(150);
    const events = result.events || [];

    const counts = {
        injection: events.filter(e => e.type === 'injection_pattern_detected').length,
        rateLimit: events.filter(e => e.type === 'rate_limit_exceeded').length,
        guardrail: events.filter(e => e.type === 'output_guardrail_triggered').length,
        safety: events.filter(e => e.type === 'safety_filter_blocked').length,
    };

    return (
        <div className="space-y-6 max-w-6xl mx-auto">
            <header className="space-y-2">
                <div className="flex items-center gap-2">
                    <Shield className="h-6 w-6 text-muted-foreground" />
                    <h1 className="font-headline text-3xl">Auditoría de seguridad</h1>
                </div>
                <p className="text-muted-foreground">
                    Eventos de defensa en superficie pública: prompt injection detectado, rate limits y bloqueos.
                </p>
            </header>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="Inyecciones" value={counts.injection} tone="indigo" />
                <StatCard label="Rate limits" value={counts.rateLimit} tone="amber" />
                <StatCard label="Guardrails output" value={counts.guardrail} tone="violet" />
                <StatCard label="Safety Gemini" value={counts.safety} tone="rose" />
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">
                        Últimos {events.length} eventos
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    {events.length === 0 ? (
                        <div className="p-12 text-center text-muted-foreground">
                            Sin incidentes registrados.
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Tipo</TableHead>
                                    <TableHead>Acción</TableHead>
                                    <TableHead>Identidad</TableHead>
                                    <TableHead>Detalle</TableHead>
                                    <TableHead>Lead</TableHead>
                                    <TableHead>Cuándo</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {events.map(ev => {
                                    const meta = TYPE_META[ev.type];
                                    return (
                                        <TableRow key={ev.id}>
                                            <TableCell>
                                                <Badge className={meta.className}>
                                                    <meta.Icon className="h-3 w-3 mr-1" />
                                                    {meta.label}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-xs font-mono text-muted-foreground">
                                                {ev.action || '—'}
                                            </TableCell>
                                            <TableCell className="text-xs font-mono">
                                                {ev.identity || '—'}
                                            </TableCell>
                                            <TableCell className="max-w-md text-xs">
                                                {ev.snippet && (
                                                    <p className="truncate text-muted-foreground italic">
                                                        “{ev.snippet}”
                                                    </p>
                                                )}
                                                {ev.matched.length > 0 && (
                                                    <div className="mt-1 flex flex-wrap gap-1">
                                                        {ev.matched.slice(0, 3).map((m, i) => (
                                                            <Badge
                                                                key={i}
                                                                variant="outline"
                                                                className="text-[10px] font-mono"
                                                            >
                                                                {m.length > 30 ? m.slice(0, 27) + '…' : m}
                                                            </Badge>
                                                        ))}
                                                    </div>
                                                )}
                                                {ev.details?.retryAfterSeconds && (
                                                    <span className="text-muted-foreground">
                                                        Retry after {ev.details.retryAfterSeconds}s
                                                    </span>
                                                )}
                                                {ev.details?.reason && (
                                                    <span className="text-muted-foreground">
                                                        {ev.details.reason}
                                                    </span>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                {ev.leadId ? (
                                                    <Link
                                                        href={`/dashboard/leads/${ev.leadId}`}
                                                        className="text-xs font-mono hover:underline"
                                                    >
                                                        {ev.leadId.slice(0, 8)}
                                                    </Link>
                                                ) : (
                                                    '—'
                                                )}
                                            </TableCell>
                                            <TableCell className="text-xs text-muted-foreground">
                                                {ev.createdAt
                                                    ? format(new Date(ev.createdAt), 'dd MMM HH:mm:ss', { locale: es })
                                                    : '—'}
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
}: {
    label: string;
    value: number;
    tone: 'indigo' | 'amber' | 'violet' | 'rose';
}) {
    const toneClass = {
        indigo: 'text-indigo-600 dark:text-indigo-400',
        amber: 'text-amber-600 dark:text-amber-400',
        violet: 'text-violet-600 dark:text-violet-400',
        rose: 'text-rose-600 dark:text-rose-400',
    }[tone];

    return (
        <Card>
            <CardContent className="pt-6">
                <span className="text-sm text-muted-foreground">{label}</span>
                <div className={`mt-2 text-3xl font-semibold ${toneClass}`}>{value}</div>
            </CardContent>
        </Card>
    );
}
