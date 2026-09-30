import { ai, geminiFlash } from '@/backend/ai/core/config/genkit.config';
import { z } from 'genkit';
import { BudgetPartida, BudgetBreakdownComponent } from '@/backend/budget/domain/budget';
import '@/backend/ai/private/flows/budget/extraction.flow'; // Register 'SubtaskExtractionSchema' for Dotprompt

// Input Schema: A Pair of Generic Partida + Specific Material
// OR just a description to decompose
const ConstructionAnalystInputSchema = z.object({
    description: z.string().optional(), // High level intent
    partida: z.custom<BudgetPartida>().optional(),
    material: z.object({
        sku: z.string(),
        name: z.string(),
        price: z.number(),
        merchant: z.string().optional(),
        unit: z.string(),
        url: z.string().optional(),
    }).optional(),
    leadId: z.string().optional(), // For notifications
    projectContext: z.string().optional() // E.g. "4th floor with elevator"
});

// Output Schema: List of Items (Assembly)
const ConstructionAnalystOutputSchema = z.object({
    items: z.array(z.custom<BudgetPartida>()),
});

export const constructionAnalystAgent = ai.defineFlow(
    {
        name: 'constructionAnalystAgent',
        inputSchema: ConstructionAnalystInputSchema,
        outputSchema: ConstructionAnalystOutputSchema,
    },
    async (input) => {
        const { partida, material, description } = input;

        // MODE A: Hybrid Optimization (Single Item -> Optimized Single Item)
        if (partida && material) {
            console.log(`[ConstructionAnalyst] Analyzing Partida: ${partida.code} with Material: ${material.name}`);

            const originalPrice = partida.unitPrice;
            const assumedLaborCost = originalPrice * 0.60;
            // const assumedGenericMaterialCost = originalPrice * 0.40;

            // 2. Define Waste Factor based on material type (Heuristic)
            let wasteFactor = 0.05; // 5% default
            if (material.name.toLowerCase().includes('cerámica') || material.name.toLowerCase().includes('porcelánico') || material.name.toLowerCase().includes('azulejo')) {
                wasteFactor = 0.10; // 10% for tiles (cuts/breakage)
            } else if (material.name.toLowerCase().includes('parquet') || material.name.toLowerCase().includes('laminado')) {
                wasteFactor = 0.08; // 8% for wood floors
            }

            // 3. Calculate New Material Cost (Real Price + Waste)
            const yieldFactor = 1.0;
            const newMaterialTotal = material.price * yieldFactor * (1 + wasteFactor);

            // 4. Construct New Cost Breakdown
            const breakdown: BudgetBreakdownComponent[] = [
                {
                    concept: 'Mano de Obra y Medios Auxiliares (Base)',
                    type: 'LABOR',
                    price: assumedLaborCost,
                    yield: 1,
                    waste: 0,
                    total: assumedLaborCost,
                    isSubstituted: false
                },
                {
                    concept: `Material: ${material.name} (${material.sku})`,
                    type: 'MATERIAL',
                    price: material.price,
                    yield: yieldFactor,
                    waste: wasteFactor,
                    total: newMaterialTotal,
                    isSubstituted: true
                }
            ];

            // 5. Calculate Final Unit Price
            const newUnitPrice = assumedLaborCost + newMaterialTotal;

            // 6. Update Partida
            const adjustedPartida: BudgetPartida = {
                ...partida,
                unitPrice: parseFloat(newUnitPrice.toFixed(2)) || 0,
                totalPrice: parseFloat((newUnitPrice * partida.quantity).toFixed(2)) || 0,
                isRealCost: true,
                breakdown: breakdown,
                relatedMaterial: {
                    sku: material.sku,
                    name: material.name,
                    merchant: material.merchant || 'Unknown',
                    unitPrice: material.price || 0,
                    url: material.url || undefined
                },
                note: `Precio recalculado con material específico: ${material.name}. Incluye ${(wasteFactor * 100).toFixed(0)}% de merma.`
            };

            return {
                items: [adjustedPartida]
            };
        }

        // MODE B: Decomposition (Description -> List of Items)
        if (description) {
            console.log(`[ConstructionAnalyst] Decomposing description: "${description}"`);

            const { emitGenerationEvent } = await import('@/backend/budget/events/budget-generation.emitter');
            // Use explicit leadId if provided, otherwise check context
            const targetLeadId = input.leadId || (await import('@/backend/ai/core/context/genkit.context')).getCurrentContext()?.userId;

            if (targetLeadId) {
                emitGenerationEvent(targetLeadId, 'decomposition_start', { description });
            }

            // 1. LLM Decomposition (via Dotprompt)
            /*
             * Uses 'subtask-extraction.prompt' which handles:
             * - Complex specific decomposition (Reforma Integral)
             * - Price Book compatible Search Queries
             */
            console.log(`[ConstructionAnalyst] Calling subtask-extraction prompt...`);

            // Generate using the prompt file
            const extractionPrompt = ai.prompt('subtask-extraction');
            const result = await extractionPrompt({
                userRequest: description
            });

            if (!result.output || !result.output.subtasks) {
                throw new Error("Failed to decompose description via prompt");
            }

            const decomposedItems = result.output.subtasks.map((s: any) => ({
                description: s.searchQuery, // Map searchQuery to description for the loop
                quantity: s.quantity,
                unit: s.unit,
                reasoning: s.reasoning
            }));

            console.log(`[ConstructionAnalyst] Decomposition yielded ${decomposedItems.length} items. Starting Pricing Loop...`);

            // 2. Recursive Pricing Loop (RAG)
            // Dynamically import infrastructure to avoid top-level side effects (and because this agent is pure business logic usually)

            // Imports should match actual file existence
            const { FirestorePriceBookRepository } = await import('@/backend/price-book/infrastructure/firestore-price-book-repository');
            const { RestApiVectorizerAdapter } = await import('@/backend/price-book/infrastructure/ai/rest-api-vectorizer.adapter');
            // ai is already available from top-level scope

            // Instantiate Repos
            const priceBookRepo = new FirestorePriceBookRepository();
            const vectorizer = new RestApiVectorizerAdapter();

            const aggregatedItems = new Map<string, BudgetPartida>();

            for (const [index, item] of decomposedItems.entries()) {
                console.log(`[ConstructionAnalyst] Processing Item ${index + 1}/${decomposedItems.length}: "${item.description}"`);

                if (targetLeadId) {
                    emitGenerationEvent(targetLeadId, 'item_resolving', {
                        description: item.description,
                        current: index + 1,
                        total: decomposedItems.length
                    });
                }

                // A. Multi-Query Generation (Expansion)
                // We ask the LLM to generate 3 search variations
                // This is a "mini-chain" inside the loop. For speed, we could use a smaller model or just heuristics,
                // but let's use the main model for quality.
                const queryVariations = [item.description]; // Always include original

                // Heuristic variations (faster than LLM for now)
                if (item.description.toLowerCase().includes('picar')) queryVariations.push(item.description.replace(/picar/i, 'demolición de'));
                if (item.description.toLowerCase().includes('retirada')) queryVariations.push(item.description.replace(/retirada/i, 'carga manual de'));
                if (item.description.toLowerCase().includes('desmontaje')) queryVariations.push(item.description.replace(/desmontaje/i, 'demolición de'));

                // Deduplicate
                const distinctQueries = [...new Set(queryVariations)];
                console.log(`   -> Variations: ${JSON.stringify(distinctQueries)}`);

                // B. Loose Vector Search (Gather Candidates)
                // We search for ALL variations with a LOWER threshold
                const SEARCH_THRESHOLD = 0.65; // Loose net
                let allCandidates: any[] = [];

                for (const query of distinctQueries) {
                    try {
                        const embedding = await vectorizer.embedText(query);
                        const results = await priceBookRepo.searchByVector(embedding, 3, 2024, query); // Pass query for Hybrid Re-ranking
                        allCandidates.push(...results);
                    } catch (err) {
                        console.error(`   -> Error searching variation "${query}":`, err);
                    }
                }

                // Deduplicate candidates by ID
                const uniqueCandidates = Array.from(new Map(allCandidates.map(c => [c.id, c])).values());
                console.log(`   -> Found ${uniqueCandidates.length} unique candidates. Scoring...`);

                // C. LLM Verification (The "Judge")
                // If we have candidates, ask LLM to pick the best one for the ORIGINAL description
                let bestMatch: any = null;
                let bestMatchReason = "";

                if (uniqueCandidates.length > 0) {
                    // Filter out obvious trash (very low score even for loose search)
                    const viableCandidates = uniqueCandidates.filter((c: any) => (c.matchScore || 0) > 0.60);

                    if (viableCandidates.length > 0) {
                        // Prompt for verification
                        const verificationPrompt = `
                            I need to find the best Price Book item match for a construction task.
                            
                            Task: "${item.description}"
                            Context: "${input.projectContext || ''}"
                            
                            Candidates (from Database):
                            ${viableCandidates.map((c, i) => `${i + 1}. [${c.code}] ${c.description} (Price: ${c.priceTotal}€)`).join('\n')}
                            
                            Instructions:
                            1. Analyze semantic equivalence. "Picar" ≈ "Demolición". "Retirada" ≈ "Carga".
                            2. Check if the Candidate covers the Task scope.
                            3. Select the BEST match index (1-${viableCandidates.length}).
                            4. If NONE are good matches (e.g. completely different trade, or massive price difference like typical 10€ vs 2000€), return 0.
                            
                            Output JSON: { "selectedIndex": number, "reason": "string" }
                        `;

                        try {
                            // Using generate directly for speed/simplicity in this inner loop
                            // In production, use structuredOutput safely
                            const result = await ai.generate({
                                model: geminiFlash,
                                prompt: verificationPrompt,
                                output: { format: 'json' }
                            });

                            const decision = result.output; // Genkit typed output if using schema, or just json
                            // @ts-ignore
                            const selection = decision?.selectedIndex || 0;
                            // @ts-ignore
                            bestMatchReason = decision?.reason || "No reason provided";

                            if (selection > 0 && selection <= viableCandidates.length) {
                                bestMatch = viableCandidates[selection - 1];
                                console.log(`   -> LLM Selected: ${bestMatch.description} (Reason: ${bestMatchReason})`);
                            } else {
                                console.warn(`   -> LLM Rejected all candidates. Reason: ${bestMatchReason}`);
                            }

                        } catch (err) {
                            console.error(`   -> Error in LLM Verification:`, err);
                        }
                    }
                }

                // D. Aggregation
                if (bestMatch) {
                    const existing = aggregatedItems.get(bestMatch.code);
                    if (existing) {
                        existing.quantity += item.quantity;
                        existing.totalPrice = parseFloat((existing.unitPrice * existing.quantity).toFixed(2));
                    } else {
                        aggregatedItems.set(bestMatch.code, {
                            id: `gen-${Date.now()}-${index}`,
                            code: bestMatch.code,
                            description: bestMatch.description, // Use PB description
                            unit: bestMatch.unit || item.unit,
                            quantity: item.quantity, // Use AI quantity
                            unitPrice: bestMatch.priceTotal, // Use PB Price
                            totalPrice: parseFloat((bestMatch.priceTotal * item.quantity).toFixed(2)),
                            type: 'PARTIDA',
                            order: index + 1,
                            originalTask: item.description, // Keep intent
                            isRealCost: true,
                            matchConfidence: 95, // Verified by LLM
                            breakdown: bestMatch.breakdown,
                            note: `✅ AI Verified Match: ${bestMatchReason}`
                        });
                    }

                    if (targetLeadId) {
                        emitGenerationEvent(targetLeadId, 'item_resolved', {
                            item: bestMatch,
                            status: 'success'
                        });
                    }
                } else {
                    // Fallback: Needs Review
                    const fallbackKey = `REVIEW:${item.description}`;
                    aggregatedItems.set(fallbackKey, {
                        id: `rev-${Date.now()}-${index}`,
                        code: `PENDIENTE`,
                        description: item.description,
                        unit: item.unit,
                        quantity: item.quantity,
                        unitPrice: 0,
                        totalPrice: 0,
                        type: 'PARTIDA',
                        order: index + 1,
                        originalTask: item.description,
                        isRealCost: false,
                        matchConfidence: 0,
                        note: `⚠ Sin coincidencia verificada. ${bestMatchReason ? `(AI: ${bestMatchReason})` : ''}`
                    });

                    if (targetLeadId) {
                        emitGenerationEvent(targetLeadId, 'item_resolved', {
                            item: aggregatedItems.get(fallbackKey),
                            status: 'warning'
                        });
                    }
                }
            }

            // 4. Sanity Check & Finalize
            const singularKeywords = ['ascensor', 'caldera', 'cuadro eléctrico', 'puerta de entrada', 'bomba de calor', 'maquina de aire'];
            const finalItems: BudgetPartida[] = [];

            finalItems.push(...Array.from(aggregatedItems.values()).map((item, idx) => {
                // Re-assign Order
                item.order = idx + 1;

                // SANITY CHECK: Quantity Cap
                if (singularKeywords.some(kw => item.description.toLowerCase().includes(kw)) && item.quantity > 1) {
                    console.warn(`[ConstructionAnalyst] Sanity Check: Capping quantity of "${item.description}" from ${item.quantity} to 1.`);
                    item.quantity = 1;
                    item.totalPrice = item.unitPrice; // Recalc total
                }

                return item;
            }));

            return {
                items: finalItems
            };
        }

        console.warn('[ConstructionAnalyst] decomposition mode requested but no description provided. Returning empty.');
        return { items: [] };
    }
);
