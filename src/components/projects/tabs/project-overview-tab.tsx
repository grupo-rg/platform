'use client';

import { useMemo } from 'react';
import { Project } from '@/backend/project/domain/project';
import { Expense } from '@/backend/expense/domain/expense';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Clock, TrendingUp, AlertTriangle, CheckCircle2, Calendar } from 'lucide-react';
import {
    aggregatePhaseRealCosts,
    effectivePhaseRealCost,
    phaseCostStatus,
} from '@/lib/project/aggregate-phase-costs';

interface ProjectOverviewTabProps {
    project: Project;
    expenses?: Expense[];
    locale: string;
}

export function ProjectOverviewTab({ project, expenses = [], locale }: ProjectOverviewTabProps) {
    const fmt = (v: number) =>
        new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);

    const aggregation = useMemo(
        () => aggregatePhaseRealCosts(project, expenses),
        [project, expenses],
    );

    const activePhases = project.phases.filter(p => p.status === 'en_progreso').length;
    const completedPhases = project.phases.filter(p => p.status === 'completada').length;
    const totalPhases = project.phases.length;
    const phaseProgress = totalPhases > 0 ? (completedPhases / totalPhases) * 100 : 0;

    // El KPI usa el agregado real (override manual respetado) en vez de
    // confiar solo en `project.realCost` (que arranca en 0 hasta que alguien
    // edite fase a mano).
    const totalRealCost = aggregation.total > 0 ? aggregation.total : project.realCost;
    const budgetUsage = project.estimatedBudget > 0 ? (totalRealCost / project.estimatedBudget) * 100 : 0;

    // Cuenta de fases en sobrecoste (>110 %) para mostrar como alerta.
    const phasesOver = project.phases.filter(p => {
        const real = effectivePhaseRealCost(p, aggregation);
        return phaseCostStatus(real, p.estimatedCost || 0) === 'over';
    }).length;

    // Calculate days remaining
    const daysRemaining = project.estimatedEndDate
        ? Math.ceil((new Date(project.estimatedEndDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
        : 0;

    return (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Presupuesto Ejecutado</CardTitle>
                    <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{fmt(totalRealCost)}</div>
                    <Progress value={budgetUsage} className="h-2 mt-2" indicatorClassName={budgetUsage > 100 ? 'bg-red-500' : 'bg-emerald-500'} />
                    <p className="text-xs text-muted-foreground mt-2">
                        {Math.round(budgetUsage)}% de {fmt(project.estimatedBudget)}
                        {aggregation.unassigned > 0 && (
                            <span className="block text-amber-600 dark:text-amber-400 mt-0.5">
                                {fmt(aggregation.unassigned)} sin asignar a fase
                            </span>
                        )}
                    </p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Tiempo Restante</CardTitle>
                    <Clock className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{daysRemaining > 0 ? `${daysRemaining} días` : 'Vencido'}</div>
                    <p className="text-xs text-muted-foreground mt-2">
                        Fecha fin: {project.estimatedEndDate ? new Date(project.estimatedEndDate).toLocaleDateString(locale) : 'No definida'}
                    </p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Fases Activas</CardTitle>
                    <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{activePhases}</div>
                    <p className="text-xs text-muted-foreground mt-2">
                        {completedPhases} de {totalPhases} completadas
                    </p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Estado General</CardTitle>
                    <Badge variant={project.status === 'ejecucion' ? 'default' : 'outline'}>
                        {project.status.toUpperCase()}
                    </Badge>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center gap-2 mt-2">
                        {phasesOver > 0 || budgetUsage > 100 ? (
                            <>
                                <AlertTriangle className="w-4 h-4 text-red-500" />
                                <span className="text-sm font-medium text-red-600">Con desviaciones</span>
                            </>
                        ) : (
                            <>
                                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                                <span className="text-sm font-medium text-emerald-600">Saludable</span>
                            </>
                        )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                        {phasesOver > 0
                            ? `${phasesOver} fase${phasesOver === 1 ? '' : 's'} con sobrecoste >10 %`
                            : budgetUsage > 100
                                ? `Sobrecoste total del ${Math.round(budgetUsage - 100)} %`
                                : 'Sin incidencias reportadas'}
                    </p>
                </CardContent>
            </Card>

            {/* Preview compacto de fases — sin scroll interno (que en pantallas
                pequeñas se mezclaba con el scroll de página). Muestra solo las 4
                primeras y enlaza a la tab "Fases" para el detalle completo. */}
            <Card className="md:col-span-2 lg:col-span-4">
                <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-lg">Fases del Proyecto</CardTitle>
                    <span className="text-xs text-muted-foreground">
                        {project.phases.length} fase{project.phases.length === 1 ? '' : 's'}
                    </span>
                </CardHeader>
                <CardContent>
                    <div className="space-y-2.5">
                        {project.phases.slice(0, 4).map((phase, i) => {
                            const real = effectivePhaseRealCost(phase, aggregation);
                            const estimated = phase.estimatedCost || 0;
                            const status = phaseCostStatus(real, estimated);
                            return (
                                <div key={phase.id} className="flex items-center justify-between p-3 bg-zinc-50 dark:bg-zinc-900/50 rounded-lg border border-zinc-100 dark:border-zinc-800">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-zinc-200 dark:bg-zinc-800 text-xs font-medium shrink-0">
                                            {i + 1}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="font-medium truncate">{phase.name}</div>
                                            {real > 0 && (
                                                <div className={`text-[11px] ${status === 'over' ? 'text-red-600' : status === 'tight' ? 'text-amber-600' : 'text-muted-foreground'}`}>
                                                    {fmt(real)} / {fmt(estimated)}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                        {status === 'over' && (
                                            <Badge className="bg-red-500 hover:bg-red-600 text-white text-[10px] h-5">
                                                Sobrecoste
                                            </Badge>
                                        )}
                                        <Progress value={phase.progress} className="w-24 h-2" />
                                        <Badge variant="outline" className="w-[100px] justify-center capitalize">{phase.status.replace('_', ' ')}</Badge>
                                    </div>
                                </div>
                            );
                        })}
                        {project.phases.length === 0 && (
                            <p className="text-xs text-center text-muted-foreground py-6">
                                Sin fases todavía. Añade la primera desde la pestaña <strong>Fases y Cronograma</strong>.
                            </p>
                        )}
                        {project.phases.length > 4 && (
                            <p className="text-xs text-center text-muted-foreground pt-2">
                                + {project.phases.length - 4} fases más — abre la pestaña <strong>Fases y Cronograma</strong>.
                            </p>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
