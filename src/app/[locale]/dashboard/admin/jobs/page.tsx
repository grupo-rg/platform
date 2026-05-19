/**
 * Admin "Pipeline Jobs" overview page.
 *
 * Loads the most recent ~200 pipeline jobs from Firestore (canonical
 * `pipeline_jobs` + legacy `pipeline_telemetry` fallback) and hands them
 * to the interactive `JobsTable` client component for filtering, sorting,
 * pagination and per-row admin actions.
 *
 * Auth: server-side `verifyAuth(true)` gate. Non-admins get a redirect
 * to /dashboard (so they don't see the page even briefly).
 */

import { redirect } from 'next/navigation';
import { verifyAuth } from '@/backend/auth/auth.middleware';
import { getPipelineJobsAction } from '@/actions/admin/get-pipeline-jobs.action';
import { JobsTable } from '@/components/admin/jobs/jobs-table';
import { Card, CardContent } from '@/components/ui/card';
import { Boxes, Activity, CheckCircle2, AlertCircle, XCircle, Loader2 } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AdminJobsPage() {
    const auth = await verifyAuth(true);
    if (!auth) redirect('/dashboard');

    const jobs = await getPipelineJobsAction({ limit: 200 });

    const totals = {
        all: jobs.length,
        active: jobs.filter(j => j.status === 'queued' || j.status === 'running' || j.status === 'in_progress').length,
        completed: jobs.filter(j => j.status === 'completed').length,
        failed: jobs.filter(j => j.status === 'failed').length,
        canceled: jobs.filter(j => j.status === 'canceled').length,
    };

    const stats: { label: string; value: number; icon: React.ReactNode; className: string }[] = [
        { label: 'Total', value: totals.all, icon: <Boxes className="h-4 w-4" />, className: 'text-zinc-700 dark:text-zinc-300' },
        { label: 'Activos', value: totals.active, icon: <Loader2 className="h-4 w-4" />, className: 'text-blue-600 dark:text-blue-400' },
        { label: 'Completados', value: totals.completed, icon: <CheckCircle2 className="h-4 w-4" />, className: 'text-emerald-600 dark:text-emerald-400' },
        { label: 'Fallidos', value: totals.failed, icon: <AlertCircle className="h-4 w-4" />, className: 'text-red-600 dark:text-red-400' },
        { label: 'Cancelados', value: totals.canceled, icon: <XCircle className="h-4 w-4" />, className: 'text-orange-600 dark:text-orange-400' },
    ];

    return (
        <div className="flex-1 space-y-6 max-w-7xl mx-auto p-4 md:p-8">
            <div className="flex flex-col gap-2 mb-6">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-primary/10 rounded-lg">
                        <Activity className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-display font-bold tracking-tight">Pipeline Jobs</h1>
                        <p className="text-muted-foreground">
                            Estado y operaciones sobre los jobs del worker (generación de presupuesto, mediciones, NL).
                        </p>
                    </div>
                </div>
            </div>

            {/* Stat cards */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {stats.map(s => (
                    <Card key={s.label} className="border-white/5">
                        <CardContent className="p-4 flex items-center gap-3">
                            <div className={`p-2 rounded-md bg-zinc-100 dark:bg-zinc-800 ${s.className}`}>
                                {s.icon}
                            </div>
                            <div>
                                <div className={`text-2xl font-bold ${s.className}`}>{s.value}</div>
                                <div className="text-xs text-muted-foreground">{s.label}</div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            <JobsTable jobs={jobs} />
        </div>
    );
}
