'use server';

import { extractionFlow } from '@/backend/ai/private-core/flows/budget/extraction.flow';
import { priceBookRetrieverTool } from '@/backend/ai/private-core/tools/price-book-retriever.tool';
import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';
import { EditableBudgetLineItem } from '@/types/budget-editor';
import { v4 as uuidv4 } from 'uuid';

export async function smartAddAction(input: string, leadId?: string): Promise<{ success: boolean; items?: EditableBudgetLineItem[]; error?: string }> {
    try {
        if (!input || input.trim().length === 0) {
            return { success: false, error: "Input cannot be empty" };
        }

        if (leadId) {
            const leadRepo = new FirestoreLeadRepository();
            const leadDoc = await leadRepo.findById(leadId);
            if (leadDoc && leadDoc.demoPdfsDownloaded > 0) {
                return { success: false, error: "Acción no permitida: Has superado el límite de operaciones de IA en esta demo tras descargar el PDF." };
            }
        }

        console.log(`[SmartAdd] Processing: "${input}"`);

        // 1. Extract Intents/Subtasks
        const extractionResult = await extractionFlow({ userRequest: input });

        if (!extractionResult?.subtasks || extractionResult.subtasks.length === 0) {
            return { success: false, error: "Could not understand the request." };
        }

        const items: EditableBudgetLineItem[] = [];

        // 2. Process each subtask (Parallel)
        await Promise.all(extractionResult.subtasks.map(async (task, index) => {
            let bestMatch = null;

            try {
                // Try Price Book Search
                const searchResult = await priceBookRetrieverTool({ query: task.searchQuery, limit: 1, year: 2025 });
                bestMatch = searchResult.items && searchResult.items.length > 0 ? searchResult.items[0] : null;

                // Validation: Keyword Check
                if (bestMatch) {
                    const queryWords = task.searchQuery.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/\s+/).filter((w: string) => w.length > 3);
                    const descNormalized = bestMatch.description.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                    const hasMatch = queryWords.some((w: string) => descNormalized.includes(w));

                    if (!hasMatch && queryWords.length > 0) {
                        console.log(`[SmartAdd] Rejecting weak match "${bestMatch.code}" for "${task.searchQuery}"`);
                        bestMatch = null;
                    }
                }
            } catch (err) {
                console.error(`[SmartAdd] Error searching price book for "${task.searchQuery}":`, err);
            }

            const quantity = task.quantity || 1;
            const unit = task.unit || 'ud';

            if (bestMatch) {
                // Heuristic type inference
                let inferredType: 'PARTIDA' | 'MATERIAL' = 'PARTIDA';
                if ((bestMatch.priceMaterial || 0) > 0 && (bestMatch.priceLabor || 0) === 0 && (!bestMatch.breakdown || bestMatch.breakdown.length === 0)) {
                    inferredType = 'MATERIAL';
                }

                items.push({
                    id: uuidv4(),
                    order: index, // Will be reordered by frontend
                    originalTask: `${task.searchQuery}`,
                    isDirty: true, // Mark as dirty since it's new
                    isEditing: false,
                    found: true,
                    chapter: 'Nuevas Partidas', // Default chapter, frontend can change
                    type: inferredType,
                    item: {
                        code: bestMatch.code,
                        description: bestMatch.description,
                        unit: bestMatch.unit,
                        quantity: quantity,
                        unitPrice: bestMatch.priceTotal,
                        totalPrice: bestMatch.priceTotal * quantity,
                        matchConfidence: 90
                    },
                    originalState: {
                        unitPrice: bestMatch.priceTotal,
                        quantity: quantity,
                        description: bestMatch.description,
                        unit: bestMatch.unit
                    }
                });
            } else {
                // Return generic item
                items.push({
                    id: uuidv4(),
                    order: index,
                    originalTask: task.searchQuery,
                    isDirty: true,
                    isEditing: false,
                    found: false,
                    chapter: 'Nuevas Partidas',
                    item: {
                        code: `NEW-${Date.now()}-${index}`,
                        description: task.searchQuery, // Use query as description if nothing found
                        unit: unit,
                        quantity: quantity,
                        unitPrice: 0,
                        totalPrice: 0
                    }
                });
            }
        }));

        return { success: true, items };

    } catch (error: any) {
        console.error("Smart Add Error:", error);
        return { success: false, error: error.message || "An error occurred." };
    }
}
