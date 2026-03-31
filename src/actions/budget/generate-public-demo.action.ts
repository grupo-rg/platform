'use server';

import { BudgetNarrativeBuilder } from '@/backend/budget/domain/budget-narrative-builder';
import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';
import { FirestoreAiTrainingRepository } from '@/backend/ai-training/infrastructure/firestore-ai-training-repository';
import { RecordInitialAiTraceUseCase } from '@/backend/ai-training/application/record-initial-ai-trace.use-case';
import { Budget } from '@/backend/budget/domain/budget';
import { BudgetRepositoryFirestore } from '@/backend/budget/infrastructure/budget-repository-firestore';
import { v4 as uuidv4 } from 'uuid';

import { ArchitectAgent } from '@/backend/ai/private-core/agents/architect.agent';
import { SurveyorAgent } from '@/backend/ai/private-core/agents/surveyor.agent';
import { JudgeAgent } from '@/backend/ai/private-core/agents/judge.agent';
import { emitGenerationEvent } from '@/backend/budget/events/budget-generation.emitter';

import { BudgetRequirement } from '@/backend/budget/domain/budget-requirements';

export async function generatePublicDemoAction(leadId: string, requirements: BudgetRequirement, chatHistory?: { role: string, content: string }[]) {
    try {
        console.log(`>> [PUBLIC DEMO] Starting limit validation for Lead: ${leadId}`);

        if (!leadId || leadId.trim() === '') {
            return { success: false, error: "Se requiere validación de identidad (OTP)." };
        }

        // We build the full narrative text first to assess its length
        const specsNarrative = BudgetNarrativeBuilder.build((requirements.specs || {}) as any);
        let needsNarrative = "";
        if (requirements.detectedNeeds && requirements.detectedNeeds.length > 0) {
            needsNarrative = "\n\nDIRECTIVA CRÍTICA - REQUERIMIENTOS EXPLÍCITOS DEL USUARIO:\n" +
                "Debes cumplir SI O SI con los materiales solicitados por el usuario si existen, inyectándolos en el campo 'userSpecificMaterial' de las tareas correspondientes.\n" +
                requirements.detectedNeeds.map(n => `- Tarea/Categoría [${n.category}]: ${n.description}. ${n.requestedMaterial ? '-> OBLIGATORIO MATERIAL: ' + n.requestedMaterial : ''}`).join("\n");
        }

        // Append raw chat history if available
        let chatHistoryText = "";
        if (chatHistory && chatHistory.length > 0) {
            chatHistoryText = "\n\n--- Historial de Chat Original ---\n" +
                chatHistory.map(m => `[${m.role === 'user' ? 'Usuario' : 'Asistente'}]: ${m.content}`).join("\n\n");
        }

        const userPrompt = `${specsNarrative}${needsNarrative}${chatHistoryText}`;

        if (userPrompt.length > 5000) {
            return { success: false, error: "El texto introducido excede el máximo permitido para la demo." };
        }

        const aiTrainingRepo = new FirestoreAiTrainingRepository();
        const leadRepo = new FirestoreLeadRepository();

        // 1. Check strict 1-use limit for the public demo
        const existingTraces = await aiTrainingRepo.findByLeadId(leadId);
        if (existingTraces.length > 0) {
            console.log(`>> Lead ${leadId} already generated a budget. Enforcing rate limit.`);
            return {
                success: false,
                error: "Ya has agotado tu presupuesto gratuito de demostración. Agenda una consultoría para seguir evaluando Basis."
            };
        }

        // 2. Fetch Lead Context (Optional)
        const lead = await leadRepo.findById(leadId);

        // 3. Narrative Construction with Obra Menor Override
        // This is the Cognitive Barrier. It forces the Architect to reject New Builds.
        const demoConstraints = `
        IMPORTANTE (RESTRICCIÓN DE DEMO PÚBLICA):
        El usuario está usando una demostración pública limitada.
        1. SOLO puedes procesar reformas menores, interiores, cocinas, baños, pintura, solados y derribos simples.
        2. ESTÁ TERMINANTEMENTE PROHIBIDO generar partidas de Cimentación, Estructuras, Movimientos de Tierra Masivos, o Construcción de Edificios Nuevos.
        3. Si el usuario te pide construir una casa desde cero, u Obra Nueva, RECHAZA la petición cordialmente (devuelve un status 'ASKING' diciendo: "En esta demo gratuita solo realizamos cálculos de Obras Menores y Reformas de Interior. Por favor, ajusta tu petición").
        
        Petición del usuario:
        `;

        const narrative = `${demoConstraints}\n"${userPrompt}"`;

        // 4. Execute Multi-Agent (RAG + Fan-out)
        const architect = new ArchitectAgent();
        const surveyor = new SurveyorAgent();
        const judge = new JudgeAgent();

        const executionLog: any[] = [];
        const startTime = performance.now();
        let totalInputTokens = 0;
        let totalOutputTokens = 0;

        console.log(">> [PUBLIC DEMO] Architect: Decomposing context...");
        const architectResult = await architect.decomposeRequest(narrative);

        if (architectResult.usage) {
            totalInputTokens += architectResult.usage.inputTokens || 0;
            totalOutputTokens += architectResult.usage.outputTokens || 0;
        }

        if (architectResult.status === 'ASKING' && architectResult.question) {
            return {
                success: false,
                isAsking: true,
                question: architectResult.question
            };
        }

        const decomposedTasks = architectResult.tasks;
        const mappedChapters: any[] = [];
        let totalEstimated = 0;

        executionLog.push({
            timestamp: new Date(),
            agent: 'Architect',
            action: 'Decomposition',
            details: `Decoded ${decomposedTasks.length} physical tasks from context.`
        });

        console.log(">> [PUBLIC DEMO] Processing Chapters & Tasks in PARALLEL (Fan-Out)...");

        // Notify UI that generic architecture tasks are ready (starts parallel loading bar)
        await emitGenerationEvent(leadId, 'subtasks_extracted', {
            totalTasks: decomposedTasks.length
        });

        // Fan-Out AI Execution
        const taskPromises = decomposedTasks.map(async (task) => {
            const logs: any[] = [];
            let usage = { inputTokens: 0, outputTokens: 0 };

            try {
                const expansionResult = await surveyor.generateQueryExpansions(task);
                if (expansionResult.usage) {
                    usage.inputTokens += expansionResult.usage.inputTokens || 0;
                    usage.outputTokens += expansionResult.usage.outputTokens || 0;
                }

                const searchTask = { ...task, task: expansionResult.queries[0] };

                logs.push({
                    timestamp: new Date(),
                    agent: 'Surveyor',
                    action: 'Multi-Query Expansion',
                    details: `Generated ${expansionResult.queries.length} semantic variatons for ${task.task}.`
                });

                const candidates = await surveyor.retrieveCandidates(searchTask, 3); // Slightly lower recall for speed in demo

                logs.push({
                    timestamp: new Date(),
                    agent: 'Surveyor',
                    action: 'Hybrid RAG Search',
                    details: `Retrieved ${candidates.length} candidates for [${task.chapter}] ${task.task}`
                });

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
                } else {
                    // Fire SSE Stream Event to Frontend UI to increment progress bar
                    let resolvedCandidate = candidates.find(c => c.code === decision.selectedId);
                    if (!resolvedCandidate && candidates.length > 0 && decision.selectedId !== 'GENERIC-EXPLICIT') {
                        resolvedCandidate = candidates[0];
                    }
                    const desc = resolvedCandidate ? resolvedCandidate.description : `[PARTIDA A DETERMINAR] ${task.task}`;
                    const code = resolvedCandidate ? resolvedCandidate.code : 'GENERIC-EXPLICIT';
                    const unitPrice = resolvedCandidate ? Number((resolvedCandidate as any).price_total || (resolvedCandidate as any).priceTotal || (resolvedCandidate as any).price || (resolvedCandidate as any).unitPrice || 0) : 0;
                    const qty = Number(decision.quantity) || 1;
                    
                    emitGenerationEvent(leadId, 'item_resolved', {
                        item: { code, description: desc, totalPrice: unitPrice * qty },
                        type: 'TASK'
                    }).catch(console.error);
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

        // Aggregation
        for (const pt of processedTasks) {
            totalInputTokens += pt.usage.inputTokens;
            totalOutputTokens += pt.usage.outputTokens;
            executionLog.push(...pt.logs);

            if (!pt.success || pt.decision.selectedId === null) continue;

            const { task, candidates, decision } = pt;
            let selectedCandidate = candidates.find(c => c.code === decision.selectedId);

            // Handle Explicit Virtual Tasks
            if (decision.selectedId === 'GENERIC-EXPLICIT') {
                selectedCandidate = {
                    code: 'GENERIC-EXPLICIT',
                    description: `[PARTIDA A DETERMINAR] ${task.task}`,
                    unit: task.estimatedParametricUnit || 'u',
                    priceTotal: 0,
                    chapter: task.chapter,
                    breakdown: [],
                    // INCORPORATE RAG CANDIDATES: Carry over the discarded but retrieved candidates to UI
                    candidates: candidates.filter(c => c.code !== decision.selectedId).map((c: any) => ({
                        code: c.code,
                        description: c.description,
                        unitPrice: Number(c.price_total || c.priceTotal || c.price || c.unitPrice || 0),
                        unit: c.unit,
                        breakdown: c.breakdown || []
                    })) || []
                } as any;
            } else if (!selectedCandidate && candidates.length > 0) {
                selectedCandidate = candidates[0];
            }

            if (selectedCandidate) {
                const rawDoc = selectedCandidate as any;
                const unitPrice = Number(rawDoc.price_total || rawDoc.priceTotal || rawDoc.price || rawDoc.unitPrice || 0);
                const safeQuantity = Number(decision.quantity) || 1;
                const lineItemTotal = unitPrice * safeQuantity;

                let currentChapter = mappedChapters.find(c => c.name.toUpperCase() === task.chapter.toUpperCase());
                if (!currentChapter) {
                    currentChapter = {
                        id: uuidv4(),
                        name: task.chapter.toUpperCase(),
                        order: mappedChapters.length + 1,
                        items: [],
                        totalPrice: 0,
                        propertyType: "flat",
                        quality: "medium",
                        floorArea: 0,
                    };
                    mappedChapters.push(currentChapter);
                }

                const newItem = {
                    id: uuidv4(),
                    type: 'PARTIDA',
                    code: selectedCandidate.code,
                    description: selectedCandidate.description,
                    unit: selectedCandidate.unit,
                    quantity: decision.quantity,
                    unitPrice: unitPrice,
                    totalPrice: lineItemTotal,
                    breakdown: selectedCandidate.breakdown || [],
                    // INCORPORATE RAG CANDIDATES: Carry over the discarded but retrieved candidates to UI
                    candidates: candidates.filter(c => c.code !== selectedCandidate!.code).map((c: any) => ({
                        code: c.code,
                        description: c.description,
                        unitPrice: Number(c.price_total || c.priceTotal || c.price || c.unitPrice || 0),
                        unit: c.unit,
                        breakdown: c.breakdown || []
                    })) || [],
                    notes: decision.note || '',
                    ai_justification: decision.internal_reasoning || '',
                    sourceDatabase: (selectedCandidate as any).sourceDatabase || '2025_catalog'
                };

                currentChapter.items.push(newItem);
                currentChapter.totalPrice += lineItemTotal;
                totalEstimated += lineItemTotal;
            }
        }

        const generationTimeMs = performance.now() - startTime;
        const totalTokens = totalInputTokens + totalOutputTokens;
        const costUsd = (totalInputTokens / 1_000_000) * 1.25 + (totalOutputTokens / 1_000_000) * 5.00;
        const costEur = costUsd * 0.92;

        const budgetResult = {
            chapters: mappedChapters,
            totalEstimated: totalEstimated,
            costBreakdown: {
                materialExecutionPrice: totalEstimated,
                overheadExpenses: totalEstimated * 0.13,
                industrialBenefit: totalEstimated * 0.06,
                tax: totalEstimated * 0.21,
                globalAdjustment: 0,
                total: totalEstimated * 1.40
            },
            telemetry: {
                blueprint: {
                    originalRequest: narrative,
                    decomposedTasks: decomposedTasks
                },
                executionLog: executionLog,
                metrics: {
                    generationTimeMs,
                    tokens: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, totalTokens },
                    costs: { fiatAmount: Number(costEur.toFixed(4)), fiatCurrency: 'EUR' }
                }
            }
        };

        // 5. Save the RLHF Cognitive Trace (Baseline)
        const recordAiUseCase = new RecordInitialAiTraceUseCase(aiTrainingRepo);
        const traceId = await recordAiUseCase.execute(
            leadId,
            userPrompt,
            budgetResult,
            {
                baselineTokens: totalTokens,
                baselineTimeMs: generationTimeMs
            }
        );

        console.log(`>> [PUBLIC DEMO] Baseline RLHF Trace generated: ${traceId}`);

        // 6. Increment Lead Usage Limit
        if (lead) {
            lead.incrementDemoBudgets();
            await leadRepo.save(lead);
        }

        return {
            success: true,
            traceId, // To be submitted back when they edit the PDF
            budgetResult: budgetResult
        };

    } catch (error: any) {
        console.error("Error generating DEMO budget:", error);
        return { success: false, error: error.message };
    }
}
