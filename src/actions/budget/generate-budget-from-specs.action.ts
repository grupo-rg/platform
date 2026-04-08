'use server';


import { BudgetNarrativeBuilder } from '@/backend/budget/domain/budget-narrative-builder';
// Deprecated import removed
import { runWithContext } from '@/backend/ai/shared/context/genkit.context';
import { BudgetRepositoryFirestore } from '@/backend/budget/infrastructure/budget-repository-firestore';
import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';
import { Budget } from '@/backend/budget/domain/budget';
import { ProjectSpecs } from '@/backend/budget/domain/project-specs';
import { v4 as uuidv4 } from 'uuid';

const budgetRepository = new BudgetRepositoryFirestore();
const leadRepository = new FirestoreLeadRepository();

// ... imports
// Deprecated import removed

// ... (previous code)

import { ArchitectAgent } from '@/backend/ai/private-core/agents/architect.agent';
import { SurveyorAgent } from '@/backend/ai/private-core/agents/surveyor.agent';
import { JudgeAgent } from '@/backend/ai/private-core/agents/judge.agent';
import { BudgetRequirement } from '@/backend/budget/domain/budget-requirements';

export async function generateBudgetFromSpecsAction(leadId: string | null, fullRequirements: BudgetRequirement, deepGeneration: boolean = false) {
    try {
        console.log(`>> Generating Budget from Specs (Deep Mode: ${deepGeneration})...`);

        let lead = null;
        if (leadId && leadId !== 'admin-user' && leadId !== 'unknown-lead') {
            lead = await leadRepository.findById(leadId);
            if (!lead) {
                // ... (auto-create logic) ...
                const { ensureLeadProfile } = await import('@/actions/debug/fix-account.action');
                await ensureLeadProfile(leadId);
                lead = await leadRepository.findById(leadId);
            }
        }

        const generatedBudgetId = uuidv4();

        // 2. Build Narrative
        const specsNarrative = BudgetNarrativeBuilder.build((fullRequirements.specs || {}) as any);

        let needsNarrative = "";
        if (fullRequirements.detectedNeeds && fullRequirements.detectedNeeds.length > 0) {
            needsNarrative = "\n\nDIRECTIVA CRÍTICA - REQUERIMIENTOS EXPLÍCITOS DEL USUARIO:\n" +
                "Debes cumplir SI O SI con los materiales solicitados por el usuario si existen, inyectándolos en el campo 'userSpecificMaterial' de las tareas correspondientes.\n" +
                fullRequirements.detectedNeeds.map(n => `- Tarea/Categoría [${n.category}]: ${n.description}. ${n.requestedMaterial ? '-> OBLIGATORIO MATERIAL: ' + n.requestedMaterial : ''}`).join("\n");
        }

        const narrative = `${specsNarrative}${needsNarrative}`;

        console.log(">> Narrative passed to Architect:", narrative);

        let budgetResult: any;

        // 3. Call AI Flow
        const contextUserId = leadId || 'admin-user';
        if (deepGeneration) {
            console.log(">> Using Recursive Flow (Deep Generation)");

            const architect = new ArchitectAgent();
            const surveyor = new SurveyorAgent();
            const judge = new JudgeAgent();

            const executionLog: any[] = []; // Telemetry accumulator

            const startTime = performance.now();
            let totalInputTokens = 0;
            let totalOutputTokens = 0;

            console.log(">> Architect: Decomposing context...");
            const architectResult = await architect.decomposeRequest(narrative);

            if (architectResult.usage) {
                totalInputTokens += architectResult.usage.inputTokens || 0;
                totalOutputTokens += architectResult.usage.outputTokens || 0;
            }

            if (architectResult.status === 'ASKING' && architectResult.question) {
                console.log(`>> Architect asked a question: ${architectResult.question}`);
                return {
                    success: false,
                    isAsking: true,
                    question: architectResult.question
                };
            }

            const decomposedTasks = architectResult.tasks;

            executionLog.push({
                timestamp: new Date(),
                agent: 'Architect',
                action: 'Decomposition',
                details: `Decoded ${decomposedTasks.length} physical tasks from context.`
            });

            if (leadId) {
                try {
                    // Update to new Pipeline Telemetry architecture
                    const { adminFirestore } = await import('@/backend/shared/infrastructure/firebase/admin-app');
                    await adminFirestore.collection('pipeline_telemetry').doc(generatedBudgetId).collection('events').add({
                        type: 'subtasks_extracted',
                        data: {
                            step: 'searching',
                            totalTasks: decomposedTasks.length
                        },
                        timestamp: new Date().toISOString(),
                        expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
                    });
                } catch (emitError) {
                    console.warn("Failed to emit generation event", emitError);
                }
            }

            const mappedChapters: any[] = [];
            let totalEstimated = 0;

            console.log(">> Processing Chapters & Tasks in PARALLEL (Fan-Out)...");

            // ------------- DAG TELEMETRY CHECK -------------
            console.log("\n====== ARCHITECT DAG STRUCTURE GENERATED ======");
            decomposedTasks.forEach(task => {
                console.log(`[Task ${task.taskId}] (Depends On: [${task.dependsOn?.join(', ') || ''}]) -> ${task.chapter}: ${task.task}`);
            });
            console.log("================================================\n");

            // Phase 1: Fan-Out AI Execution (Surveyor + Judge)
            const taskPromises = decomposedTasks.map(async (task) => {
                const logs: any[] = [];
                let usage = { inputTokens: 0, outputTokens: 0 };

                try {
                    console.log(`>> Surveyor: Expanding queries for [${task.chapter}] ${task.task}...`);
                    const expansionResult = await surveyor.generateQueryExpansions(task);
                    if (expansionResult.usage) {
                        usage.inputTokens += expansionResult.usage.inputTokens || 0;
                        usage.outputTokens += expansionResult.usage.outputTokens || 0;
                    }

                    logs.push({
                        timestamp: new Date(),
                        agent: 'Surveyor',
                        action: 'Multi-Query Expansion',
                        details: `Generated ${expansionResult.queries.length} semantic variatons for ${task.task}.`
                    });

                    const searchTask = { ...task, task: expansionResult.queries[0] };
                    const candidates = await surveyor.retrieveCandidates(searchTask, 4);

                    logs.push({
                        timestamp: new Date(),
                        agent: 'Surveyor',
                        action: 'Hybrid RAG Search',
                        details: `Retrieved ${candidates.length} candidates for [${task.chapter}] ${task.task}`
                    });

                    // Judge validates the retrieved vectors
                    const judgeResult = await judge.evaluateAndSelect(task, candidates);
                    const decision = judgeResult.decision;

                    if (judgeResult.usage) {
                        usage.inputTokens += judgeResult.usage.inputTokens || 0;
                        usage.outputTokens += judgeResult.usage.outputTokens || 0;
                    }

                    logs.push({
                        timestamp: new Date(),
                        agent: 'Judge',
                        action: 'Candidate Consolidation',
                        details: `Selected candidate ${decision.selectedId || 'None'} - Reasoning: ${decision.note || 'None'}`
                    });

                    if (decision.selectedId === null) {
                        logs.push({
                            timestamp: new Date(),
                            agent: 'System',
                            action: 'Task Skipped',
                            details: `Task skipped because Judge rejected all RAG candidates due to scale/unit mismatch.`
                        });
                    } else if (leadId) {
                        // Emitir streaming a UI por task resuelto
                        try {
                            let evCandidate = candidates.find(c => c.code === decision.selectedId);
                            if (!evCandidate && candidates.length > 0 && decision.selectedId !== 'GENERIC-EXPLICIT') {
                                evCandidate = candidates[0];
                            }
                            const desc = evCandidate ? evCandidate.description : `[PARTIDA A DETERMINAR] ${task.task}`;
                            const code = evCandidate ? evCandidate.code : 'GENERIC-EXPLICIT';
                            const unitPrc = evCandidate ? Number((evCandidate as any).price_total || (evCandidate as any).priceTotal || (evCandidate as any).price || (evCandidate as any).unitPrice || 0) : 0;
                            const qty = Number(decision.quantity) || 1;
                            
                            const { adminFirestore } = await import('@/backend/shared/infrastructure/firebase/admin-app');
                            await adminFirestore.collection('pipeline_telemetry').doc(generatedBudgetId).collection('events').add({
                                type: 'item_resolved',
                                data: {
                                    item: { code, description: desc, totalPrice: unitPrc * qty },
                                    type: 'PARTIDA'
                                },
                                timestamp: new Date().toISOString(),
                                expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
                            });
                        } catch (e) { console.warn("Stream API Emit Error", e); }
                    }

                    return { success: true, task, candidates, decision, logs, usage };
                } catch (err: any) {
                    console.error(`Error processing task ${task.task}:`, err);
                    logs.push({
                        timestamp: new Date(),
                        agent: 'System',
                        action: 'Task Failed',
                        details: `Task failed critically: ${err.message}`
                    });
                    return { success: false, task, logs, usage, candidates: [], decision: { selectedId: null } };
                }
            });

            const processedTasks = await Promise.all(taskPromises);

            // Phase 2: Synchronous Aggregation (DB Mapping & Telemetry)
            console.log(">> Aggregating Parallel Results...");
            for (const pt of processedTasks) {
                totalInputTokens += pt.usage.inputTokens;
                totalOutputTokens += pt.usage.outputTokens;
                executionLog.push(...pt.logs);

                if (!pt.success || pt.decision.selectedId === null) continue;

                const { task, candidates, decision } = pt;
                let selectedCandidate = candidates.find(c => c.code === decision.selectedId);

                if (!selectedCandidate && candidates.length > 0) {
                    selectedCandidate = candidates[0]; // Fallback
                }

                if (selectedCandidate) {
                    const rawDoc = selectedCandidate as any;
                    const unitPrice = Number(rawDoc.price_total || rawDoc.priceTotal || rawDoc.price || rawDoc.unitPrice || 0);
                    const safeQuantity = Number(decision.quantity) || 1;
                    const lineItemTotal = unitPrice * safeQuantity;

                    // Find or create chapter (Synchronous to avoid duplicates)
                    let currentChapter = mappedChapters.find(c => c.name.toUpperCase() === task.chapter.toUpperCase());
                    if (!currentChapter) {
                        currentChapter = {
                            id: uuidv4(),
                            name: task.chapter.toUpperCase(),
                            order: mappedChapters.length + 1,
                            items: [],
                            totalPrice: 0,
                            propertyType: fullRequirements.specs?.propertyType || "flat",
                            quality: fullRequirements.specs?.qualityLevel || "medium",
                            floorArea: fullRequirements.specs?.totalArea || 0,
                        };
                        mappedChapters.push(currentChapter);
                    }

                    const newItem: any = {
                        id: uuidv4(),
                        type: 'PARTIDA',
                        code: selectedCandidate.code,
                        description: selectedCandidate.description,
                        unit: selectedCandidate.unit,
                        quantity: decision.quantity,
                        unitPrice: unitPrice,
                        totalPrice: lineItemTotal,
                        breakdown: selectedCandidate.breakdown || [],
                        notes: decision.note || '',
                        sourceDatabase: (selectedCandidate as any).sourceDatabase || '2025_catalog',
                        
                        // --- ESTANDARIZACIÓN RAG (Alineado con Python AI-Core) ---
                        original_item: {
                            description: task.task,
                            quantity: decision.quantity,
                            unit: selectedCandidate.unit
                        },
                        ai_resolution: {
                            selected_candidate: selectedCandidate.code,
                            needs_human_review: (decision as any).confidence === 'low', // O la heurística correcta
                            confidence: (decision as any).confidence || 'high',
                            reasoning: decision.internal_reasoning || '',
                            flagged_by_agent: false
                        },
                        alternatives: candidates.map((c: any) => ({
                            code: c.code,
                            description: c.description,
                            price: Number(c.price_total || c.priceTotal || c.price || c.unitPrice || 0),
                            match_reason: "Búsqueda Semántica NL"
                        }))
                    };

                    currentChapter.items.push(newItem);
                    currentChapter.totalPrice += lineItemTotal;
                    totalEstimated += lineItemTotal;
                }
            }

            const endTime = performance.now();
            const generationTimeMs = endTime - startTime;
            const totalTokens = totalInputTokens + totalOutputTokens;

            // Simple Google Cloud Gemini 2.5 Pro Cost Estimation mapping
            // Note: Pricing could vary. Approx $1.25/1M input, $5.00/1M output. USD to EUR approx 0.92
            const costUsd = (totalInputTokens / 1_000_000) * 1.25 + (totalOutputTokens / 1_000_000) * 5.00;
            const costEur = costUsd * 0.92;

            budgetResult = {
                chapters: mappedChapters,
                totalEstimated: totalEstimated,
                costBreakdown: {
                    materialExecutionPrice: totalEstimated,
                    overheadExpenses: totalEstimated * 0.13,
                    industrialBenefit: totalEstimated * 0.06,
                    tax: totalEstimated * 0.21,
                    globalAdjustment: 0,
                    total: totalEstimated * 1.40 // Approx
                },
                telemetry: {
                    blueprint: {
                        originalRequest: narrative,
                        decomposedTasks: decomposedTasks
                    },
                    executionLog: executionLog,
                    metrics: {
                        generationTimeMs,
                        tokens: {
                            inputTokens: totalInputTokens,
                            outputTokens: totalOutputTokens,
                            totalTokens
                        },
                        costs: {
                            fiatAmount: Number(costEur.toFixed(4)),
                            fiatCurrency: 'EUR'
                        }
                    }
                }
            };

        } else {
            // Standard Flow Fallback
            if (!budgetResult) {
                budgetResult = { chapters: [], costBreakdown: null, totalEstimated: 0 };
            }
        }

        // 4. Persist Budget
        const budgetId = generatedBudgetId;

        const newBudget: Budget = {
            id: budgetId,
            leadId: lead?.id || 'unassigned',
            clientSnapshot: lead?.personalInfo || { name: 'Admin', email: '', phone: '' },
            specs: (fullRequirements.specs || {}) as any,
            status: 'draft',
            createdAt: new Date(),
            updatedAt: new Date(),
            version: 1,
            type: fullRequirements.specs?.interventionType === 'new_build' ? 'new_build' : 'renovation',

            // Use the mapped chapters directly
            chapters: budgetResult.chapters?.map((c: any) => ({
                ...c,
                id: c.id || uuidv4(), // Ensure ID
                items: c.items.map((i: any) => ({ ...i, id: i.id || uuidv4() }))
            })) || [],

            costBreakdown: budgetResult.costBreakdown,
            totalEstimated: budgetResult.totalEstimated,
            telemetry: budgetResult.telemetry,
            source: 'wizard'
        };

        await budgetRepository.save(newBudget);
        console.log(`[Action] Budget persisted with ID: ${budgetId}`);

        // Flatten items for frontend compatibility (if needed by UI result)
        const flattenedItems = newBudget.chapters.flatMap(c => c.items);

        // Serialize the result to strip Date objects and Class prototypes for Next.js Server Actions
        const serializedResult = JSON.parse(JSON.stringify({
            ...budgetResult,
            id: budgetId,
            lineItems: flattenedItems
        }));

        return {
            success: true,
            budgetId,
            budgetResult: serializedResult
        };

    } catch (error: any) {
        console.error("Error generating budget:", error);
        return { success: false, error: error.message };
    }
}
