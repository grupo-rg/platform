import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Fase 0-B — las server actions deben denegar sin sesión.
 * Mockeamos `verifyAuth` (la única fuente de verdad de sesión) y los
 * repositorios/SDKs que las acciones instancian a nivel de módulo, para que
 * los tests no toquen Firestore ni red.
 */
const verifyAuth = vi.fn();
vi.mock('@/backend/auth/auth.middleware', () => ({
    verifyAuth: (...args: unknown[]) => verifyAuth(...args),
}));

const deleteBudget = vi.fn();
vi.mock('@/backend/budget/infrastructure/budget-repository-firestore', () => ({
    BudgetRepositoryFirestore: class { delete = deleteBudget; findAll = vi.fn(async () => []); },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), unstable_noStore: vi.fn() }));

const sendExecute = vi.fn();
vi.mock('@/backend/chat/infrastructure/firestore-conversation-repository', () => ({
    FirestoreConversationRepository: class {},
}));
vi.mock('@/backend/chat/infrastructure/firestore-message-repository', () => ({
    FirestoreMessageRepository: class {},
}));
vi.mock('@/backend/chat/application/send-message.usecase', () => ({
    SendMessageUseCase: class { execute = sendExecute; },
}));

const setCustomUserClaims = vi.fn();
vi.mock('@/backend/shared/infrastructure/firebase/admin-app', () => ({
    adminAuth: {
        getUserByEmail: vi.fn(async () => ({ uid: 'u-1' })),
        setCustomUserClaims: (...a: unknown[]) => setCustomUserClaims(...a),
        getUser: vi.fn(),
    },
}));
vi.mock('@/backend/lead/infrastructure/firestore-lead-repository', () => ({
    FirestoreLeadRepository: class { findById = vi.fn(); save = vi.fn(); },
}));

const ADMIN = { userId: 'admin-1', email: 'a@x.com', role: 'admin', claims: { role: 'admin' } };
const USER = { userId: 'user-1', email: 'u@x.com', role: 'user', claims: {} };

/** Simula verifyAuth real: con requireAdmin=true solo devuelve sesión si es admin. */
function sessionAs(session: typeof ADMIN | typeof USER | null) {
    verifyAuth.mockImplementation(async (requireAdmin = false) => {
        if (!session) return null;
        if (requireAdmin && session.role !== 'admin') return null;
        return session;
    });
}

beforeEach(() => {
    verifyAuth.mockReset();
    deleteBudget.mockReset();
    sendExecute.mockReset();
    setCustomUserClaims.mockReset();
});

describe('_guards', () => {
    it('requireAdmin / requireUser lanzan "No autorizado" sin sesión', async () => {
        sessionAs(null);
        const g = await import('./_guards');
        await expect(g.requireAdmin()).rejects.toThrow('No autorizado');
        await expect(g.requireUser()).rejects.toThrow('No autorizado');
        await expect(g.requireAdmin()).rejects.toBeInstanceOf(g.UnauthorizedError);
        expect(await g.checkAdmin()).toBeNull();
        expect(await g.checkUser()).toBeNull();
    });

    it('requireAdmin deniega a un usuario autenticado no-admin; requireUser lo acepta', async () => {
        sessionAs(USER);
        const g = await import('./_guards');
        await expect(g.requireAdmin()).rejects.toThrow('No autorizado');
        await expect(g.requireUser()).resolves.toMatchObject({ userId: 'user-1' });
    });

    it('requireAdmin acepta admin y devuelve el contexto', async () => {
        sessionAs(ADMIN);
        const g = await import('./_guards');
        await expect(g.requireAdmin()).resolves.toMatchObject({ userId: 'admin-1', role: 'admin' });
    });

    it('checkAdmin falla cerrado si verifyAuth lanza', async () => {
        verifyAuth.mockRejectedValue(new Error('firebase down'));
        const g = await import('./_guards');
        expect(await g.checkAdmin()).toBeNull();
        await expect(g.requireAdmin()).rejects.toThrow('No autorizado');
    });

    it('unauthorizedResult tiene el contrato uniforme', async () => {
        const g = await import('./_guards');
        expect(g.unauthorizedResult()).toEqual({ success: false, error: 'No autorizado' });
        expect(g.isUnauthorized(g.unauthorizedResult())).toBe(true);
    });
});

describe('acciones representativas sin sesión', () => {
    it('deleteBudgetsAction devuelve No autorizado y no borra nada', async () => {
        sessionAs(null);
        const { deleteBudgetsAction } = await import('./budget/delete-budgets.action');
        const res = await deleteBudgetsAction(['b1', 'b2']);
        expect(res).toEqual({ success: false, message: 'No autorizado' });
        expect(deleteBudget).not.toHaveBeenCalled();
    });

    it('getAllBudgetsAction (lectura cruda) rechaza con No autorizado', async () => {
        sessionAs(USER);
        const { getAllBudgetsAction } = await import('./budget/get-all-budgets.action');
        await expect(getAllBudgetsAction()).rejects.toThrow('No autorizado');
    });

    it('sendMessageAction deniega sin sesión y, con admin, toma el remitente de la sesión', async () => {
        sessionAs(null);
        const { sendMessageAction } = await import('./chat/send-message.action');
        expect(await sendMessageAction('c1', 'hola', 'admin', 'spoofed')).toEqual({ success: false, error: 'No autorizado' });
        expect(sendExecute).not.toHaveBeenCalled();

        sessionAs(ADMIN);
        sendExecute.mockResolvedValue({ id: 'm1' });
        await sendMessageAction('c1', 'hola', 'lead', 'lead-spoofed');
        expect(sendExecute).toHaveBeenCalledWith(expect.objectContaining({
            sender: { id: 'admin-1', type: 'admin' },
        }));
    });

    it('setAdminClaim: deniega sin sesión admin aunque el secreto sea correcto, y falla cerrado sin ADMIN_SECRET', async () => {
        const { setAdminClaim } = await import('./debug/fix-account.action');
        process.env.ADMIN_SECRET = 's3cret';
        sessionAs(null);
        expect(await setAdminClaim('x@y.com', 's3cret')).toEqual({ success: false, error: 'No autorizado' });
        expect(await setAdminClaim('x@y.com', 'grupo-rg-admin-dev-secret')).toMatchObject({ success: false });

        sessionAs(ADMIN);
        delete process.env.ADMIN_SECRET;
        expect(await setAdminClaim('x@y.com', 'grupo-rg-admin-dev-secret')).toEqual({ success: false, error: 'No autorizado' });
        expect(setCustomUserClaims).not.toHaveBeenCalled();
    });
});
