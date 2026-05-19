/**
 * Sprint 3 — S3-07 partial — tests del clasificador + action.
 *
 * Invariantes:
 *   1. `classifyCorrection` deriva el `correction_type` correcto a partir
 *      de `ai_proposed` + `human_chosen`.
 *   2. `mismatch` cuando los codes reales difieren.
 *   3. `no_match_then_match` cuando ai tenía placeholder y humano puso code real.
 *   4. `unit_fix` / `quantity_fix` / `price_fix` cuando el code coincide.
 *   5. La acción rechaza no-ops (todos los campos iguales) — no contamina
 *      el dataset RLHF.
 *   6. La acción rechaza inputs incompletos (sin budgetId, sin queryText).
 *
 * No tocamos Firestore: la acción se ejercita con mocks de `verifyAuth` y del
 * repo. El test del clasificador es puro y NO requiere mocks.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { classifyCorrection, CorrectionPair } from '@/backend/ai-training/domain/correction-pair';

// ---------- Helpers ----------

function aiBase() {
    return {
        code: 'EDM01',
        description: 'Demolición de tabique de ladrillo hueco',
        unitPrice: 25,
        matchConfidence: 0.82,
        unit: 'm2',
        quantity: 10,
    };
}
function humanBase() {
    return {
        code: 'EDM01',
        description: 'Demolición de tabique de ladrillo hueco',
        unitPrice: 25,
        unit: 'm2',
        quantity: 10,
    };
}

// ---------- classifyCorrection ----------

describe('classifyCorrection', () => {
    it('returns "mismatch" when human picks a different real code', () => {
        const ai = aiBase();
        const human = { ...humanBase(), code: 'EDM02' };
        expect(classifyCorrection(ai, human)).toBe('mismatch');
    });

    it('returns "no_match_then_match" when ai had a from_scratch placeholder and human picked a real code', () => {
        const ai = { ...aiBase(), code: 'from_scratch' };
        const human = { ...humanBase(), code: 'EDM07' };
        expect(classifyCorrection(ai, human)).toBe('no_match_then_match');
    });

    it('returns "no_match_then_match" when ai had GENERIC-EXPLICIT and human picked a real code', () => {
        const ai = { ...aiBase(), code: 'GENERIC-EXPLICIT' };
        const human = { ...humanBase(), code: 'EDM07' };
        expect(classifyCorrection(ai, human)).toBe('no_match_then_match');
    });

    it('returns "no_match_then_match" when ai had empty code and human picked a real code', () => {
        const ai = { ...aiBase(), code: '' };
        const human = { ...humanBase(), code: 'EDM07' };
        expect(classifyCorrection(ai, human)).toBe('no_match_then_match');
    });

    it('returns "unit_fix" when only the unit changed', () => {
        const ai = aiBase();
        const human = { ...humanBase(), unit: 'm3' };
        expect(classifyCorrection(ai, human)).toBe('unit_fix');
    });

    it('returns "quantity_fix" when only the quantity changed', () => {
        const ai = aiBase();
        const human = { ...humanBase(), quantity: 12 };
        expect(classifyCorrection(ai, human)).toBe('quantity_fix');
    });

    it('returns "price_fix" when only the unit price changed', () => {
        const ai = aiBase();
        const human = { ...humanBase(), unitPrice: 27.5 };
        expect(classifyCorrection(ai, human)).toBe('price_fix');
    });

    it('prioritises "mismatch" over price/unit/quantity fixes when code changes', () => {
        const ai = aiBase();
        const human = {
            ...humanBase(),
            code: 'EDM02',
            unit: 'm3',
            quantity: 11,
            unitPrice: 30,
        };
        expect(classifyCorrection(ai, human)).toBe('mismatch');
    });

    it('falls back to "price_fix" when nothing meaningful changed', () => {
        // Defensive case — caller should not invoke when isNoOp, but the
        // classifier still must return a stable label.
        const ai = aiBase();
        const human = humanBase();
        expect(classifyCorrection(ai, human)).toBe('price_fix');
    });

    it('handles unit case-insensitively (m2 == M2)', () => {
        const ai = aiBase();
        const human = { ...humanBase(), unit: 'M2' };
        expect(classifyCorrection(ai, human)).toBe('price_fix'); // unit semantically equal → not unit_fix
    });
});

// ---------- CorrectionPair domain entity ----------

describe('CorrectionPair.create', () => {
    it('derives correction_type from ai/human when not provided', () => {
        const pair = CorrectionPair.create({
            id: 'cp-1',
            budgetId: 'budget-1',
            partidaCode: 'EDM01',
            query_text: 'Demolición de tabique',
            ai_proposed: aiBase(),
            human_chosen: { ...humanBase(), code: 'EDM02' },
            corrected_by: 'user-x',
        });
        expect(pair.correctionType).toBe('mismatch');
    });

    it('persists toMap with corrected_at as ISO string', () => {
        const ts = new Date('2026-05-19T12:00:00.000Z');
        const pair = CorrectionPair.create({
            id: 'cp-2',
            budgetId: 'budget-2',
            partidaCode: 'EDM01',
            query_text: 'q',
            ai_proposed: aiBase(),
            human_chosen: { ...humanBase(), unitPrice: 30 },
            corrected_by: 'user-x',
            corrected_at: ts,
        });
        const map = pair.toMap();
        expect(map.corrected_at).toBe('2026-05-19T12:00:00.000Z');
        expect(map.correction_type).toBe('price_fix');
    });

    it('rejects empty query_text', () => {
        expect(() =>
            CorrectionPair.create({
                id: 'cp-3',
                budgetId: 'b',
                partidaCode: 'c',
                query_text: '',
                ai_proposed: aiBase(),
                human_chosen: humanBase(),
                corrected_by: 'u',
            }),
        ).toThrow(/query_text/);
    });

    it('rejects missing corrected_by', () => {
        expect(() =>
            CorrectionPair.create({
                id: 'cp-4',
                budgetId: 'b',
                partidaCode: 'c',
                query_text: 'q',
                ai_proposed: aiBase(),
                human_chosen: humanBase(),
                corrected_by: '',
            }),
        ).toThrow(/corrected_by/);
    });

    it('strips unit/quantity from ai_proposed when persisted (schema canonical)', () => {
        const pair = CorrectionPair.create({
            id: 'cp-5',
            budgetId: 'b',
            partidaCode: 'c',
            query_text: 'q',
            ai_proposed: aiBase(),
            human_chosen: { ...humanBase(), unit: 'm3' },
            corrected_by: 'u',
        });
        const map = pair.toMap();
        expect(map.ai_proposed).toEqual({
            code: 'EDM01',
            description: 'Demolición de tabique de ladrillo hueco',
            unitPrice: 25,
            matchConfidence: 0.82,
        });
        // unit IS persisted on human_chosen because we use it to detect unit_fix.
        expect(map.human_chosen.unit).toBe('m3');
    });
});

// ---------- logCorrectionPairAction (mocked) ----------

vi.mock('@/backend/auth/auth.middleware', () => ({
    verifyAuth: vi.fn(),
}));
vi.mock('@/backend/ai-training/infrastructure/firestore-correction-pair-repository', () => {
    const save = vi.fn(async () => undefined);
    class FirestoreCorrectionPairRepository {
        save = save;
    }
    return {
        FirestoreCorrectionPairRepository,
        __saveMock: save,
    } as any;
});

import { logCorrectionPairAction } from './log-correction-pair.action';
import { verifyAuth } from '@/backend/auth/auth.middleware';
import * as repoModule from '@/backend/ai-training/infrastructure/firestore-correction-pair-repository';

describe('logCorrectionPairAction', () => {
    beforeEach(() => {
        (verifyAuth as any).mockReset();
        (verifyAuth as any).mockResolvedValue({
            userId: 'user-123',
            email: 'a@b.com',
            role: 'user',
            claims: {},
        });
        const saveMock = (repoModule as any).__saveMock;
        if (saveMock?.mockReset) saveMock.mockReset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns unauthenticated when verifyAuth returns null', async () => {
        (verifyAuth as any).mockResolvedValueOnce(null);
        const res = await logCorrectionPairAction({
            budgetId: 'b',
            partidaCode: 'c',
            queryText: 'q',
            aiProposed: aiBase(),
            humanChosen: { ...humanBase(), code: 'EDM02' },
        });
        expect(res.success).toBe(false);
        expect(res.error).toBe('unauthenticated');
    });

    it('rejects when budgetId is missing', async () => {
        const res = await logCorrectionPairAction({
            budgetId: '',
            partidaCode: 'c',
            queryText: 'q',
            aiProposed: aiBase(),
            humanChosen: humanBase(),
        });
        expect(res.success).toBe(false);
        expect(res.error).toBe('missing_budget_or_partida');
    });

    it('rejects when queryText is empty', async () => {
        const res = await logCorrectionPairAction({
            budgetId: 'b',
            partidaCode: 'c',
            queryText: '   ',
            aiProposed: aiBase(),
            humanChosen: { ...humanBase(), code: 'EDM02' },
        });
        expect(res.success).toBe(false);
        expect(res.error).toBe('missing_query_text');
    });

    it('returns noop when ai and human are equivalent', async () => {
        const res = await logCorrectionPairAction({
            budgetId: 'b',
            partidaCode: 'c',
            queryText: 'q',
            aiProposed: aiBase(),
            humanChosen: humanBase(),
        });
        expect(res.success).toBe(true);
        expect(res.error).toBe('noop');
    });

    it('persists a mismatch correction and returns correction_type=mismatch', async () => {
        const res = await logCorrectionPairAction({
            budgetId: 'b',
            partidaCode: 'EDM01',
            queryText: 'Demolición de tabique',
            aiProposed: aiBase(),
            humanChosen: { ...humanBase(), code: 'EDM02' },
        });
        expect(res.success).toBe(true);
        expect(res.correctionType).toBe('mismatch');
        expect(typeof res.id).toBe('string');
        const saveMock = (repoModule as any).__saveMock;
        expect(saveMock).toHaveBeenCalledTimes(1);
    });

    it('persists a price_fix when only unitPrice changes', async () => {
        const res = await logCorrectionPairAction({
            budgetId: 'b',
            partidaCode: 'EDM01',
            queryText: 'q',
            aiProposed: aiBase(),
            humanChosen: { ...humanBase(), unitPrice: 30 },
        });
        expect(res.success).toBe(true);
        expect(res.correctionType).toBe('price_fix');
    });

    it('persists a no_match_then_match when ai had placeholder code', async () => {
        const res = await logCorrectionPairAction({
            budgetId: 'b',
            partidaCode: 'EDM07',
            queryText: 'Demolición de tabique',
            aiProposed: { ...aiBase(), code: 'from_scratch' },
            humanChosen: { ...humanBase(), code: 'EDM07' },
        });
        expect(res.success).toBe(true);
        expect(res.correctionType).toBe('no_match_then_match');
    });

    it('persists unit_fix when only unit changes', async () => {
        const res = await logCorrectionPairAction({
            budgetId: 'b',
            partidaCode: 'EDM01',
            queryText: 'q',
            aiProposed: aiBase(),
            humanChosen: { ...humanBase(), unit: 'm3' },
        });
        expect(res.success).toBe(true);
        expect(res.correctionType).toBe('unit_fix');
    });

    it('persists quantity_fix when only quantity changes', async () => {
        const res = await logCorrectionPairAction({
            budgetId: 'b',
            partidaCode: 'EDM01',
            queryText: 'q',
            aiProposed: aiBase(),
            humanChosen: { ...humanBase(), quantity: 12 },
        });
        expect(res.success).toBe(true);
        expect(res.correctionType).toBe('quantity_fix');
    });
});
