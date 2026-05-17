'use client';

import { Project } from '@/backend/project/domain/project';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Clock, TrendingUp, AlertTriangle, CheckCircle2, Calendar } from 'lucide-react';

interface ProjectOverviewTabProps {
    project: Project;
    locale: string;
}

export function ProjectOverviewTab({ project, locale }: ProjectOverviewTabProps) {
    const fmt = (v: number) =>
        new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);

    const activePhases = project.phases.filter(p => p.status === 'en_progreso').length;
    const completedPhases = project.phases.filter(p => p.status === 'completada').length;
    const totalPhases = project.phases.length;
    const phaseProgress = totalPhases > 0 ? (completedPhases / totalPhases) * 100 : 0;

    const budgetUsage = project.estimatedBudget > 0 ? (project.realCost / project.estimatedBudget) * 100 : 0;

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
                    <div className="text-2xl font-bold">{fmt(project.realCost)}</div>
                    <Progress value={budgetUsage} className="h-2 mt-2" indicatorClassName={budgetUsage > 100 ? 'bg-red-500' : 'bg-emerald-500'} />
                    <p className="text-xs text-muted-foreground mt-2">
                        {Math.round(budgetUsage)}% de {fmt(project.estimatedBudget)}
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
                        {/* Placeholder for health check */}
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                        <span className="text-sm font-medium text-emerald-600">Saludable</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Sin incidencias reportadas</p>
                </CardContent>
            </Card>

            {/* Recent Activity or Notes could go here in a wider card */}
            <Card className="md:col-span-2 lg:col-span-4">
                <CardHeader>
                    <CardTitle className="text-lg">Fases del Proyecto</CardTitle>
                </CardHeader>
                <CardContent>
                    {/* Lista scrollable: muestra todas las fases sin cortar; el scroll
                        interno mantiene el resto del overview accesible. */}
                    <div className="space-y-4 max-h-[24rem] overflow-y-auto pr-2 -mr-2 pb-6">
                        {project.phases.map((phase, i) => (
                            <div key={phase.id} className="flex items-center justify-between p-3 bg-zinc-50 dark:bg-zinc-900/50 rounded-lg border border-zinc-100 dark:border-zinc-800">
                                <div className="flex items-center gap-3">
                                    <div className="flex items-center justify-center w-6 h-6 rounded-full bg-zinc-200 dark:bg-zinc-800 text-xs font-medium">
                                        {i + 1}
                                    </div>
                                    <span className="font-medium">{phase.name}</span>
                                </div>
                                <div className="flex items-center gap-4">
                                    <Progress value={phase.progress} className="w-24 h-2" />
                                    <Badge variant="outline" className="w-[100px] justify-center capitalize">{phase.status.replace('_', ' ')}</Badge>
                                </div>
                            </div>
                        ))}
                        {project.phases.length === 0 && (
                            <p className="text-xs text-center text-muted-foreground py-4">
                                Sin fases todavía.
                            </p>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
