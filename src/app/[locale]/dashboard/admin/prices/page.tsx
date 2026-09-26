import { redirect } from 'next/navigation';
import { verifyAuth } from '@/backend/auth/auth.middleware';
import { PriceBookAdminView } from './price-book-admin-view';

// Lee cookies vía `verifyAuth` → la ruta es dinámica. Explícito para alinearse
// con el resto de páginas admin (jobs, catalog-audit, pdf-layout-test).
export const dynamic = 'force-dynamic';

export default async function PriceBookAdminPage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;

    // Gate admin server-side: los no-admin no ven la página ni un instante.
    const auth = await verifyAuth(true);
    if (!auth) redirect(`/${locale}/dashboard`);

    return (
        <PriceBookAdminView locale={locale} />
    );
}
