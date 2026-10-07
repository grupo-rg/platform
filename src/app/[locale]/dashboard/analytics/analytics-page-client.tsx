'use client';

import { useState } from 'react';
import {
    GlobalAnalytics, ProjectAnalytics,
    ProviderRankingAnalytics, BudgetAccuracyAnalytics, EVMAnalytics,
} from '@/backend/analytics/analytics-service';
import { Project } from '@/backend/project/domain/project';
import { MetricCard, BarChart, DonutChart, DeviationBadge } from '@/components/analytics/chart-components';
import { ProjectAnalyticsPanel } from '@/components/analytics/project-analytics-panel';
import { EVMPanel } from '@/components/analytics/evm-panel';
import { ProviderRankingPanel } from '@/components/analytics/provider-ranking-panel';
import { BudgetAccuracyPanel } from '@/components/analytics/budget-accuracy-panel';
import { SparklineChart } from '@/components/analytics/sparkline-chart';
import { getProjectAnalyticsAction } from '@/actions/analytics/get-project-analytics.action';
import { getEVMAnalyticsAction } from '@/actions/analytics/get-advanced-analytics.action';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
    BarChart3, TrendingUp, Receipt, Wallet, Building2,
    ArrowRight, Landmark, ChevronLeft, Loader2,
    Activity, Users, Target, CalendarDays,
} from 'lucide-react';

type TabId = 'dashboard' | 'evm' | 'providers' | 'accuracy';

const TABS: { id: TabId; label: string; icon: React.ReactNode; description: string }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: <BarChart3 className="w-4 h-4" />, description: 'Vista general financiera' },
    { id: 'evm', label: 'Curva S / EVM', icon: <Activity className="w-4 h-4" />, description: 'Earned Value Management' },
    { id: 'providers', label: 'Proveedores', icon: <Users className="w-4 h-4" />, description: 'Ranking y concentración' },
    { id: 'accuracy', label: 'Precisión', icon: <Target className="w-4 h-4" />, description: 'Precisión presupuestaria' },
];

const STATUS_LABELS: Record<string, string> = {
    preparacion: 'Preparación',
    ejecucion: 'En Ejecución',
    pausada: 'Pausada',
    finalizada: 'Finalizada',
    cerrada: 'Cerrada',
};

const STATUS_COLORS: Record<string, string> = {
    preparacion: '#6366f1',
    ejecucion: '#10b981',
    pausada: '#f59e0b',
    finalizada: '#3b82f6',
    cerrada: '#6b7280',
};

interface AnalyticsPageClientProps {
    globalAnalytics: GlobalAnalytics;
    projects: Project[];
    providerRanking: ProviderRankingAnalytics;
    budgetAccuracy: BudgetAccuracyAnalytics;
    locale: string;
}

