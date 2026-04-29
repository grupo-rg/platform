/**
 * Fase 6.B — tests del builder puro `buildHeuristicFragmentPayload`.
 *
 * Invariantes:
 *   1. El tag de capítulo se emite en forma canónica `chapter:<NAME>` para
 *      que el retrieval del Swarm (Python) lo encuentre.
 *   2. `aiInferenceTrace.proposedUnitPrice` es el precio ORIGINAL de la IA,
 *      no el corregido.
 *   3. `humanCorrection.heuristicRule` incluye el motivo del dropdown (clave
 *      estable) y la nota libre si se aporta.
 *   4. `status='pending_review'` por defecto (un admin promociona a golden
 *      en una fase futura; el Swarm solo consumirá golden — Fase 6.C).
 *   5. `sourceType='internal_admin'` porque el captor es el editor admin.
 *   6. `timestamp` se emite como ISO string (compatible con Firestore +
 *      con el schema Python `HeuristicFragment.timestamp: datetime`).
 */
import { describe, it, expect } from 'vitest';

import { buildHeuristicFragmentPayload, CORRECTION_REASONS } from './heuristic-fragment-builder';

function baseInput() {
    return {
        budgetId: 'budget-abc',
        chapter: 'DEMOLICIONES',
        originalDescription: 'Demolición de alicatado en paredes de baño',
        originalQuantity: 20,
        originalUnit: 'm2',
        aiProposedPrice: 25.0,
        aiProposedCandidateId: 'DEM001',
        aiReasoning: 'Aplicado COAATMCA base',
        correctedPrice: 22.0,
        correctedUnit: 'm2',
        reason: 'volumen' as const,
        note: 'Descuento aplicado al superar 15 m²',
        correctedByUserId: 'user-xyz',
        timestamp: new Date('2026-04-22T12:00:00Z'),
    };
}

describe('CORRECTION_REASONS', () => {
    it('lists exactly the 5 canonical reasons from the plan', () => {
        expect(CORRECTION_REASONS.map((r) => r.value)).toEqual([
            'descuento_proveedor',
            'volumen',
            'error_ia',
            'calidad_premium',
            'otro',
        ]);
    });

    it('each reason has a user-facing label', () => {
        for (const r of CORRECTION_REASONS) {
            expect(r.label.length).toBeGreaterThan(0);
        }
    });
});

describe('buildHeuristicFragmentPayload', () => {
    it('emits chapter tag in canonical form `chapter:<NAME>`', () => {
        const payload = buildHeuristicFragmentPayload(baseInput());
        expect(payload.tags).toContain('chapter:DEMOLICIONES');
    });

    it('emits a tag for the correction reason to enable filtering', () => {
        const payload = buildHeuristicFragmentPayload(baseInput());
        expect(payload.tags).toContain('reason:volumen');
    });

    it('captures the AI price as proposed, NOT the corrected one', () => {
        const payload = buildHeuristicFragmentPayload(baseInput());
        expect(payload.aiInferenceTrace.proposedUnitPrice).toBe(25.0);
        expect(payload.aiInferenceTrace.proposedCandidateId).toBe('DEM001');
    });

    it('captures the corrected price + unit in humanCorrection', () => {
        const payload = buildHeuristicFragmentPayload(baseInput());
        expect(payload.humanCorrection.correctedUnitPrice).toBe(22.0);
        expect(payload.humanCorrection.correctedUnit).toBe('m2');
    });

    it('builds heuristicRule from reason + optional note', () => {
        const payload = buildHeuristicFragmentPayload(baseInput());
        expect(payload.humanCorrection.heuristicRule).toContain('volumen');
        expect(payload.humanCorrection.heuristicRule).toContain('Descuento aplicado al superar 15 m²');
    });

    it('heuristicRule uses just the reason label when note is empty', () => {
        const input = { ...baseInput(), note: '' };
        const payload = buildHeuristicFragmentPayload(input);
        expect(payload.humanCorrection.heuristicRule).toBe('volumen');
    });

    it('status defaults to pending_review (admin promotes to golden later)', () => {
        const payload = buildHeuristicFragmentPayload(baseInput());
        expect(payload.status).toBe('pending_review');
    });

    it('sourceType is internal_admin', () => {
        const payload = buildHeuristicFragmentPayload(baseInput());
        expect(payload.sourceType).toBe('internal_admin');
    });

    it('timestamp is emitted as ISO string', () => {
        const payload = buildHeuristicFragmentPayload(baseInput());
        expect(payload.timestamp).toBe('2026-04-22T12:00:00.000Z');
    });

    it('populates context.budgetId + originalDescription + originalQuantity + originalUnit', () => {
        const payload = buildHeuristicFragmentPayload(baseInput());
        expect(payload.context.budgetId).toBe('budget-abc');
        expect(payload.context.originalDescription).toBe('Demolición de alicatado en paredes de baño');
        expect(payload.context.originalQuantity).toBe(20);
        expect(payload.context.originalUnit).toBe('m2');
    });

    it('captures correctedByUserId when provided', () => {
        const payload = buildHeuristicFragmentPayload(baseInput());
        expect(payload.humanCorrection.correctedByUserId).toBe('user-xyz');
    });

    it('skips optional fields when undefined/null', () => {
        const input = {
            ...baseInput(),
            aiProposedCandidateId: undefined,
            aiReasoning: undefined,
            correctedByUserId: undefined,
            note: undefined,
        };
        const payload = buildHeuristicFragmentPayload(input);
        expect(payload.aiInferenceTrace.proposedCandidateId ?? null).toBeNull();
        expect(payload.aiInferenceTrace.aiReasoning ?? null).toBeNull();
        expect(payload.humanCorrection.correctedByUserId ?? null).toBeNull();
        expect(payload.humanCorrection.heuristicRule).toBe('volumen'); // no note appended
    });
});
