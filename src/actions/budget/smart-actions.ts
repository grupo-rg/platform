'use server';
import { ai, gemini25Flash } from '@/backend/ai/shared/config/genkit.config';
import { SurveyorAgent } from '@/backend/ai/private-core/agents/surveyor.agent';
import { JudgeAgent } from '@/backend/ai/private-core/agents/judge.agent';
import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';

/**
 * Estimates a unit price for a simplified description using AI.
 * Fast, approximate, for quick budgeting.
 */
export async function estimatePriceAction(description: string): Promise<{ success: boolean; price?: number; confidence?: number; reason?: string; error?: string }> {
    try {
        if (!description) return { success: false, error: "Description is empty" };

        const prompt = `
            Estimate the Execution Cost (Material + Labor) for a single unit of this construction task: "${description}".
            Location: Spain. 
            Market rates: 2025.
            
            Return ONLY a number (Euro). If unsure, estimate based on standard database rates.
            Output JSON: { "price": number, "confidence": number (0-1), "reason": "brief explanation" }
        `;

        const result = await ai.generate({
            model: gemini25Flash, // Fast model
            prompt: prompt,
            output: { format: 'json' }
        });

        const output = result.output as any;
        return {
            success: true,
            price: output.price,
            confidence: output.confidence,
            reason: output.reason
        };

    } catch (error: any) {
        console.error("Estimate Price Error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Generates a full breakdown (descompuesto) for an item by invoking the Construction Analyst Agent.
 * This effectively converts a simple line item into a complex Partida.
 */
export async function generateBreakdownAction(description: string, leadId?: string) {
    try {
        if (!description) return { success: false, error: "Description is empty" };

        if (leadId) {
            const leadRepo = new FirestoreLeadRepository();
            const leadDoc = await leadRepo.findById(leadId);
            if (leadDoc && leadDoc.demoPdfsDownloaded > 0) {
                return { success: false, error: "Acción no permitida: Documento Finalizado. Has agotado las consultas de IA tras descargar el PDF de demostración." };
            }
        }

        console.log(`[SmartActions] Atomic RAG Search for: ${description}`);

        const surveyor = new SurveyorAgent();
        const judge = new JudgeAgent();

        const taskInfo: any = {
            taskId: "atomic-1",
            chapter: "VARIOS", // O podríamos pasarlo como parámetro
            task: description,
            estimatedParametricUnit: "ud",
            dependsOn: [],
            reasoning: "Generación solicitada manualmente por el usuario",
            isExplicitlyRequested: true,
            estimatedParametricQuantity: 1
        };

        // 1. Expand
        const expansion = await surveyor.generateQueryExpansions(taskInfo);
        const searchTask = { ...taskInfo, task: expansion.queries[0] || description };

        // 2. Retrieve
        const candidates = await surveyor.retrieveCandidates(searchTask, 5);
        if (candidates.length === 0) {
            return { success: false, error: "No se encontraron candidatos RAG en la base de datos." };
        }

        // 3. Judge
        const judgeResult = await judge.evaluateAndSelect(taskInfo, candidates);
        const decision = judgeResult.decision;

        if (decision.selectedId === null) {
            // HUMAN-IN-THE-LOOP RETURN
            // If the Judge rejects everything, we return the raw candidates to UI to let human decide or pick one closely related.
            return {
                success: false, // Remains false since AI couldn't confidentially map it
                humanInTheLoop: true, // New flag signaling "I need your help"
                error: "El Juez de IA no pudo encontrar una coincidencia exacta de catálogo. Por favor, selecciona la opción más similar:",
                candidates: candidates.map((c: any) => ({
                    code: c.code,
                    description: c.description,
                    unitPrice: Number(c.price_total || c.priceTotal || c.price || c.unitPrice || 0),
                    unit: c.unit,
                    breakdown: c.breakdown || []
                }))
            };
        }

        const selectedCandidate = candidates.find(c => c.code === decision.selectedId) || candidates[0];

        if (selectedCandidate) {
            const rawDoc = selectedCandidate as any;
            const unitPrice = Number(rawDoc.price_total || rawDoc.priceTotal || rawDoc.price || rawDoc.unitPrice || 0);

            return {
                success: true,
                items: [{
                    code: selectedCandidate.code,
                    description: selectedCandidate.description,
                    unit: selectedCandidate.unit,
                    unitPrice: unitPrice,
                    breakdown: selectedCandidate.breakdown || [],
                    notes: decision.note || ''
                }],
                candidates: candidates.map((c: any) => ({ // Always expose just in case
                    code: c.code,
                    description: c.description,
                    unitPrice: Number(c.price_total || c.priceTotal || c.price || c.unitPrice || 0),
                    unit: c.unit,
                    breakdown: c.breakdown || []
                }))
            };
        }

        return { success: false, error: "Candidato inválido post-selección." };

    } catch (error: any) {
        console.error("Generate Breakdown Error:", error);
        return { success: false, error: error.message };
    }
}
