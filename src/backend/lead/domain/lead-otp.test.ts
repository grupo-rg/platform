import { describe, it, expect } from 'vitest';
import { Lead, OTP_POLICY } from './lead';
import { generateOtpCode, hashOtp, otpMatches } from '../infrastructure/otp-crypto';
import { RequestLeadAccess } from '../application/request-lead-access';
import { VerifyLeadAccess } from '../application/verify-lead-access';
import type { LeadRepository } from './lead-repository';
import type { OtpHasher, OtpService } from './otp-service';
import { buildConsents } from './lead-consent';

const SECRET = 'test-secret-test-secret-test-secret-1234';
const hasher: OtpHasher = {
    hash: (leadId, code) => hashOtp(leadId, code, SECRET),
    matches: (leadId, code, stored) => otpMatches(leadId, code, stored, SECRET),
};

function newLead(id = 'lead-1') {
    return Lead.create(id, { name: 'Ana', email: 'ana@example.com', phone: '600000000' }, { contactMethod: 'email', language: 'es' });
}

function matcherFor(lead: Lead) {
    return (code: string, stored: string) => hasher.matches(lead.id, code, stored);
}

class InMemoryLeadRepo implements LeadRepository {
    leads = new Map<string, Lead>();
    async save(lead: Lead) { this.leads.set(lead.id, lead); }
    async findById(id: string) { return this.leads.get(id) || null; }
    async findByEmail(email: string) {
        for (const l of this.leads.values()) if (l.personalInfo.email.toLowerCase() === email.toLowerCase()) return l;
        return null;
    }
    async findAll() { return [...this.leads.values()]; }
    async countByStatus() { return { verified: 0, unverified: 0, profiled: 0 }; }
    async delete(id: string) { this.leads.delete(id); }
}

class FakeOtpService implements OtpService {
    sent: { email: string; code: string }[] = [];
    constructor(private code = '123456') {}
    generateCode() { return this.code; }
    async sendOtp(email: string, code: string) { this.sent.push({ email, code }); }
}

describe('otp-crypto', () => {
    it('genera códigos de 6 dígitos con CSPRNG (incluye ceros a la izquierda)', () => {
        for (let i = 0; i < 200; i++) {
            expect(generateOtpCode()).toMatch(/^\d{6}$/);
        }
    });

    it('el hash depende del leadId (sal) y no contiene el código', () => {
        const a = hashOtp('lead-a', '123456', SECRET);
        const b = hashOtp('lead-b', '123456', SECRET);
        expect(a).not.toEqual(b);
        expect(a).not.toContain('123456');
        expect(a).toMatch(/^[a-f0-9]{64}$/);
    });

    it('otpMatches rechaza código, lead o secreto distintos', () => {
        const h = hashOtp('lead-a', '123456', SECRET);
        expect(otpMatches('lead-a', '123456', h, SECRET)).toBe(true);
        expect(otpMatches('lead-a', '123457', h, SECRET)).toBe(false);
        expect(otpMatches('lead-b', '123456', h, SECRET)).toBe(false);
        expect(otpMatches('lead-a', '123456', h, 'otro-secreto-otro-secreto-otro-secreto')).toBe(false);
        expect(otpMatches('lead-a', 'abc', h, SECRET)).toBe(false);
    });
});

