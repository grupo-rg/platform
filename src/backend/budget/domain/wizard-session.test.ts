import { describe, it, expect } from 'vitest';
import { newWizardSession, type WizardSession } from './wizard-session';

describe('WizardSession factory', () => {
    it('creates a session with sensible defaults', () => {
        const session: WizardSession = newWizardSession({ id: 'sess-1', uid: 'u-1' });
        expect(session.id).toBe('sess-1');
        expect(session.uid).toBe('u-1');
        expect(session.leadId).toBeNull();
        expect(session.budgetId).toBeNull();
        expect(session.lastJobId).toBeNull();
        expect(session.messages).toEqual([]);
        expect(session.state).toBe('idle');
        expect(session.requirements).toEqual({});
        expect(typeof session.createdAt).toBe('string');
        expect(typeof session.updatedAt).toBe('string');
    });

    it('honours an explicit leadId', () => {
        const session = newWizardSession({ id: 'sess-2', uid: 'u-1', leadId: 'lead-99' });
        expect(session.leadId).toBe('lead-99');
    });

    it('treats null leadId the same as omitted', () => {
        const session = newWizardSession({ id: 'sess-3', uid: 'u-1', leadId: null });
        expect(session.leadId).toBeNull();
    });
});
