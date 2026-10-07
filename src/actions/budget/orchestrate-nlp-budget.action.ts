'use server';

import { checkAdmin, unauthorizedResult } from '@/actions/_guards';

import { ProjectSpecs } from '@/backend/budget/domain/project-specs';
import { aparejadorOrchestratorAgent } from '@/backend/ai/core/agents/aparejador-orchestrator.agent';
import { budgetSearchAgent } from '@/backend/ai/private/agents/budget-search.agent';
import { emitGenerationEvent } from '@/backend/budget/events/budget-generation.emitter';
import { BudgetRepositoryFirestore } from '@/backend/budget/infrastructure/budget-repository-firestore';
import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';
import { Budget } from '@/backend/budget/domain/budget';
import { v4 as uuidv4 } from 'uuid';

const budgetRepository = new BudgetRepositoryFirestore();
const leadRepository = new FirestoreLeadRepository();

// Final Budget Structure Output
export interface OrchestratedBudgetResult {
    projectId: string;
    scale: 'Obra Mayor' | 'Obra Menor';
    needsArchitect: boolean;
    reasoning: string;
    phases: {
        category: string;
        description: string;
        items: any[];
    }[];
    totalEstimated: number;
}

export async function orchestrateNlpToBudgetAction(
    leadId: string,
    userMessage: string,
    specs?: ProjectSpecs
): Promise<{ success: boolean; data?: OrchestratedBudgetResult; error?: string }> {
    if (!(await checkAdmin())) return unauthorizedResult();
    console.log(`[Orchestration] Starting NLP to Budget flow for lead ${leadId}`);

    try {
        // ─────────────────────────────────────────────────────────
        // STEP 1: The Aparejador analyses the NLP request and
        //         produces a structured phase breakdown.
        // ─────────────────────────────────────────────────────────
        console.log(`[Orchestration] Step 1 – Aparejador Orchestrator...`);
        await emitGenerationEvent(leadId, 'batch_progress', { message: 'Iniciando diseño arquitectónico de la obra...' });

        const structuralPlan = await aparejadorOrchestratorAgent({
            userId: leadId,
            userMessage,
            specs
        });

        console.log(`[Orchestration] Phases: ${structuralPlan.phases.map(p => p.category).join(', ')}`);

        await emitGenerationEvent(leadId, 'subtasks_extracted', { count: structuralPlan.phases.reduce((acc, p) => acc + p.estimatedItems.length, 0) });

        const finalPhases: { category: string; description: string; items: any[] }[] = [];
        let grandTotal = 0;

        // ─────────────────────────────────────────────────────────
        // STEP 2: For each Phase → search PARTIDAS only (Price Book).
        //         No material catalog lookups — mirrors PDF-to-Budget flow.
        // ─────────────────────────────────────────────────────────
        for (const phase of structuralPlan.phases) {
            console.log(`[Orchestration] Step 2 – Phase "${phase.category}" (${phase.estimatedItems.length} items)`);
            await emitGenerationEvent(leadId, 'chapter_start', { name: phase.category });

            const phaseItems: any[] = [];

            for (const estimatedItem of phase.estimatedItems) {
                // Destructure the enriched item from the Aparejador
                const taskDescription = estimatedItem.task;
                const estimatedQuantity = estimatedItem.estimatedQuantity || 1;
                const estimatedUnit = estimatedItem.unit || 'ud';

                try {
                    await emitGenerationEvent(leadId, 'vector_search', { query: taskDescription });
                    const searchResult = await budgetSearchAgent({
                        query: taskDescription,
                        generic_query: phase.category,
                        intent: 'PARTIDA',
                        context: `Fase: ${phase.category}. Proyecto: ${userMessage}`
                    });

                    if (searchResult.partida) {
                        const partida = searchResult.partida;
                        // Use the Aparejador's estimated quantity instead of hardcoded 1
                        const quantity = estimatedQuantity;
                        const unitPrice: number = partida.unitPrice ?? 0;
                        const subtotal = unitPrice * quantity;
                        grandTotal += subtotal;

                        phaseItems.push({
                            id: uuidv4(),
                            description: partida.description,
                            originalTask: taskDescription,
                            code: partida.code,
                            unit: partida.unit ?? estimatedUnit,
                            quantity,
                            unitPrice,
                            subtotal,
                            breakdown: partida.breakdown ?? []
                        });

                        await emitGenerationEvent(leadId, 'item_resolved', { item: { description: partida.description, unitPrice, quantity } });
                    } else {
                        // Placeholder so the chapter always has a row
                        phaseItems.push({
                            id: uuidv4(),
                            description: `[A Estimar] ${taskDescription}`,
                            originalTask: taskDescription,
                            unit: estimatedUnit,
                            quantity: estimatedQuantity,
                            unitPrice: 0,
                            subtotal: 0,
                            breakdown: []
                        });
                    }
                } catch (searchError) {
                    console.error(`[Orchestration] Search failed for item "${taskDescription}" in phase "${phase.category}"`, searchError);
                }
            }

            finalPhases.push({
                category: phase.category,
                description: phase.description,
                items: phaseItems
            });
        }

        // ─────────────────────────────────────────────────────────
        // STEP 3: Persist to Firestore (matching PDF flow)
        // ─────────────────────────────────────────────────────────
        const budgetId = uuidv4();

        // Retrieve the lead for the client snapshot
        let lead = await leadRepository.findById(leadId);
        if (!lead) {
            // Auto-create lead profile if missing
            const { ensureLeadProfile } = await import('@/actions/debug/fix-account.action');
            await ensureLeadProfile(leadId);
            lead = await leadRepository.findById(leadId);
        }

        // Build chapters in the standard Budget domain format
        const budgetChapters = finalPhases.map((phase, idx) => ({
            id: uuidv4(),
            name: phase.category,
            order: idx + 1,
            items: phase.items.map((item: any) => ({
                ...item,
                id: item.id || uuidv4(),
                type: 'PARTIDA' as const,
                totalPrice: (item.unitPrice || 0) * (item.quantity || 1),
            })),
            totalPrice: phase.items.reduce((sum: number, i: any) => sum + ((i.unitPrice || 0) * (i.quantity || 1)), 0)
        }));

        const costBreakdown = {
            materialExecutionPrice: grandTotal,
            overheadExpenses: grandTotal * 0.13,
            industrialBenefit: grandTotal * 0.06,
            tax: grandTotal * 0.21,
            globalAdjustment: 0,
            total: grandTotal * 1.40 // PEM + GG + BI + IVA
        };

        const newBudget: Budget = {
            id: budgetId,
            leadId,
            clientSnapshot: (lead?.personalInfo || { name: 'Cliente NLP' }) as any,
            specs: (specs || {}) as any,
            status: 'draft',
            createdAt: new Date(),
            updatedAt: new Date(),
            version: 1,
            type: 'renovation',
            chapters: budgetChapters as any,
            costBreakdown: costBreakdown as any,
            totalEstimated: grandTotal,
            source: 'wizard'
        };

        await budgetRepository.save(newBudget);
        console.log(`[Orchestration] Budget PERSISTED with ID: ${budgetId}`);

        const budgetResult: OrchestratedBudgetResult = {
            projectId: budgetId,
            scale: structuralPlan.projectScale,
            needsArchitect: structuralPlan.needsArchitect,
            reasoning: structuralPlan.reasoning,
            phases: finalPhases,
            totalEstimated: grandTotal
        };

        console.log(`[Orchestration] Done. Phases: ${finalPhases.length} | Total: ${grandTotal}€`);
        await emitGenerationEvent(leadId, 'complete', { summary: { total: grandTotal, items: finalPhases.reduce((acc, p) => acc + p.items.length, 0) } });

        return { success: true, data: budgetResult };

    } catch (error: any) {
        console.error('[Orchestration] Pipeline failed:', error);
        return { success: false, error: error.message };
    }
}
