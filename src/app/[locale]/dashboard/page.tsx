import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getDictionary } from '@/lib/dictionaries';
import Link from 'next/link';
import {
  ArrowRight,
  FileText,
  Users,
  Clock,
  Sparkles,
  Building2,
  HardHat,
  CalendarDays,
  Plus,
} from 'lucide-react';
import { getAllBudgetsAction } from '@/actions/budget/get-all-budgets.action';
import { getLeadsAction } from '@/actions/lead/dashboard.action';
import { getAllProjectsAction } from '@/actions/project/get-all-projects.action';
import { getAdminBookingsAction } from '@/actions/agenda/booking.action';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const mockUser = {
  displayName: 'Usuario',
  email: 'user@example.com'
};

const DAY_MS = 24 * 60 * 60 * 1000;

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'hace instantes';
  if (diff < 3_600_000) return `hace ${Math.round(diff / 60_000)} min`;
  if (diff < 86_400_000) return `hace ${Math.round(diff / 3_600_000)} h`;
  return `hace ${Math.round(diff / 86_400_000)} días`;
}

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const dict = await getDictionary(locale as any);
  const t = dict.dashboard;
  const user = mockUser;

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * DAY_MS);
  const sevenDaysAhead = new Date(now.getTime() + 7 * DAY_MS);

  // Data (paralelo)
  const [budgets, leads, projects, upcomingBookings] = await Promise.all([
    getAllBudgetsAction(),
    getLeadsAction(200, 0),
    getAllProjectsAction(),
    getAdminBookingsAction(now.toISOString(), sevenDaysAhead.toISOString()),
  ]);

  // KPIs — ventanas 30d vs 30d previos
  const leadsLast30 = leads.filter(l => new Date(l.createdAt) >= thirtyDaysAgo);
  const leadsPrev30 = leads.filter(l => {
    const d = new Date(l.createdAt);
    return d >= sixtyDaysAgo && d < thirtyDaysAgo;
  });
  const leadsDelta = leadsPrev30.length > 0
    ? Math.round(((leadsLast30.length - leadsPrev30.length) / leadsPrev30.length) * 100)
    : null;

  const budgetsLast30 = budgets.filter((b: any) => {
    const d = b.createdAt instanceof Date ? b.createdAt : new Date((b.createdAt as any)?._seconds ? (b.createdAt as any)._seconds * 1000 : b.createdAt);
    return !isNaN(d.getTime()) && d >= thirtyDaysAgo;
  });
  const totalBudgeted30 = budgetsLast30.reduce((acc: number, b: any) => acc + (b.totalEstimated || b.costBreakdown?.total || 0), 0);
  const pendingReview = budgets.filter((b: any) => b.status === 'pending_review').length;
  const activeProjects = projects.filter(p => p.status === 'preparacion' || p.status === 'ejecucion').length;

  // Actividad reciente — merge de leads, budgets y bookings
  type Activity = { ts: number; type: string; text: string; href: string; icon: any };
  const activity: Activity[] = [
    ...leads.slice(0, 10).map(l => ({
      ts: new Date(l.createdAt).getTime(),
      type: 'lead',
      text: `Nuevo lead: ${l.name}`,
      href: `/dashboard/leads`,
      icon: Users,
    })),
    ...budgets.slice(0, 10).map((b: any) => ({
      ts: (b.createdAt instanceof Date ? b.createdAt : new Date((b.createdAt as any)?._seconds ? (b.createdAt as any)._seconds * 1000 : b.createdAt)).getTime(),
      type: 'budget',
      text: `Presupuesto ${b.id?.substring?.(0, 6) ?? ''} · ${b.clientSnapshot?.name ?? 'Sin cliente'}`,
      href: `/dashboard/admin/budgets/${b.id}/edit`,
      icon: FileText,
    })),
    ...upcomingBookings.slice(0, 5).map((b: any) => ({
      ts: new Date(b.date).getTime(),
      type: 'booking',
      text: `Cita con ${b.name} · ${b.timeSlot}`,
      href: `/dashboard/agenda`,
      icon: CalendarDays,
    })),
  ]
    .filter(a => !isNaN(a.ts))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 10);

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(amount);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* Hero compacto */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <Badge className="mb-2 bg-primary/10 text-primary border-primary/20 hover:bg-primary/15">
            <Sparkles className="w-3 h-3 mr-1" /> Panel
          </Badge>
          <h1 className="text-3xl md:text-4xl font-bold font-headline tracking-tight">
            {t.welcome.title}, <span className="text-primary">{user?.displayName}</span>
          </h1>
          <p className="text-muted-foreground mt-1">
            {t.welcome.description}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/assistant">
            <Button className="bg-primary hover:bg-primary/90">
              <Sparkles className="w-4 h-4 mr-2" />
              Nuevo presupuesto con IA
            </Button>
          </Link>
          <Link href="/dashboard/leads">
            <Button variant="outline">
              <Plus className="w-4 h-4 mr-2" />
              Nuevo lead
            </Button>
          </Link>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={Users}
          label="Leads (30d)"
          value={String(leadsLast30.length)}
          delta={leadsDelta}
          accent="blue"
        />
        <KpiCard
          icon={FileText}
          label={t.metrics.pendingReview}
          value={String(pendingReview)}
          accent="amber"
        />
        <KpiCard
          icon={Clock}
          label="Presupuestado (30d)"
          value={formatCurrency(totalBudgeted30)}
          accent="emerald"
        />
        <KpiCard
          icon={HardHat}
          label="Obras activas"
          value={String(activeProjects)}
          accent="indigo"
        />
      </div>

      {/* Actividad reciente + Agenda próxima */}
      <div className="grid gap-6 xl:grid-cols-12">
        <Card className="xl:col-span-7 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Actividad reciente</CardTitle>
            <Link href="/dashboard/analytics" className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1">
              Ver todo <ArrowRight className="w-3 h-3" />
            </Link>
          </CardHeader>
          <CardContent>
            {activity.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Todavía no hay actividad. Cuando se creen leads, presupuestos o citas aparecerán aquí.
              </p>
            ) : (
              <ul className="divide-y">
                {activity.map((a, i) => {
                  const Icon = a.icon;
                  return (
                    <li key={i}>
                      <Link href={a.href as any} className="flex items-start gap-3 py-3 group">
                        <div className="mt-0.5 w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0 group-hover:bg-primary/10 transition-colors">
                          <Icon className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{a.text}</p>
                          <p className="text-xs text-muted-foreground">{relativeTime(new Date(a.ts).toISOString())}</p>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="xl:col-span-5 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Agenda próximos 7 días</CardTitle>
            <Link href="/dashboard/agenda" className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1">
              Ver agenda <ArrowRight className="w-3 h-3" />
            </Link>
          </CardHeader>
          <CardContent>
            {upcomingBookings.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No hay citas programadas.
              </p>
            ) : (
              <ul className="space-y-3">
                {upcomingBookings.slice(0, 6).map((b: any) => (
                  <li key={b.id} className="flex items-start gap-3">
                    <div className="text-center w-12 shrink-0">
                      <div className="text-[10px] uppercase text-muted-foreground">{new Date(b.date).toLocaleDateString(locale, { month: 'short' })}</div>
                      <div className="text-lg font-bold leading-none">{new Date(b.date).getDate()}</div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{b.name}</p>
                      <p className="text-xs text-muted-foreground">{b.timeSlot} · <span className="capitalize">{b.status}</span></p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Accesos rápidos */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <QuickLink href="/dashboard/admin/budgets" icon={FileText} title="Presupuestos" desc="Historial y estados" />
        <QuickLink href="/dashboard/projects" icon={Building2} title="Obras" desc="Proyectos en curso" />
        <QuickLink href="/dashboard/seo-generator" icon={Sparkles} title="Generador SEO" desc="Contenido optimizado" />
        <QuickLink href="/dashboard/settings/company" icon={Building2} title="Empresa" desc="Datos del emisor" />
      </div>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  delta,
  accent,
}: {
  icon: any;
  label: string;
  value: string;
  delta?: number | null;
  accent: 'blue' | 'emerald' | 'amber' | 'indigo';
}) {
  const accentClasses: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400',
    emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400',
    amber: 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400',
    indigo: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400',
  };

  return (
    <Card className="shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${accentClasses[accent]}`}>
            <Icon className="w-4 h-4" />
          </div>
        </div>
        <div className="text-2xl font-bold">{value}</div>
        {typeof delta === 'number' && (
          <p className={`text-xs mt-1 ${delta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {delta >= 0 ? '↑' : '↓'} {Math.abs(delta)}% vs 30d previos
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function QuickLink({ href, icon: Icon, title, desc }: { href: string; icon: any; title: string; desc: string }) {
  return (
    <Link href={href as any} className="group">
      <Card className="h-full hover:border-primary/40 hover:shadow-md transition-all">
        <CardContent className="p-5">
          <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
            <Icon className="w-5 h-5" />
          </div>
          <div className="font-semibold text-sm flex items-center gap-2">
            {title}
            <ArrowRight className="w-3.5 h-3.5 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
          </div>
          <p className="text-xs text-muted-foreground mt-1">{desc}</p>
        </CardContent>
      </Card>
    </Link>
  );
}
