'use server';

import { FirestorePriceBookRepository } from '@/backend/price-book/infrastructure/firestore-price-book-repository';
import { PriceBookItem, PriceBookComponent } from '@/backend/price-book/domain/price-book-item';
import { ai, embeddingModel } from '@/backend/ai/shared/config/genkit.config';
import { stripExplicitMaterialTag } from '@/lib/budget/explicit-material';

const PRICE_BOOK_YEAR = 2025;

interface SaveFromScratchInput {
    budgetId: string;
    /** La partida (shape BudgetPartida: description, unit, unitPrice, breakdown, ai_resolution…). */
    partida: any;
    /** Texto editable de la fila (originalTask); preferido sobre description si existe. */
    originalTask?: string;
    /** Capítulo (en el editor viaja fuera de `partida`, en el item legacy). */
    chapter?: string;
    userId?: string;
}

/** Palabras clave para el re-ranking híbrido (keyword boost). */
function buildKeywords(description: string): string[] {
    const stop = new Set(['de', 'la', 'el', 'los', 'las', 'con', 'para', 'por', 'del', 'una', 'uno', 'y', 'en', 'a']);
    const words = description.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/)
        .filter(w => w.length > 3 && !stop.has(w));
    return Array.from(new Set(words)).slice(0, 12);
}

/**
 * Guarda una partida generada por IA (from_scratch) en el libro de precios del
 * constructor, ETIQUETADA como `source: 'ai_generated'`. Entra en el RAG (con
 * embedding 768) para que futuros presupuestos puedan reutilizarla (match 1:1).
 *
 * Guarda los precios RAW (PEM, sin markup GG+BI) para respetar la convención del
 * catálogo — el markup se aplica después en la generación/editor. doc-id
 * determinista → re-guardar sobreescribe (idempotente), sin duplicados.
 */
export async function saveFromScratchToPriceBookAction(input: SaveFromScratchInput) {
    try {
        const { budgetId, partida, originalTask, chapter: chapterInput, userId } = input;
        if (!partida) return { success: false, error: 'Falta la partida' };

        const rawDescription = originalTask || partida.description || '';
        const description = stripExplicitMaterialTag(rawDescription).trim();
        if (!description) return { success: false, error: 'La partida no tiene descripción' };

        const unit = partida.unit || 'ud';
        const chapter = chapterInput || partida.original_item?.chapter || partida.chapter || undefined;

        // Descompuesto → PriceBookComponent[]. Preferimos `price`/`unitPrice` (que el
        // editor almacena YA en RAW, sin markup) sobre `rawPrice` (snapshot que no se
        // actualiza al editar), para que lo guardado refleje las ediciones del sheet.
        const srcBreakdown: any[] = Array.isArray(partida.breakdown) ? partida.breakdown : [];
        const compPrice = (b: any) => Number(b.price ?? b.unitPrice ?? b.rawPrice ?? 0);
        const compQty = (b: any) => Number(b.yield ?? b.quantity ?? 1);
        const breakdown: PriceBookComponent[] = srcBreakdown.map((b: any) => ({
            code: b.code || undefined,
            description: b.concept || b.description || '',
            unit: b.unit || undefined,
            quantity: compQty(b),
            price: compPrice(b),
            is_variable: b.is_variable ?? (b.type === 'MATERIAL'),
        } as PriceBookComponent));

        // Precio unitario RAW = suma del descompuesto (refleja ediciones); si no hay
        // descompuesto, caemos al snapshot del pricer o al unitPrice.
        const bdSum = srcBreakdown.reduce((acc: number, b: any) => acc + compPrice(b) * compQty(b), 0);
        const rawUnitPrice = bdSum > 0
            ? Math.round(bdSum * 100) / 100
            : Number(
                partida.ai_resolution?.calculated_unit_price_raw
                ?? partida.aiResolution?.calculated_unit_price_raw
                ?? partida.unitPrice
                ?? 0
            );
        if (!rawUnitPrice || rawUnitPrice <= 0) {
            return { success: false, error: 'La partida no tiene un precio válido para guardar' };
        }

        // Subtotales por tipo (raw) para priceLabor/priceMaterial.
        const sumByType = (type: string) => srcBreakdown
            .filter((b: any) => b.type === type)
            .reduce((acc: number, b: any) => acc + compPrice(b) * compQty(b), 0);
        const priceLabor = Math.round(sumByType('LABOR') * 100) / 100 || undefined;
        const priceMaterial = Math.round(sumByType('MATERIAL') * 100) / 100 || undefined;

        // Código visible etiquetado + doc-id determinista (idempotente, sin colisión).
        const shortBudget = String(budgetId || 'nobudget').replace(/-/g, '').slice(0, 8);
        const origCode = String(partida.code || 'NL').replace(/[^\w-]/g, '');
        const code = `IA-${shortBudget}-${origCode}`;

        // Embedding 768 (Vertex) desde la descripción limpia → indexable en el RAG.
        let embedding: number[] | undefined;
        try {
            const embeddingResult = await ai.embed({
                embedder: embeddingModel,
                content: description,
                options: { outputDimensionality: 768 },
            });
            embedding = Array.isArray(embeddingResult)
                ? embeddingResult[0]?.embedding
                : (embeddingResult as any).embedding;
        } catch (e: any) {
            console.error('[saveFromScratch] embedding falló:', e?.message);
            return { success: false, error: 'No se pudo generar el índice semántico (embedding). Inténtalo de nuevo.' };
        }
        if (!embedding || embedding.length !== 768) {
            return { success: false, error: 'Embedding inválido (dimensión != 768)' };
        }

        const item: PriceBookItem = {
            code,
            description,
            unit,
            priceTotal: Math.round(rawUnitPrice * 100) / 100,
            priceLabor,
            priceMaterial,
            year: PRICE_BOOK_YEAR,
            // Forma canónica del catálogo para que la partida entre en el índice
            // BM25 híbrido del pipeline NL→budget (`list_all_items` filtra
            // `kind=='item'` y luego `PriceBookItemEntry(**data)` exige `unit_raw`
            // y `chapter`). Sin esto solo la reutilizaba el path vectorial legacy.
            kind: 'item',
            unit_raw: unit,
            unit_normalized: unit,
            chapter: chapter || 'Sin Capítulo',
            searchKeywords: buildKeywords(description),
            breakdown: breakdown.length > 0 ? breakdown : undefined,
            embedding,
            createdAt: new Date(),
            // Etiquetado / procedencia:
            source: 'ai_generated',
            matchKind: 'from_scratch',
            originBudgetId: budgetId,
            originPartidaCode: partida.code || undefined,
            savedByUserId: userId || undefined,
        };

        const repo = new FirestorePriceBookRepository();
        await repo.saveBatch([item]);

        return { success: true, code, docId: `${PRICE_BOOK_YEAR}_${code.replace(/\./g, '_')}` };
    } catch (error: any) {
        console.error('Error saving from-scratch partida to price book:', error);
        return { success: false, error: error.message };
    }
}