export function AnalyticsPageClient({ globalAnalytics, projects, providerRanking, budgetAccuracy, locale }: AnalyticsPageClientProps) {
    const [activeTab, setActiveTab] = useState<TabId>('dashboard');
    const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
    const [projectAnalytics, setProjectAnalytics] = useState<ProjectAnalytics | null>(null);
    const [evmAnalytics, setEvmAnalytics] = useState<EVMAnalytics | null>(null);
    const [loadingProject, setLoadingProject] = useState(false);

    const fmt = (v: number) =>
        new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);

    const handleSelectProject = async (projectId: string) => {
        setLoadingProject(true);
        setSelectedProjectId(projectId);
        try {
            if (activeTab === 'evm') {
                const analytics = await getEVMAnalyticsAction(projectId);
                setEvmAnalytics(analytics);
            } else {
                const analytics = await getProjectAnalyticsAction(projectId);
                setProjectAnalytics(analytics);
            }
        } catch (err) {
            // p.ej. "No autorizado" (sesión caducada): no rompemos la vista.
            console.error('[Analytics] project analytics failed:', err);
        } finally {
            setLoadingProject(false);
        }
    };

    const handleBackToGlobal = () => {
        setSelectedProjectId(null);
        setProjectAnalytics(null);
        setEvmAnalytics(null);
    };

    const ga = globalAnalytics;

    // --- Project Detail View ---
    if (selectedProjectId && activeTab !== 'evm') {
        return (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
                <button
                    onClick={handleBackToGlobal}
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                    <ChevronLeft className="w-4 h-4" /> Volver a Dashboard Global
                </button>

                {loadingProject ? (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                    </div>
                ) : projectAnalytics ? (
                    <ProjectAnalyticsPanel analytics={projectAnalytics} locale={locale} />
                ) : (
                    <p className="text-muted-foreground text-center py-10">No se encontraron datos analíticos</p>
                )}
            </div>
        );
    }

    // --- EVM Project Detail ---
    if (selectedProjectId && activeTab === 'evm') {
        return (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
                <button
                    onClick={handleBackToGlobal}
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                    <ChevronLeft className="w-4 h-4" /> Volver a selección de obra
                </button>

                {loadingProject ? (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                    </div>
                ) : evmAnalytics ? (
                    <EVMPanel evm={evmAnalytics} locale={locale} />
                ) : (
                    <p className="text-muted-foreground text-center py-10">No se encontraron datos EVM</p>
                )}
            </div>
        );
    }

    // --- Main View with Tabs ---
    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">

            {/* Hero */}
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-blue-950 to-cyan-950 p-8 text-white shadow-2xl">
                <div className="absolute top-0 right-0 -mt-16 -mr-16 h-72 w-72 rounded-full bg-blue-500/15 blur-3xl" />
                <div className="absolute bottom-0 left-0 -mb-12 -ml-12 h-56 w-56 rounded-full bg-cyan-500/15 blur-3xl" />
                <div className="relative z-10 space-y-2">
                    <Badge className="bg-white/10 text-blue-200 hover:bg-white/20 border-blue-500/30 backdrop-blur-md mb-2">
                        <BarChart3 className="w-3 h-3 mr-1 text-blue-300" /> Analíticas Financieras
                    </Badge>
                    <h1 className="text-3xl md:text-4xl font-bold font-headline tracking-tight">
                        Dashboard <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-200 to-cyan-200">Financiero</span>
                    </h1>
                    <p className="text-blue-100/70 max-w-xl text-lg">
                        Visibilidad en tiempo real del rendimiento financiero de tus obras.
                    </p>
                </div>
            </div>

            {/* Tab Navigation */}
            <div className="flex gap-1 p-1 bg-zinc-100 dark:bg-zinc-800/50 rounded-xl">
                {TABS.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => { setActiveTab(tab.id); handleBackToGlobal(); }}
                        className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-medium transition-all duration-200 ${activeTab === tab.id
                            ? 'bg-white dark:bg-zinc-900 text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground hover:bg-white/50 dark:hover:bg-zinc-800'
                            }`}
                    >
                        {tab.icon}
                        <span className="hidden sm:inline">{tab.label}</span>
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            {activeTab === 'dashboard' && (
                <div className="space-y-8 animate-in fade-in duration-300">
                    {/* Global Metrics */}
                    <div className="grid gap-4 md:grid-cols-4">
                        <MetricCard
                            label="Total Facturado"
                            value={fmt(ga.totalBilled)}
                            subtext={`${ga.totalProjects} obra${ga.totalProjects !== 1 ? 's' : ''}`}
                            icon={<TrendingUp className="w-4 h-4 text-blue-500" />}
                        />
                        <MetricCard
                            label="Total Gastos"
                            value={fmt(ga.totalExpenses)}
                            icon={<Receipt className="w-4 h-4 text-amber-500" />}
                        />
                        <MetricCard
                            label="Beneficio Neto"
                            value={fmt(ga.netProfit)}
                            icon={<Wallet className="w-4 h-4 text-emerald-500" />}
                            colorClass={ga.netProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}
                            trend={ga.netProfit >= 0 ? 'up' : 'down'}
                            trendValue={`Margen: ${ga.profitMargin.toFixed(1)}%`}
                        />
                        <MetricCard
                            label="Balance IVA"
                            value={fmt(ga.vatBalance)}
                            subtext={`Repercutido: ${fmt(ga.vatCollected)} | Soportado: ${fmt(ga.vatPaid)}`}
                            icon={<Landmark className="w-4 h-4 text-purple-500" />}
                            colorClass={ga.vatBalance >= 0 ? 'text-purple-600' : 'text-red-600'}
                        />
                    </div>

                    {/* Charts Row */}
                    <div className="grid gap-6 md:grid-cols-2">
                        <Card className="border-zinc-200 dark:border-zinc-800">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-sm font-semibold">Gastos Mensuales</CardTitle>
                            </CardHeader>
                            <CardContent>
                                {ga.monthlyExpenses.length > 0 ? (
                                    <BarChart
                                        data={ga.monthlyExpenses.map(m => ({
                                            label: m.label,
                                            value: m.total,
                                            color: 'linear-gradient(to top, #3b82f6, #06b6d4)',
                                        }))}
                                        height={200}
                                        formatValue={fmt}
                                    />
                                ) : (
                                    <p className="text-sm text-muted-foreground text-center py-10">Sin datos de gastos</p>
                                )}
                            </CardContent>
                        </Card>

                        <Card className="border-zinc-200 dark:border-zinc-800">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-sm font-semibold">Obras por Estado</CardTitle>
                            </CardHeader>
                            <CardContent className="flex justify-center">
                                <DonutChart
                                    segments={Object.entries(ga.projectsByStatus).map(([status, count]) => ({
                                        label: `${STATUS_LABELS[status] || status} (${count})`,
                                        value: count,
                                        color: STATUS_COLORS[status] || '#6b7280',
                                    }))}
                                    centerValue={String(ga.totalProjects)}
                                    centerLabel="obras"
                                    size={160}
                                />
                            </CardContent>
                        </Card>
                    </div>

                    {/* Projects Table */}
                    <Card className="border-zinc-200 dark:border-zinc-800">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-sm font-semibold flex items-center gap-2">
                                <Building2 className="w-4 h-4 text-indigo-500" /> Rendimiento por Obra
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {ga.projectSummaries.length > 0 ? (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b border-zinc-200 dark:border-zinc-800">
                                                <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground">Obra</th>
                                                <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground">Estado</th>
                                                <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">Estimado</th>
                                                <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">Real</th>
                                                <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">Desviación</th>
                                                <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground"></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {ga.projectSummaries.map(p => (
                                                <tr
                                                    key={p.id}
                                                    className="border-b border-zinc-100 dark:border-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors cursor-pointer"
                                                    onClick={() => handleSelectProject(p.id)}
                                                >
                                                    <td className="py-3 px-3 font-medium">{p.name}</td>
                                                    <td className="py-3 px-3">
                                                        <Badge variant="outline" className="text-[10px]">
                                                            {STATUS_LABELS[p.status] || p.status}
                                                        </Badge>
                                                    </td>
                                                    <td className="py-3 px-3 text-right">{fmt(p.estimated)}</td>
                                                    <td className="py-3 px-3 text-right font-medium">{fmt(p.real)}</td>
                                                    <td className="py-3 px-3 text-right">
                                                        <DeviationBadge percent={p.deviationPercent} />
                                                    </td>
                                                    <td className="py-3 px-3 text-right">
                                                        <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <p className="text-sm text-muted-foreground text-center py-10">No hay obras registradas</p>
                            )}
                        </CardContent>
                    </Card>
                </div>
            )}

            {activeTab === 'evm' && (
                <div className="space-y-6 animate-in fade-in duration-300">
                    <div className="text-center space-y-2 py-4">
                        <h2 className="text-xl font-bold">Selecciona una obra para analizar</h2>
                        <p className="text-muted-foreground text-sm">La Curva S y el Earned Value se calculan por proyecto individual.</p>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {projects.map((project, idx) => {
                            // Weighted progress: average of phase progress weighted by estimated cost
                            const totalPhaseCost = project.phases.reduce((s, p) => s + p.estimatedCost, 0) || 1;
                            const weightedProgress = project.phases.reduce(
                                (s, p) => s + (p.progress / 100) * (p.estimatedCost / totalPhaseCost),
                                0
                            ) * 100;

                            // Budget execution %
                            const executionPercent = project.estimatedBudget > 0
                                ? Math.min((project.realCost / project.estimatedBudget) * 100, 100)
                                : 0;

                            // Phase stats
                            const completedPhases = project.phases.filter(p => p.status === 'completada').length;
                            const inProgressPhases = project.phases.filter(p => p.status === 'en_progreso').length;
                            const totalPhases = project.phases.length;

                            // Sparkline: use phase estimatedCost distribution as "cost profile"
                            const sparkValues = project.phases.length > 1
                                ? project.phases.map(p => p.estimatedCost)
                                : [0, project.estimatedBudget * 0.3, project.estimatedBudget * 0.6, project.estimatedBudget * 0.8, project.estimatedBudget];

                            // Date formatting
                            const dateFormatter = new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric' });
                            const startStr = project.startDate ? dateFormatter.format(new Date(project.startDate)) : '—';
                            const endStr = project.estimatedEndDate ? dateFormatter.format(new Date(project.estimatedEndDate)) : '—';

                            // Status accent colours
                            const accentMap: Record<string, string> = {
                                preparacion: 'from-indigo-500 to-violet-600',
                                ejecucion: 'from-emerald-400 to-teal-600',
                                pausada: 'from-amber-400 to-orange-500',
                                finalizada: 'from-blue-400 to-cyan-500',
                                cerrada: 'from-zinc-400 to-zinc-600',
                            };
                            const accentGradient = accentMap[project.status] || 'from-zinc-400 to-zinc-600';

                            const sparkColorMap: Record<string, string> = {
                                preparacion: '#818cf8',
                                ejecucion: '#34d399',
                                pausada: '#fbbf24',
                                finalizada: '#60a5fa',
                                cerrada: '#a1a1aa',
                            };
                            const sparkColor = sparkColorMap[project.status] || '#818cf8';

                            return (
                                <div
                                    key={project.id}
                                    onClick={() => handleSelectProject(project.id)}
                                    className="group relative rounded-2xl overflow-hidden cursor-pointer
                                               bg-white/60 dark:bg-zinc-900/70 backdrop-blur-md
                                               border border-zinc-200/60 dark:border-zinc-800/60
                                               shadow-sm hover:shadow-xl hover:shadow-black/5 dark:hover:shadow-black/30
                                               transition-all duration-500 ease-out
                                               hover:-translate-y-0.5"
                                    style={{ animationDelay: `${idx * 80}ms` }}
                                >
                                    {/* Left accent strip */}
                                    <div className={`absolute left-0 top-0 bottom-0 w-[3px] bg-gradient-to-b ${accentGradient} opacity-70 group-hover:opacity-100 transition-opacity duration-300`} />

                                    <div className="p-5 pl-5 space-y-4">
                                        {/* Header */}
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="space-y-0.5 min-w-0 flex-1">
                                                <h3 className="text-sm font-semibold text-foreground truncate group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-blue-500 group-hover:to-cyan-500 transition-all duration-300">
                                                    {project.name}
                                                </h3>
                                                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
                                                    <CalendarDays className="w-3 h-3" />
                                                    <span>{startStr} → {endStr}</span>
                                                </div>
                                            </div>
                                            <Badge
                                                variant="outline"
                                                className="text-[10px] shrink-0 border-zinc-300 dark:border-zinc-700"
                                                style={{ color: STATUS_COLORS[project.status] || '#6b7280' }}
                                            >
                                                {STATUS_LABELS[project.status] || project.status}
                                            </Badge>
                                        </div>

                                        {/* Budget row */}
                                        <div className="space-y-2">
                                            <div className="flex items-baseline justify-between">
                                                <span className="text-xs text-muted-foreground">Presupuesto</span>
                                                <span className="text-sm font-bold tabular-nums">{fmt(project.estimatedBudget)}</span>
                                            </div>

                                            {/* Execution bar */}
                                            <div className="space-y-1">
                                                <div className="flex items-center justify-between text-[10px]">
                                                    <span className="text-muted-foreground/70">Ejecutado</span>
                                                    <span className="font-medium tabular-nums"
                                                        style={{ color: executionPercent > 90 ? '#ef4444' : executionPercent > 70 ? '#f59e0b' : '#10b981' }}>
                                                        {executionPercent.toFixed(0)}%
                                                    </span>
                                                </div>
                                                <div className="h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                                                    <div
                                                        className="h-full rounded-full transition-all duration-700 ease-out"
                                                        style={{
                                                            width: `${executionPercent}%`,
                                                            background: executionPercent > 90
                                                                ? 'linear-gradient(to right, #ef4444, #dc2626)'
                                                                : executionPercent > 70
                                                                    ? 'linear-gradient(to right, #f59e0b, #d97706)'
                                                                    : 'linear-gradient(to right, #10b981, #059669)',
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Sparkline */}
                                        <div className="relative -mx-1">
                                            <SparklineChart
                                                values={sparkValues}
                                                width={240}
                                                height={36}
                                                strokeColor={sparkColor}
                                                gradientFrom={`${sparkColor}30`}
                                                gradientTo={`${sparkColor}00`}
                                                id={`evm-${project.id}`}
                                            />
                                        </div>

                                        {/* Footer: phases + arrow */}
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                {/* Phase dots */}
                                                <div className="flex items-center gap-0.5">
                                                    {project.phases.map((phase, i) => (
                                                        <div
                                                            key={i}
                                                            className="w-2 h-2 rounded-full transition-all duration-300"
                                                            title={`${phase.name}: ${phase.progress}%`}
                                                            style={{
                                                                background: phase.status === 'completada'
                                                                    ? '#10b981'
                                                                    : phase.status === 'en_progreso'
                                                                        ? '#f59e0b'
                                                                        : '#3f3f46',
                                                                boxShadow: phase.status === 'en_progreso'
                                                                    ? '0 0 6px rgba(245,158,11,0.5)'
                                                                    : 'none',
                                                            }}
                                                        />
                                                    ))}
                                                </div>
                                                {totalPhases > 0 && (
                                                    <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                                                        {completedPhases}/{totalPhases}
                                                    </span>
                                                )}
                                            </div>

                                            <div className="flex items-center gap-1 text-[10px] text-muted-foreground/50 group-hover:text-blue-500 transition-colors duration-300">
                                                <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-300">Analizar</span>
                                                <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-all duration-300 group-hover:translate-x-0.5" />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    {projects.length === 0 && (
                        <p className="text-muted-foreground text-center py-10">No hay obras disponibles</p>
                    )}
                </div>
            )}

            {activeTab === 'providers' && (
                <ProviderRankingPanel ranking={providerRanking} locale={locale} />
            )}

            {activeTab === 'accuracy' && (
                <BudgetAccuracyPanel accuracy={budgetAccuracy} locale={locale} />
            )}
        </div>
    );
}
