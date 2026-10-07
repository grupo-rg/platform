import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/backend/shared/infrastructure/messaging/resend-email.service', () => ({
    ResendEmailService: { send: vi.fn(async () => ({ id: 'x' })) },
}));

import { renderAdminLeadEmail } from './notify-admin-on-lead-created.usecase';
import { escapeHtml, safeHttpUrl } from '@/backend/shared/security/html-escape';

const XSS = '<img src=x onerror=alert(1)>"\'&';

describe('escapeHtml', () => {
    it('escapa los 5 caracteres peligrosos', () => {
        expect(escapeHtml(XSS)).toBe('&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;');
        expect(escapeHtml(undefined)).toBe('');
        expect(escapeHtml(42)).toBe('42');
    });
    it('safeHttpUrl sólo deja pasar http(s)', () => {
        expect(safeHttpUrl('javascript:alert(1)')).toBe('');
        expect(safeHttpUrl('https://a.example/b')).toBe('https://a.example/b');
    });
});

describe('renderAdminLeadEmail', () => {
    it('escapa TODOS los campos del lead', () => {
        const { html } = renderAdminLeadEmail({
            leadId: 'lead-1',
            name: XSS,
            email: `${XSS}@x.com`,
            phone: XSS,
            address: XSS,
            source: 'quick_form',
            decision: 'qualified',
            score: 80,
            intake: {
                projectType: XSS as any,
                description: XSS,
                source: 'quick_form',
                city: XSS,
                postalCode: XSS,
                timeline: XSS as any,
                qualityLevel: XSS as any,
                imageUrls: ['gs://bucket/lead_uploads/a/00000000-0000-0000-0000-000000000000.jpg'],
                submittedAt: new Date(),
            },
            detailUrl: 'https://x.example/dashboard/leads/lead-1',
        });
        expect(html).not.toContain('<img src=x');
        expect(html).not.toContain('onerror=alert(1)>');
        expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
        // Los adjuntos privados no se enlazan en el email.
        expect(html).not.toContain('gs://');
        expect(html).toContain('Archivos adjuntos:</strong> 1');
    });

    it('marca las solicitudes con identidad no verificada', () => {
        const { html } = renderAdminLeadEmail({
            leadId: 'lead-1', name: 'Ana', email: 'ana@example.com', source: 'chat_public',
            decision: 'review_required', score: 50, intake: null, identityUnverified: true,
            detailUrl: 'https://x.example',
        });
        expect(html).toContain('Identidad NO verificada');
    });
});
