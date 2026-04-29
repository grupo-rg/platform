import { redirect } from 'next/navigation';

/**
 * Ruta legacy. El detalle del lead vive ahora en /dashboard/leads/[id].
 */
interface PageProps {
    params: Promise<{ id: string }>;
}

export default async function AdminLeadDetailRedirectPage({ params }: PageProps) {
    const { id } = await params;
    redirect(`/dashboard/leads/${id}`);
}
