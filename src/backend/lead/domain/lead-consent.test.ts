import { describe, it, expect } from 'vitest';
import {
    buildConsents,
    mergeConsents,
    hasMarketingConsent,
    hasPrivacyConsent,
    latestConsent,
    CONSENT_TEXT_VERSIONS,
} from './lead-consent';
import { Lead } from './lead';
import { sniffFileType, parseLeadUploadRef, sanitizeOwnerKey } from '../infrastructure/lead-upload-ref';

describe('consentimientos RGPD', () => {
    it('buildConsents registra privacidad y marketing por separado con versión del servidor', () => {
        const now = new Date('2026-10-07T10:00:00Z');
        const list = buildConsents({ privacyAccepted: true }, 'quick_form', '1.2.3.4', now);
        expect(list).toHaveLength(2);
        expect(list[0]).toMatchObject({ type: 'privacy', granted: true, source: 'quick_form', ip: '1.2.3.4', textVersion: CONSENT_TEXT_VERSIONS.privacy });
        // Marketing NO se presupone: si no se marca, queda registrado como false.
        expect(list[1]).toMatchObject({ type: 'marketing', granted: false });
    });

    it('hasMarketingConsent sólo es true si el último registro de marketing es granted', () => {
        const t1 = new Date('2026-10-01');
        const t2 = new Date('2026-10-05');
        expect(hasMarketingConsent(null)).toBe(false);
        expect(hasMarketingConsent({ consents: [] })).toBe(false);
        const granted = buildConsents({ privacyAccepted: true, marketingAccepted: true }, 'chat_public', undefined, t1);
        expect(hasMarketingConsent({ consents: granted })).toBe(true);
        const revoked = mergeConsents(granted, buildConsents({ privacyAccepted: true, marketingAccepted: false }, 'admin', undefined, t2));
        expect(hasMarketingConsent({ consents: revoked })).toBe(false);
        expect(hasPrivacyConsent({ consents: revoked })).toBe(true);
        expect(latestConsent(revoked, 'marketing')!.source).toBe('admin');
    });

    it('mergeConsents no duplica envíos idénticos (log de cambios)', () => {
        const a = buildConsents({ privacyAccepted: true, marketingAccepted: false }, 'quick_form');
        const b = buildConsents({ privacyAccepted: true, marketingAccepted: false }, 'detailed_form');
        expect(mergeConsents(a, b)).toHaveLength(2);
        const c = buildConsents({ privacyAccepted: true, marketingAccepted: true }, 'detailed_form');
        expect(mergeConsents(a, c)).toHaveLength(3);
    });

    it('Lead.recordConsents y el getter hasMarketingConsent', () => {
        const lead = Lead.create('l1', { name: 'A', email: 'a@b.co', phone: '' }, { contactMethod: 'email', language: 'es' });
        expect(lead.hasMarketingConsent).toBe(false);
        lead.recordConsents(buildConsents({ privacyAccepted: true, marketingAccepted: true }, 'identity_form'));
        expect(lead.hasMarketingConsent).toBe(true);
        expect(lead.consents).toHaveLength(2);
    });
});

describe('adjuntos privados de leads', () => {
    it('detecta el tipo real por magic bytes', () => {
        const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
        const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0, 0, 0, 0, 0, 0]);
        const html = new TextEncoder().encode('<html><script>alert(1)</script></html>');
        expect(sniffFileType(jpg)?.mime).toBe('image/jpeg');
        expect(sniffFileType(pdf)?.kind).toBe('pdf');
        expect(sniffFileType(html)).toBeNull();
    });

    it('sólo acepta referencias gs:// dentro de lead_uploads con uuid', () => {
        const ok = 'gs://my-bucket.appspot.com/lead_uploads/lead-1/123e4567-e89b-12d3-a456-426614174000.jpg';
        expect(parseLeadUploadRef(ok)).toEqual({ bucket: 'my-bucket.appspot.com', objectPath: 'lead_uploads/lead-1/123e4567-e89b-12d3-a456-426614174000.jpg' });
        expect(parseLeadUploadRef('gs://my-bucket/public_uploads/x.jpg')).toBeNull();
        expect(parseLeadUploadRef('gs://my-bucket/lead_uploads/../admin/x.jpg')).toBeNull();
        expect(parseLeadUploadRef('https://evil.example/x.jpg')).toBeNull();
    });

    it('sanea el segmento owner (sin emails ni rutas)', () => {
        expect(sanitizeOwnerKey('ana@example.com/../x')).toBe('anaexamplecomx');
        expect(sanitizeOwnerKey('')).toBe('anon');
    });
});
