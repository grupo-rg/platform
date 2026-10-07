import { getAllProjectsAction } from '@/actions/project/get-all-projects.action';
import { getAllBudgetsAction } from '@/actions/budget/get-all-budgets.action';
import { getDictionary } from '@/lib/dictionaries';
import { ProjectsPageClient } from './projects-page-client';

export default async function ProjectsPage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;
    const dict = await getDictionary(locale as any);

    // Fetch data in parallel
    // `getAllBudgetsAction` es admin-only; los presupuestos solo sirven para
    // crear obras (acción también admin-only). Un usuario no-admin con acceso
    // a obras (p.ej. rol `encargado`) ve la lista sin presupuestos en vez de
    // romper la página.
    const [projects, allBudgets] = await Promise.all([
        getAllProjectsAction(),
        getAllBudgetsAction().catch(() => []),
    ]);

    // Only approved budgets (without an existing project) can be used to create new projects
    const projectBudgetIds = new Set(projects.map(p => p.budgetId));
    const approvedBudgets = allBudgets.filter(
        b => b.status === 'approved' && !projectBudgetIds.has(b.id)
    );

    return (
        <ProjectsPageClient
            projects={projects}
            approvedBudgets={approvedBudgets}
            locale={locale}
        />
    );
}
