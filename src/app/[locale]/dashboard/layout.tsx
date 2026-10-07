import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { NoAccess } from "@/components/auth/no-access";
import { EncargadoHome } from "@/components/auth/encargado-home";
import { getDictionary } from "@/lib/dictionaries";
import { verifyAuth } from "@/backend/auth/auth.middleware";
import {
    canAccessDashboard,
    canAccessRoute,
    DEFAULT_DASHBOARD_ROUTE,
    PATHNAME_HEADER,
    RESTRICTED_ROLE_ROUTES,
} from "@/backend/auth/roles";

/**
 * Guard de SERVIDOR del panel (la capa cliente de DashboardLayout se mantiene).
 *
 * OJO: en App Router los layouts no se re-ejecutan en navegaciones cliente y
 * las páginas se renderizan en paralelo al layout. Este guard bloquea cargas
 * completas y la UI; la protección de DATOS debe vivir en las server actions
 * / páginas (verifyAuth / requireRole).
 */
export default async function Layout({ children, params }: { children: React.ReactNode, params: Promise<{ locale: string }> }) {
    const { locale } = await params;

    const auth = await verifyAuth();
    if (!auth) {
        redirect(`/${locale}/login`);
    }

    if (!canAccessDashboard(auth.platformRole)) {
        return <NoAccess email={auth.email} />;
    }

    const rawPathname = (await headers()).get(PATHNAME_HEADER);
    const isRestricted = !!RESTRICTED_ROLE_ROUTES[auth.platformRole];
    if (rawPathname && !canAccessRoute(auth.platformRole, rawPathname)) {
        redirect(`/${locale}${DEFAULT_DASHBOARD_ROUTE}`);
    }

    const dict = await getDictionary(locale as any);

    // El home de administración (KPIs, presupuestos, solicitudes) no es para
    // roles restringidos: DashboardLayout (cliente, re-evalúa en cada
    // navegación) lo sustituye por `restrictedHome` cuando la ruta es /dashboard.
    return (
        <DashboardLayout
            t={dict}
            platformRole={auth.platformRole}
            restrictedHome={isRestricted ? <EncargadoHome email={auth.email} /> : undefined}
        >
            {children}
        </DashboardLayout>
    );
}