describe('Lead.verifyOtp', () => {
    it('guarda sólo el hash y expira a los 10 minutos', () => {
        const lead = newLead();
        const now = new Date('2026-10-07T10:00:00Z');
        lead.generateOtp(hasher.hash(lead.id, '654321'), now);
        expect(lead.verification.otpHash).toBeDefined();
        expect(lead.verification.otpCode).toBeUndefined();
        expect(lead.verification.otpExpiresAt!.getTime() - now.getTime()).toBe(OTP_POLICY.ttlMinutes * 60_000);

        const later = new Date(now.getTime() + 10 * 60_000 + 1);
        expect(lead.verifyOtp('654321', matcherFor(lead), later)).toBe('expired');
        // El código caducado queda invalidado.
        expect(lead.verification.otpHash).toBeUndefined();
        expect(lead.verifyOtp('654321', matcherFor(lead), now)).toBe('no_code');
    });

    it('verifica un código correcto y lo invalida (un solo uso)', () => {
        const lead = newLead();
        const now = new Date();
        lead.generateOtp(hasher.hash(lead.id, '111222'), now);
        expect(lead.verifyOtp('111222', matcherFor(lead), now)).toBe('verified');
        expect(lead.verification.isVerified).toBe(true);
        expect(lead.verifyOtp('111222', matcherFor(lead), now)).toBe('no_code');
    });

    it('un lead YA verificado no pasa sin código válido (sin bypass)', () => {
        const lead = newLead();
        lead.verification = { isVerified: true, verifiedAt: new Date(), attempts: 0 };
        expect(lead.verifyOtp('000000', matcherFor(lead))).toBe('no_code');
        lead.generateOtp(hasher.hash(lead.id, '999888'));
        expect(lead.verifyOtp('000000', matcherFor(lead))).toBe('invalid');
        expect(lead.verifyOtp('', matcherFor(lead))).toBe('invalid');
    });

    it('bloquea tras 5 intentos fallidos e impide emitir/verificar durante el bloqueo', () => {
        const lead = newLead();
        const now = new Date('2026-10-07T10:00:00Z');
        lead.generateOtp(hasher.hash(lead.id, '424242'), now);
        for (let i = 1; i < OTP_POLICY.maxAttempts; i++) {
            expect(lead.verifyOtp('000000', matcherFor(lead), now)).toBe('invalid');
            expect(lead.verification.attempts).toBe(i);
        }
        expect(lead.verifyOtp('000000', matcherFor(lead), now)).toBe('locked');
        // Ni siquiera el código correcto funciona durante el bloqueo.
        expect(lead.verifyOtp('424242', matcherFor(lead), now)).toBe('locked');
        expect(lead.generateOtp(hasher.hash(lead.id, '111111'), now)).toBe(false);

        const afterLock = new Date(now.getTime() + OTP_POLICY.lockMinutes * 60_000 + 1);
        expect(lead.generateOtp(hasher.hash(lead.id, '111111'), afterLock)).toBe(true);
        expect(lead.verifyOtp('111111', matcherFor(lead), afterLock)).toBe('verified');
    });
});

describe('RequestLeadAccess / VerifyLeadAccess', () => {
    it('no devuelve leadId al pedir OTP y guarda sólo el hash', async () => {
        const repo = new InMemoryLeadRepo();
        const otp = new FakeOtpService('135790');
        const res = await new RequestLeadAccess(repo, otp, hasher).execute(
            { name: 'Ana', email: 'ana@example.com', phone: '600' },
            { contactMethod: 'email', language: 'es' }
        );
        expect(res).toEqual({ outcome: 'sent' });
        expect((res as any).leadId).toBeUndefined();
        const stored = [...repo.leads.values()][0];
        expect(stored.verification.otpHash).toBeDefined();
        expect(JSON.stringify(stored.verification)).not.toContain('135790');
        expect(otp.sent[0].code).toBe('135790');
    });

    it('no sobrescribe datos ni consentimientos de un lead existente', async () => {
        const repo = new InMemoryLeadRepo();
        const existing = newLead('existing');
        await repo.save(existing);
        await new RequestLeadAccess(repo, new FakeOtpService(), hasher).execute(
            { name: 'Atacante', email: 'ana@example.com', phone: '999' },
            { contactMethod: 'email', language: 'es' },
            buildConsents({ privacyAccepted: true, marketingAccepted: true }, 'identity_form')
        );
        const after = await repo.findById('existing');
        expect(after!.personalInfo.name).toBe('Ana');
        expect(after!.consents).toHaveLength(0);
    });

    it('verifica por email + código y registra consentimientos sólo tras verificar', async () => {
        const repo = new InMemoryLeadRepo();
        await new RequestLeadAccess(repo, new FakeOtpService('246810'), hasher).execute(
            { name: 'Ana', email: 'ana@example.com', phone: '600' },
            { contactMethod: 'email', language: 'es' }
        );
        const verify = new VerifyLeadAccess(repo, hasher);
        const consents = buildConsents({ privacyAccepted: true, marketingAccepted: true }, 'identity_form');

        const bad = await verify.execute('ana@example.com', '000000', consents);
        expect(bad.success).toBe(false);
        expect(bad.leadId).toBeUndefined();

        const ok = await verify.execute('ana@example.com', '246810', consents);
        expect(ok.success).toBe(true);
        expect(ok.leadId).toBeDefined();
        const lead = await repo.findById(ok.leadId!);
        expect(lead!.hasMarketingConsent).toBe(true);

        const unknown = await verify.execute('nadie@example.com', '246810');
        expect(unknown).toEqual({ success: false, reason: 'not_found' });
    });
});
