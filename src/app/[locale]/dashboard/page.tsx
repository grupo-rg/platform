import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDictionary } from '@/lib/dictionaries';
import Link from 'next/link';
import { ArrowRight, FileText, Lightbulb, TrendingUp, Users, Clock, Sparkles, Activity, Search, ShieldCheck, Building2, Receipt, BarChart3 } from 'lucide-react';
import { getAllBudgetsAction } from '@/actions/budget/get-all-budgets.action';
import { DashboardRequestCard } from '@/components/dashboard/dashboard-request-card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

// Mock user for server component (replace with real auth in future)
const mockUser = {
  displayName: 'Usuario',
  email: 'user@example.com'
}

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const dict = await getDictionary(locale as any);
  const t = dict.dashboard;
  const user = mockUser;

  // Fetch metrics data
  const budgets = await getAllBudgetsAction();

  const totalRequests = budgets.length;
  const totalBudgeted = budgets.reduce((acc, b) => acc + (b.totalEstimated || b.costBreakdown?.total || 0), 0);
  const pendingReview = budgets.filter(b => b.status === 'pending_review').length;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(amount);
  };

  const QUICK_ACTIONS = [
    {
      href: '/dashboard/admin/budgets',
      title: t.nav.myBudgets,
      description: 'Acceda al historial completo de presupuestos y estados.',
      icon: FileText,
      color: 'purple',
    },
    {
      href: '/dashboard/projects',
      title: 'Mis Obras',
      description: 'Gestione sus proyectos de construcción en curso.',
      icon: Building2,
      color: 'indigo',
    },
    {
      href: '/dashboard/expenses',
      title: 'Facturas',
      description: 'Registre y valide facturas de proveedores.',
      icon: Receipt,
      color: 'emerald',
    },
    {
      href: '/dashboard/analytics',
      title: 'Analíticas',
      description: 'Visibilidad financiera en tiempo real.',
      icon: BarChart3,
      color: 'blue',
    },
    {
      href: '/dashboard/seo-generator',
      title: t.seoGenerator.title,
      description: t.seoGenerator.description,
      icon: Lightbulb,
      color: 'amber',
    },
  ];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">

      {/* Hero Section */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-900 via-purple-900 to-slate-900 p-8 text-white shadow-2xl">
        <div className="absolute top-0 right-0 -mt-10 -mr-10 h-64 w-64 rounded-full bg-purple-500/20 blur-3xl"></div>
        <div className="absolute bottom-0 left-0 -mb-10 -ml-10 h-64 w-64 rounded-full bg-indigo-500/20 blur-3xl"></div>

        <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="space-y-2">
            <Badge className="bg-white/10 text-purple-200 hover:bg-white/20 border-purple-500/30 backdrop-blur-md mb-2">
              <Sparkles className="w-3 h-3 mr-1 text-purple-300" /> AI-Powered Workspace
            </Badge>
            <h1 className="text-4xl font-bold font-headline tracking-tight">
              {t.welcome.title}, <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-200 to-indigo-200">{user?.displayName || 'Usuario'}</span>
            </h1>
            <p className="text-purple-100/80 max-w-xl text-lg">
              {t.welcome.description} Gestione sus proyectos con inteligencia artificial y precisión.
            </p>
          </div>
          <div className="flex gap-3">
            <Button className="bg-white/10 hover:bg-white/20 text-white border border-white/20 backdrop-blur-md transition-all duration-300 group">
              <Search className="w-4 h-4 mr-2 group-hover:scale-110 transition-transform" /> Buscar
            </Button>
            <Button className="bg-white text-indigo-900 hover:bg-purple-50 border-none shadow-lg shadow-purple-900/20 font-semibold transition-all duration-300">
              <Activity className="w-4 h-4 mr-2" /> Reportes
            </Button>
          </div>
        </div>
      </div>

      {/* Metrics Section - Bento Grid Style */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-none shadow-lg bg-white/50 dark:bg-zinc-900/50 backdrop-blur-sm hover:shadow-xl transition-all duration-300 group relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 relative z-10">
            <CardTitle className="text-sm font-medium text-muted-foreground group-hover:text-emerald-600 transition-colors">
              {t.metrics.totalBudgeted}
            </CardTitle>
            <div className="p-2 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-500 group-hover:text-emerald-600 group-hover:scale-110 transition-all">
              <TrendingUp className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent className="relative z-10">
            <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">{formatCurrency(totalBudgeted)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              <span className="text-emerald-600 font-medium">↑ 20.1%</span> {t.metrics.fromLastMonth || "vs mes pasado"}
            </p>
          </CardContent>
        </Card>

        <Card className="border-none shadow-lg bg-white/50 dark:bg-zinc-900/50 backdrop-blur-sm hover:shadow-xl transition-all duration-300 group relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 relative z-10">
            <CardTitle className="text-sm font-medium text-muted-foreground group-hover:text-blue-600 transition-colors">
              {t.metrics.totalRequests}
            </CardTitle>
            <div className="p-2 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-500 group-hover:text-blue-600 group-hover:scale-110 transition-all">
              <Users className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent className="relative z-10">
            <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">{totalRequests}</div>
            <p className="text-xs text-muted-foreground mt-1">
              <span className="text-blue-600 font-medium">↑ 12%</span> nuevos clientes
            </p>
          </CardContent>
        </Card>

        <Card className="border-none shadow-lg bg-white/50 dark:bg-zinc-900/50 backdrop-blur-sm hover:shadow-xl transition-all duration-300 group relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 relative z-10">
            <CardTitle className="text-sm font-medium text-muted-foreground group-hover:text-amber-600 transition-colors">
              {t.metrics.pendingReview}
            </CardTitle>
            <div className="p-2 rounded-full bg-amber-50 dark:bg-amber-900/20 text-amber-500 group-hover:text-amber-600 group-hover:scale-110 transition-all">
              <Clock className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent className="relative z-10">
            <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">{pendingReview}</div>
            <p className="text-xs text-muted-foreground mt-1">
              <span className="text-amber-600 font-medium">Atención requerida</span>
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-8 md:grid-cols-12">
        {/* Main Actions Column */}
        <div className="md:col-span-8 space-y-8">
          <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" /> Acciones Rápidas
          </h2>

          <div className="grid gap-6 md:grid-cols-2">
            {/* AI Budget Generator Card - Highlighted */}
            <div className="md:col-span-2">
              <DashboardRequestCard t={t.requestBudget} />
            </div>

            {/* Configurable Secondary Actions */}
            {QUICK_ACTIONS.map((action) => (
              <Link key={action.href} href={action.href} className="group">
                <Card className="h-full border-zinc-200 dark:border-zinc-800 hover:border-primary/50 hover:shadow-md transition-all duration-300">
                  <CardHeader>
                    <div className={`w-10 h-10 rounded-lg bg-${action.color}-50 dark:bg-${action.color}-900/20 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform duration-300`}>
                      <action.icon className={`w-5 h-5 text-${action.color}-600 dark:text-${action.color}-400`} />
                    </div>
                    <CardTitle className={`group-hover:text-${action.color}-700 transition-colors flex items-center gap-2`}>
                      {action.title}
                      <ArrowRight className="w-4 h-4 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                    </CardTitle>
                    <CardDescription>
                      {action.description}
                    </CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            ))}
          </div>
        </div>

        {/* Sidebar / Recent Activity */}
        <div className="md:col-span-4 space-y-6">
          <h2 className="text-xl font-bold tracking-tight">Actividad Reciente</h2>
          <Card className="h-full border-none shadow-sm bg-zinc-50/50 dark:bg-zinc-900/20">
            <CardContent className="p-6">
              <div className="space-y-6">
                {[1, 2, 3].map((_, i) => (
                  <div key={i} className="flex items-start gap-3 pb-6 border-b border-zinc-100 dark:border-zinc-800 last:border-0 last:pb-0">
                    <div className="w-2 h-2 rounded-full bg-blue-500 mt-2 shrink-0 animate-pulse" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">Nuevo presupuesto generado</p>
                      <p className="text-xs text-muted-foreground">Hace {i * 2 + 5} minutos</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
