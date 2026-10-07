import { describe, expect, it } from 'vitest';
import {
    canAccessDashboard,
    canAccessRoute,
    canAssignRole,
    canManageUsers,
    canSeeNavItem,
    isDashboardPath,
    normalizeDashboardPath,
    resolvePlatformRole,
    toLegacyRole,
} from './roles';

describe('resolvePlatformRole', () => {
    it('usa el claim role cuando es válido', () => {
        expect(resolvePlatformRole({ role: 'super-admin' })).toBe('super-admin');
        expect(resolvePlatformRole({ role: 'admin' })).toBe('admin');
        expect(resolvePlatformRole({ role: 'encargado' })).toBe('encargado');
        expect(resolvePlatformRole({ role: 'user' })).toBe('user');
    });

    it('acepta el claim legacy admin:true como admin', () => {
        expect(resolvePlatformRole({ admin: true })).toBe('admin');
        expect(resolvePlatformRole({ role: 'user', admin: true })).toBe('admin');
    });

    it('role explícito tiene prioridad sobre admin legacy', () => {
        expect(resolvePlatformRole({ role: 'super-admin', admin: true })).toBe('super-admin');
        expect(resolvePlatformRole({ role: 'encargado', admin: true })).toBe('encargado');
    });

    it('sin claims o con valores desconocidos → user', () => {
        expect(resolvePlatformRole(null)).toBe('user');
        expect(resolvePlatformRole(undefined)).toBe('user');
        expect(resolvePlatformRole({})).toBe('user');
        expect(resolvePlatformRole({ role: 'root' })).toBe('user');
        expect(resolvePlatformRole({ admin: 'true' })).toBe('user');
        expect(resolvePlatformRole({ role: ['admin'] })).toBe('user');
    });
});

describe('toLegacyRole (semántica de verifyAuth(true))', () => {
    it('admin = admin o super-admin', () => {
        expect(toLegacyRole('super-admin')).toBe('admin');
        expect(toLegacyRole('admin')).toBe('admin');
        expect(toLegacyRole('encargado')).toBe('user');
        expect(toLegacyRole('user')).toBe('user');
    });
});

describe('permisos de gestión', () => {
    it('solo admin/super-admin gestionan usuarios', () => {
        expect(canManageUsers('super-admin')).toBe(true);
        expect(canManageUsers('admin')).toBe(true);
        expect(canManageUsers('encargado')).toBe(false);
        expect(canManageUsers('user')).toBe(false);
    });

    it('solo super-admin crea o retira super-admins', () => {
        expect(canAssignRole('super-admin', 'super-admin')).toBe(true);
        expect(canAssignRole('super-admin', 'user', 'super-admin')).toBe(true);
        expect(canAssignRole('admin', 'super-admin')).toBe(false);
        expect(canAssignRole('admin', 'admin', 'super-admin')).toBe(false);
        expect(canAssignRole('admin', 'encargado', 'user')).toBe(true);
        expect(canAssignRole('admin', 'admin', 'encargado')).toBe(true);
        expect(canAssignRole('encargado', 'encargado')).toBe(false);
    });

    it('user no entra al panel', () => {
        expect(canAccessDashboard('user')).toBe(false);
        expect(canAccessDashboard('encargado')).toBe(true);
    });
});

describe('normalizeDashboardPath', () => {
    it('quita locale, query y barra final', () => {
        expect(normalizeDashboardPath('/es/dashboard/projects/')).toBe('/dashboard/projects');
        expect(normalizeDashboardPath('/en/dashboard?x=1')).toBe('/dashboard');
        expect(normalizeDashboardPath('/dashboard/admin/prices?view=catalog')).toBe('/dashboard/admin/prices');
        expect(normalizeDashboardPath('/es')).toBe('/');
        expect(normalizeDashboardPath('/estudio/dashboard')).toBe('/estudio/dashboard');
    });

    it('detecta rutas del panel', () => {
        expect(isDashboardPath('/ca/dashboard/leads')).toBe(true);
        expect(isDashboardPath('/es/dashboardx')).toBe(false);
        expect(isDashboardPath('/es/login')).toBe(false);
    });
});

describe('canAccessRoute', () => {
    it('admin y super-admin ven todo el panel', () => {
        for (const r of ['admin', 'super-admin'] as const) {
            expect(canAccessRoute(r, '/es/dashboard')).toBe(true);
            expect(canAccessRoute(r, '/es/dashboard/leads')).toBe(true);
            expect(canAccessRoute(r, '/es/dashboard/settings/users')).toBe(true);
        }
    });

    it('encargado solo ve home y obras', () => {
        expect(canAccessRoute('encargado', '/es/dashboard')).toBe(true);
        expect(canAccessRoute('encargado', '/es/dashboard/')).toBe(true);
        expect(canAccessRoute('encargado', '/es/dashboard/projects')).toBe(true);
        expect(canAccessRoute('encargado', '/de/dashboard/projects/abc/partes')).toBe(true);
        expect(canAccessRoute('encargado', '/es/dashboard/projectsx')).toBe(false);
        expect(canAccessRoute('encargado', '/es/dashboard/leads')).toBe(false);
        expect(canAccessRoute('encargado', '/es/dashboard/admin/budgets')).toBe(false);
        expect(canAccessRoute('encargado', '/es/dashboard/asistente')).toBe(false);
        expect(canAccessRoute('encargado', '/es/dashboard/settings/users')).toBe(false);
    });

    it('user no ve nada del panel', () => {
        expect(canAccessRoute('user', '/es/dashboard')).toBe(false);
        expect(canAccessRoute('user', '/es/dashboard/projects')).toBe(false);
    });

    it('sidebar: encargado solo ve Panel y Obras', () => {
        const hrefs = ['/dashboard', '/dashboard/projects', '/dashboard/leads', '/dashboard/assistant', '/dashboard/settings/users', '/dashboard/admin/prices?view=catalog'];
        expect(hrefs.filter(h => canSeeNavItem('encargado', h))).toEqual(['/dashboard', '/dashboard/projects']);
        expect(hrefs.filter(h => canSeeNavItem('admin', h))).toEqual(hrefs);
    });
});
