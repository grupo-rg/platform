import { getAllBudgetsAction } from '@/actions/budget/get-all-budgets.action';
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
import { Button } from '@/components/ui/button';
import {
    FileText,
    Sparkles,
    User,
    Calendar,
    Folder,
    ArrowRight,
    Search,
    Filter,
    ShieldCheck,
    Briefcase
} from 'lucide-react';
import Link from 'next/link';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Input } from '@/components/ui/input';
import { BudgetApproveButton } from '@/components/budget/budget-approve-button';
import { BudgetsTable } from '@/components/budget/admin/BudgetsTable';

export default async function BudgetsListPage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;
    const budgets = await getAllBudgetsAction();

    // Helper to get source icon and label
    const getSourceInfo = (source?: string) => {
        switch (source) {
            case 'wizard':
                return { icon: Sparkles, label: 'Asistente IA', color: 'text-purple-600 bg-purple-100 dark:bg-purple-500/10 dark:text-purple-300 border-purple-200 dark:border-purple-800' };
            case 'pdf_measurement':
                return { icon: FileText, label: 'Mediciones PDF', color: 'text-amber-600 bg-amber-100 dark:bg-amber-500/10 dark:text-amber-300 border-amber-200 dark:border-amber-800' };
            default:
                return { icon: User, label: 'Manual', color: 'text-zinc-600 bg-zinc-100 dark:bg-zinc-500/10 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800' };
        }
    };

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Hero Section */}
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-zinc-900 to-black p-8 text-white shadow-2xl border border-white/5">
                <div className="absolute top-0 right-0 -mt-20 -mr-20 h-80 w-80 rounded-full bg-blue-500/10 blur-3xl"></div>
                <div className="absolute bottom-0 left-0 -mb-20 -ml-20 h-80 w-80 rounded-full bg-emerald-500/10 blur-3xl"></div>

                <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
                    <div className="space-y-4">
                        <Badge className="bg-white/10 text-blue-200 hover:bg-white/20 border-blue-500/30 backdrop-blur-md">
                            <Briefcase className="w-3 h-3 mr-1 text-blue-300" /> Gestión de Proyectos
                        </Badge>
                        <div>
                            <h1 className="text-3xl md:text-4xl font-bold font-headline tracking-tight text-white">
                                Presupuestos y Obras
                            </h1>
                            <p className="text-zinc-400 max-w-xl mt-2 text-lg">
                                Centralice el control de sus propuestas. Supervise estados, orígenes y aprobaciones en tiempo real.
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <Button variant="outline" className="border-white/10 text-white hover:bg-white/10 hover:text-white bg-transparent backdrop-blur-sm hidden md:flex">
                            <Filter className="mr-2 h-4 w-4" />
                            Filtrar Vista
                        </Button>
                        <Link href="/dashboard/wizard">
                            <Button className="bg-white text-zinc-950 hover:bg-blue-50 font-semibold shadow-lg shadow-blue-900/20 transition-all duration-300 group">
                                <Sparkles className="mr-2 h-4 w-4 text-purple-600 group-hover:scale-110 transition-transform" />
                                Nuevo con IA
                            </Button>
                        </Link>
                    </div>
                </div>
            </div>

            {/* Metrics Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="border-none shadow-lg bg-white/60 dark:bg-zinc-900/50 backdrop-blur-md group hover:-translate-y-1 transition-transform duration-300">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
                            Total Presupuestado
                            <ShieldCheck className="w-4 h-4 text-emerald-500" />
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-slate-800 dark:text-slate-100">
                            {budgets.reduce((acc, b) => acc + (b.totalEstimated || 0), 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">Volumen acumulado</p>
                    </CardContent>
                </Card>
                <Card className="border-none shadow-lg bg-white/60 dark:bg-zinc-900/50 backdrop-blur-md group hover:-translate-y-1 transition-transform duration-300">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
                            Solicitudes Pendientes
                            <div className="h-2 w-2 rounded-full bg-orange-500 animate-pulse" />
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-orange-600 dark:text-orange-400">
                            {budgets.filter(b => b.status === 'pending_review' || b.status === 'draft').length}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">Requieren acción</p>
                    </CardContent>
                </Card>
                <Card className="border-none shadow-lg bg-white/60 dark:bg-zinc-900/50 backdrop-blur-md group hover:-translate-y-1 transition-transform duration-300">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
                            Tasa de Cierre
                            <Sparkles className="w-4 h-4 text-purple-500" />
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-purple-600 dark:text-purple-400">
                            {(() => {
                                const now = new Date();
                                const currentMonth = now.getMonth();
                                const currentYear = now.getFullYear();

                                const thisMonthBudgets = budgets.filter(b => {
                                    const d = new Date(b.createdAt);
                                    return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
                                });

                                // Consider conversion as Approved vs Total (excluding drafts that are just started)
                                // Or simple Approved / Total Created this month
                                const total = thisMonthBudgets.filter(b => b.status !== 'draft').length;
                                const approved = thisMonthBudgets.filter(b => b.status === 'approved').length;

                                if (total === 0) return '0%';
                                return `${Math.round((approved / total) * 100)}%`;
                            })()}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">Conversión mensual</p>
                    </CardContent>
                </Card>
            </div>

            {/* Main Table Card */}
            <Card className="border-0 shadow-xl shadow-zinc-200/40 dark:shadow-zinc-950/40 overflow-hidden bg-white/80 dark:bg-zinc-900/60 backdrop-blur-xl ring-1 ring-zinc-200 dark:ring-zinc-800">
                <div className="p-4">
                    <BudgetsTable budgets={budgets} locale={locale} />
                </div>
            </Card>
        </div>
    );
}
