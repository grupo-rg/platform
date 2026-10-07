import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const verifyAuth = vi.fn();
vi.mock('@/backend/auth/auth.middleware', () => ({
    verifyAuth: (...args: unknown[]) => verifyAuth(...args),
}));

import { requireAdminRoute, requireBearerSecret, requireSecretHeader, safeEqual } from './route-guards';

const req = (headers: Record<string, string> = {}) => new Request('http://localhost/api/x', { headers });

describe('route-guards', () => {
    const ORIG = { ...process.env };
    beforeEach(() => verifyAuth.mockReset());
    afterEach(() => { process.env = { ...ORIG }; });

    it('requireAdminRoute: 401 sin sesión, 403 con sesión no-admin, null con admin', async () => {
        verifyAuth.mockResolvedValue(null);
        expect((await requireAdminRoute())?.status).toBe(401);

        verifyAuth.mockImplementation(async (admin: boolean) => (admin ? null : { userId: 'u' }));
        expect((await requireAdminRoute())?.status).toBe(403);

        verifyAuth.mockResolvedValue({ userId: 'a', role: 'admin' });
        expect(await requireAdminRoute()).toBeNull();
    });

    it('requireBearerSecret falla cerrado si CRON_SECRET no está definido', () => {
        delete process.env.CRON_SECRET;
        expect(requireBearerSecret(req(), 'CRON_SECRET')?.status).toBe(401);
        expect(requireBearerSecret(req({ authorization: 'Bearer ' }), 'CRON_SECRET')?.status).toBe(401);
        expect(requireBearerSecret(req({ authorization: 'Bearer undefined' }), 'CRON_SECRET')?.status).toBe(401);
    });

    it('requireBearerSecret acepta solo el secreto correcto', () => {
        process.env.CRON_SECRET = 'abc123';
        expect(requireBearerSecret(req({ authorization: 'Bearer abc123' }), 'CRON_SECRET')).toBeNull();
        expect(requireBearerSecret(req({ authorization: 'Bearer abc1234' }), 'CRON_SECRET')?.status).toBe(401);
        expect(requireBearerSecret(req({ authorization: 'abc123' }), 'CRON_SECRET')?.status).toBe(401);
    });

    it('requireSecretHeader (worker) falla cerrado y compara el token', () => {
        delete process.env.INTERNAL_WORKER_TOKEN;
        expect(requireSecretHeader(req({ 'x-internal-token': '' }), 'x-internal-token', 'INTERNAL_WORKER_TOKEN')?.status).toBe(401);
        process.env.INTERNAL_WORKER_TOKEN = 'tok';
        expect(requireSecretHeader(req({ 'x-internal-token': 'tok' }), 'x-internal-token', 'INTERNAL_WORKER_TOKEN')).toBeNull();
        expect(requireSecretHeader(req({ 'x-internal-token': 'nope' }), 'x-internal-token', 'INTERNAL_WORKER_TOKEN')?.status).toBe(401);
    });

    it('safeEqual', () => {
        expect(safeEqual('a', 'a')).toBe(true);
        expect(safeEqual('a', 'ab')).toBe(false);
    });
});
