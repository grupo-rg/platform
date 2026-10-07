import { describe, it, expect } from 'vitest';
import { applyTemplatePlaceholders, type DocumentTemplate } from './document-template';
import { builtinTemplateFor, resolveDocumentTemplate } from './template-resolution';
import { parseInlineBold, parseListBody, parseTemplateBody } from './template-body';
import { DEFAULT_BUDGET_BLOCKS, DEFAULT_BUDGET_DISCLAIMER } from './default-budget-template';
import { computeDefaultFlagUpdates, DocumentTemplateService, type DocumentTemplateRepository } from '../application/document-template-service';

const tpl = (over: Partial<DocumentTemplate>): DocumentTemplate => ({
    id: 'x',
    name: 'X',
    kind: 'budget',
    isDefault: false,
    blocks: [{ id: 'b', title: 'T', body: 'B' }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
});

describe('applyTemplatePlaceholders', () => {
    it('sustituye los marcadores conocidos, tolerando espacios y mayúsculas', () => {
        expect(
            applyTemplatePlaceholders('{{empresa}} · {{ cliente }} · {{FECHA}} · {{total}} · {{validez_dias}}', {
                empresa: 'Grupo RG',
                cliente: 'Ana',
                fecha: '7 de octubre de 2026',
                total: '1.000,00 €',
                validez_dias: '15',
            }),
        ).toBe('Grupo RG · Ana · 7 de octubre de 2026 · 1.000,00 € · 15');
    });

    it('marcador conocido sin valor → vacío; desconocido → se deja literal', () => {
        expect(applyTemplatePlaceholders('Total: {{total}} {{desconocido}}', {})).toBe('Total:  {{desconocido}}');
    });
});

describe('resolveDocumentTemplate', () => {
    const assigned = tpl({ id: 'a', name: 'Asignada' });
    const defBudget = tpl({ id: 'db', name: 'Default budget', isDefault: true });
    const defAny = tpl({ id: 'da', name: 'Default any', kind: 'any', isDefault: true });
    const plOnly = tpl({ id: 'pl', name: 'Solo listas', kind: 'price_list' });

    it('prioriza la plantilla asignada', () => {
        const r = resolveDocumentTemplate([assigned, defBudget, defAny], 'budget', 'a');
        expect(r).toMatchObject({ source: 'assigned', templateId: 'a' });
    });

    it('ignora la asignada si no existe o es de otro tipo y cae a la predeterminada', () => {
        expect(resolveDocumentTemplate([defBudget], 'budget', 'borrada')).toMatchObject({ source: 'default', templateId: 'db' });
        expect(resolveDocumentTemplate([plOnly, defBudget], 'budget', 'pl')).toMatchObject({ templateId: 'db' });
    });

    it('predeterminada del tipo exacto antes que la de tipo any', () => {
        expect(resolveDocumentTemplate([defAny, defBudget], 'budget')).toMatchObject({ templateId: 'db' });
        expect(resolveDocumentTemplate([defAny, plOnly], 'price_list')).toMatchObject({ templateId: 'da' });
    });

    it('sin plantillas aplicables → constante en código', () => {
        const r = resolveDocumentTemplate([plOnly], 'budget');
        expect(r.source).toBe('builtin');
        expect(r.blocks).toEqual(DEFAULT_BUDGET_BLOCKS);
        expect(r.disclaimer).toBe(DEFAULT_BUDGET_DISCLAIMER);
        expect(resolveDocumentTemplate([], 'price_list').source).toBe('builtin');
    });

    it('la constante devuelta es una copia (mutarla no altera el default)', () => {
        const r = builtinTemplateFor('budget');
        r.blocks[0].title = 'mutado';
        expect(DEFAULT_BUDGET_BLOCKS[0].title).not.toBe('mutado');
    });
});

describe('parseTemplateBody', () => {
    it('párrafos separados por línea en blanco; líneas consecutivas = salto de línea', () => {
        const nodes = parseTemplateBody('Uno\nDos\n\nTres');
        expect(nodes).toHaveLength(2);
        expect(nodes[0]).toEqual({ kind: 'paragraph', lines: [[{ text: 'Uno', bold: false }], [{ text: 'Dos', bold: false }]] });
    });

    it('negrita en línea', () => {
        expect(parseInlineBold('Total **1 €**.')).toEqual([
            { text: 'Total ', bold: false },
            { text: '1 €', bold: true },
            { text: '.', bold: false },
        ]);
        expect(parseInlineBold('sin cerrar **x')).toEqual([{ text: 'sin cerrar **x', bold: false }]);
    });

    it('"✔ " y línea entera en negrita abren grupos con el texto que sigue', () => {
        const nodes = parseTemplateBody('✔ Punto\nDetalle\n\n**¿Pregunta?**\nRespuesta');
        expect(nodes.map((n) => n.kind)).toEqual(['check', 'heading']);
        const [check, heading] = nodes as any[];
        expect(check.title[0].text).toBe('✔ Punto');
        expect(check.children).toHaveLength(1);
        expect(heading.title).toEqual([{ text: '¿Pregunta?', bold: true }]);
        expect(heading.children[0].lines[0][0].text).toBe('Respuesta');
    });

    it('"- " es viñeta', () => {
        const nodes = parseTemplateBody('Intro\n- a\n- **b** c');
        expect(nodes.map((n) => n.kind)).toEqual(['paragraph', 'bullet', 'bullet']);
    });

    it('formato lista: una viñeta por línea no vacía, quitando prefijos', () => {
        const nodes = parseListBody('Sanitarios\n\n- Mobiliario\n• Pintura ');
        expect(nodes).toHaveLength(3);
        expect((nodes[1] as any).spans[0].text).toBe('Mobiliario');
        expect((nodes[2] as any).spans[0].text).toBe('Pintura');
    });

    it('la plantilla estándar del presupuesto produce la estructura de la maqueta anterior', () => {
        const blk4 = parseTemplateBody(DEFAULT_BUDGET_BLOCKS[3].body);
        expect(blk4.map((n) => n.kind)).toEqual(['check', 'check', 'check', 'check']);
        const blk6 = parseTemplateBody(DEFAULT_BUDGET_BLOCKS[5].body);
        expect(blk6.map((n) => n.kind)).toEqual(['heading', 'heading']);
        const blk2 = parseTemplateBody(DEFAULT_BUDGET_BLOCKS[1].body);
        expect(blk2).toHaveLength(2);
    });
});

describe('DocumentTemplateService — predeterminadas', () => {
    function fakeRepo(initial: DocumentTemplate[]): DocumentTemplateRepository & { rows: DocumentTemplate[] } {
        let seq = 0;
        const repo = {
            rows: [...initial],
            newId: () => `new${++seq}`,
            listAll: async () => repo.rows.map((r) => ({ ...r })),
            get: async (id: string) => repo.rows.find((r) => r.id === id) ?? null,
            save: async (t: DocumentTemplate) => {
                repo.rows = [...repo.rows.filter((r) => r.id !== t.id), t];
            },
            setDefaultFlags: async (updates: Array<{ id: string; isDefault: boolean }>) => {
                for (const u of updates) {
                    const r = repo.rows.find((x) => x.id === u.id);
                    if (r) r.isDefault = u.isDefault;
                }
            },
            delete: async (id: string) => {
                repo.rows = repo.rows.filter((r) => r.id !== id);
            },
        };
        return repo;
    }

    it('computeDefaultFlagUpdates deja una única predeterminada por tipo', () => {
        const rows = [tpl({ id: 'a', isDefault: true }), tpl({ id: 'b' }), tpl({ id: 'c', kind: 'any', isDefault: true })];
        expect(computeDefaultFlagUpdates(rows, 'b', 'budget')).toEqual([
            { id: 'a', isDefault: false },
            { id: 'b', isDefault: true },
        ]);
    });

    it('no permite borrar la predeterminada', async () => {
        const repo = fakeRepo([tpl({ id: 'a', isDefault: true })]);
        const svc = new DocumentTemplateService(repo);
        await expect(svc.delete('a')).rejects.toThrow(/predeterminada/);
        expect(repo.rows).toHaveLength(1);
    });

    it('sembrar la estándar la deja predeterminada solo si su tipo no tiene ninguna', async () => {
        const repo = fakeRepo([]);
        const svc = new DocumentTemplateService(repo);
        const first = await svc.seedFromBuiltin('budget', 'test');
        expect(first.isDefault).toBe(true);
        const second = await svc.seedFromBuiltin('budget', 'test');
        expect(second.isDefault).toBe(false);
        expect(repo.rows.filter((r) => r.isDefault)).toHaveLength(1);
    });

    it('duplicar crea una copia no predeterminada', async () => {
        const repo = fakeRepo([tpl({ id: 'a', name: 'Base', isDefault: true })]);
        const copy = await new DocumentTemplateService(repo).duplicate('a', 'test');
        expect(copy).toMatchObject({ name: 'Copia de Base', isDefault: false });
        expect(copy.id).not.toBe('a');
    });
});
