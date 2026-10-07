/**
 * Roles de plataforma y reglas de acceso al panel — lógica PURA.
 *
 * Este módulo no importa nada de Firebase ni de Next.js para que pueda usarse
 * tanto en el servidor (layout, server actions, middleware edge) como en el
 * cliente (AuthContext, sidebar) y testearse con vitest sin mocks.
 *
 * Jerarquía:
 *   - super-admin: todo, incluida la gestión de otros super-admins.
 *   - admin:       todo el panel, gestión de usuarios salvo super-admins.
 *   - encargado:   jefe de obra. Solo home básico + Obras (futuro módulo de partes).
 *   - user:        autenticado sin permisos. No entra al panel.
 */

export const PLATFORM_ROLES = ['super-admin', 'admin', 'encargado', 'user'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

/** Roles que se pueden asignar en un cambio de rol ('user' = quitar acceso). */
export const ASSIGNABLE_ROLES: readonly PlatformRole[] = PLATFORM_ROLES;

/** Roles que se pueden ofrecer en una invitación (invitar sin acceso no tiene sentido). */
export const INVITABLE_ROLES: readonly PlatformRole[] = ['super-admin', 'admin', 'encargado'];

export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = {
    'super-admin': 'Super-admin',
    admin: 'Administrador',
    encargado: 'Encargado de obra',
    user: 'Sin acceso',
};

export function isPlatformRole(value: unknown): value is PlatformRole {
    return typeof value === 'string' && (PLATFORM_ROLES as readonly string[]).includes(value);
}

/**
 * Resuelve el rol de plataforma a partir de los custom claims del token.
 *
 * Precedencia:
 *   1. `role` explícito y válido (lo escriben scripts/set-admin.js y la
 *      pantalla de usuarios).
 *   2. Claim legacy `admin === true` → 'admin'.
 *   3. Cualquier otra cosa → 'user' (sin acceso).
 */
export function resolvePlatformRole(claims: Record<string, unknown> | null | undefined): PlatformRole {
    if (!claims) return 'user';
    if (isPlatformRole(claims.role)) {
        // Un role 'user' con admin:true legacy sigue siendo admin: el claim
        // legacy solo lo pone un script de admins, nunca la UI.
        if (claims.role === 'user' && claims.admin === true) return 'admin';
        return claims.role;
    }
    if (claims.admin === true) return 'admin';
    return 'user';
}

/** Rol "legacy" binario que siguen usando `verifyAuth(requireAdmin)` y sus llamadores. */
export function toLegacyRole(role: PlatformRole): 'admin' | 'user' {
    return role === 'super-admin' || role === 'admin' ? 'admin' : 'user';
}

export function isAdminRole(role: PlatformRole): boolean {
    return toLegacyRole(role) === 'admin';
}

/** ¿Puede este rol entrar al panel (`/dashboard/**`)? */
export function canAccessDashboard(role: PlatformRole): boolean {
    return role !== 'user';
}

/** ¿Puede gestionar usuarios (pantalla /dashboard/settings/users)? */
export function canManageUsers(role: PlatformRole): boolean {
    return isAdminRole(role);
}

/**
 * ¿Puede `actor` asignar `targetRole` a un usuario cuyo rol actual es
 * `currentTargetRole`? Solo un super-admin crea o retira super-admins.
 */
export function canAssignRole(
    actor: PlatformRole,
    targetRole: PlatformRole,
    currentTargetRole: PlatformRole = 'user',
): boolean {
    if (!canManageUsers(actor)) return false;
    if (actor === 'super-admin') return true;
    return targetRole !== 'super-admin' && currentTargetRole !== 'super-admin';
}

// ---------------------------------------------------------------------------
// Rutas permitidas por rol
// ---------------------------------------------------------------------------

/**
 * Lista CENTRAL de rutas del panel permitidas por rol restringido.
 * `exact`: solo esa ruta. `prefix`: esa ruta y todo lo que cuelga de ella.
 * Los roles admin/super-admin no tienen lista: ven todo.
 */
export type RouteRule = { path: string; match: 'exact' | 'prefix' };

export const RESTRICTED_ROLE_ROUTES: Partial<Record<PlatformRole, RouteRule[]>> = {
    encargado: [
        { path: '/dashboard', match: 'exact' },
        { path: '/dashboard/projects', match: 'prefix' },
    ],
};

/** Rutas que solo pueden ver admin y super-admin aunque en el futuro se abran otras. */
export const ADMIN_ONLY_ROUTES: RouteRule[] = [
    { path: '/dashboard/settings/users', match: 'prefix' },
];

/**
 * Cabecera interna que pone src/middleware.ts con el pathname pedido, para que
 * el layout (server) del dashboard pueda aplicar las reglas por ruta.
 */
export const PATHNAME_HEADER = 'x-dochevi-pathname';

/** Ruta a la que se redirige un rol restringido cuando pide algo prohibido. */
export const DEFAULT_DASHBOARD_ROUTE = '/dashboard';

const LOCALE_SEGMENT = /^\/(es|en|ca|de|nl)(?=\/|$)/;

/**
 * Normaliza un pathname externo (`/es/dashboard/projects/?x=1`) a la forma
 * interna sin locale ni query ni barra final (`/dashboard/projects`).
 */
export function normalizeDashboardPath(pathname: string): string {
    let p = (pathname || '/').split(/[?#]/)[0] || '/';
    p = p.replace(LOCALE_SEGMENT, '') || '/';
    p = p.replace(/\/{2,}/g, '/');
    if (p.length > 1) p = p.replace(/\/+$/, '');
    return p || '/';
}

function matchesRule(path: string, rule: RouteRule): boolean {
    if (rule.match === 'exact') return path === rule.path;
    return path === rule.path || path.startsWith(rule.path + '/');
}

export function isDashboardPath(pathname: string): boolean {
    return matchesRule(normalizeDashboardPath(pathname), { path: '/dashboard', match: 'prefix' });
}

/** ¿Puede `role` ver la ruta `pathname` (con o sin locale)? */
export function canAccessRoute(role: PlatformRole, pathname: string): boolean {
    if (!canAccessDashboard(role)) return false;
    const path = normalizeDashboardPath(pathname);
    if (ADMIN_ONLY_ROUTES.some(r => matchesRule(path, r)) && !isAdminRole(role)) return false;
    const allowed = RESTRICTED_ROLE_ROUTES[role];
    if (!allowed) return true;
    return allowed.some(r => matchesRule(path, r));
}

/** Para el sidebar: ¿se muestra el enlace `href` a este rol? */
export function canSeeNavItem(role: PlatformRole, href: string): boolean {
    return canAccessRoute(role, href);
}
