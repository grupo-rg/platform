import { redirect } from 'next/navigation';

/**
 * Ruta legacy. El Inbox vive ahora como tab dentro de /dashboard/leads.
 * Redirige preservando los filtros (decision/source/q).
 */
interface PageProps {
    searchParams: Promise<{ decision?: string; source?: string; q?: string }>;
}

export default async function AdminLeadsRedirectPage({ searchParams }: PageProps) {
    const sp = await searchParams;
    const params = new URLSearchParams();
    params.set('tab', 'inbox');
    if (sp.decision) params.set('decision', sp.decision);
    if (sp.source) params.set('source', sp.source);
    if (sp.q) params.set('q', sp.q);
    redirect(`/dashboard/leads?${params.toString()}`);
}
