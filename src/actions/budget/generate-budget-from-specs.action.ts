'use server';

import { BudgetNarrativeBuilder } from '@/backend/budget/domain/budget-narrative-builder';
import { BudgetRequirement } from '@/backend/budget/domain/budget-requirements';
import { v4 as uuidv4 } from 'uuid';

/**
 * Proxy ligero al servicio Python `ai-core` para el pipeline NL → Budget.
 *
 * La lógica de Architect + Surveyor + Judge + persistencia se migró al Python
 * (`POST /api/v1/jobs/nl-budget`) para centralizar modelos, retries, catálogo
 * y telemetría. Esta action solo:
 *  1. Construye el brief técnico a partir de `fullRequirements` y del
 *     `finalBrief` que el Asistente IA ya trae.
 *  2. Envía el job al Python con el `budgetId` generado en el cliente.
 *  3. Devuelve inmediatamente — el UI ya está escuchando
 *     `pipeline_telemetry/{budgetId}/events` y seguirá el progreso por SSE.
 *
 * El parámetro `deepGeneration` se conserva por compatibilidad pero ya no
 * altera el comportamiento (Python siempre usa el pipeline "deep").
 */
export async function generateBudgetFromSpecsAction(
    leadId: string | null,
    fullRequirements: BudgetRequirement,
    _deepGeneration: boolean = false,
    providedBudgetId?: string,
) {
    try {
        const budgetId = providedBudgetId || uuidv4();

        // 1. Construir narrativa: preferimos el finalBrief del Asistente (más concreto)
        //    y caemos al builder estándar + detectedNeeds si no existe.
        const extra = fullRequirements as any;
        let narrative = extra.finalBrief || extra.specs?.originalRequest || '';

        if (!narrative) {
            const specsNarrative = BudgetNarrativeBuilder.build((fullRequirements.specs || {}) as any);
            let needsNarrative = '';
            if (fullRequirements.detectedNeeds && fullRequirements.detectedNeeds.length > 0) {
                needsNarrative = '\n\nDIRECTIVA CRÍTICA - REQUERIMIENTOS EXPLÍCITOS DEL USUARIO:\n'
                    + "Debes cumplir SI O SI con los materiales solicitados por el usuario si existen, inyectándolos en el campo 'userSpecificMaterial' de las tareas correspondientes.\n"
                    + fullRequirements.detectedNeeds
                        .map(n => `- Tarea/Categoría [${n.category}]: ${n.description}. ${n.requestedMaterial ? '-> OBLIGATORIO MATERIAL: ' + n.requestedMaterial : ''}`)
                        .join('\n');
            }
            narrative = `${specsNarrative}${needsNarrative}`;
        }

        // 2. Proxy a Python
        const AI_CORE_URL = process.env.AI_CORE_URL || 'http://127.0.0.1:8080';
        const targetUrl = `${AI_CORE_URL}/api/v1/jobs/nl-budget`;
        const token = process.env.INTERNAL_WORKER_TOKEN;

        console.log(`[Next.js] Proxying NL→Budget to Python Core: ${targetUrl} (budgetId=${budgetId})`);

        const response = await fetch(targetUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { 'x-internal-token': token } : {}),
            },
            body: JSON.stringify({
                leadId: leadId || 'admin-user',
                budgetId,
                narrative,
            }),
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => '<no body>');
            console.error('[Next.js Proxy Error]', response.status, errText);
            return {
                success: false,
                error: `AI Core service failed: ${response.status}`,
            };
        }

        const result = await response.json();
        console.log('[Next.js] Python Core Accepted NL Job:', result);

        // Respuesta alineada con el contrato antiguo para no romper el cliente.
        // `budgetResult` se dejará vacío porque el budget se construye en Python
        // y el UI lo obtendrá vía telemetría (`budget_completed`) + fetch final.
        return {
            success: true,
            budgetId,
            isPending: true,
            budgetResult: {
                id: budgetId,
                chapters: [],
                totalEstimated: 0,
                costBreakdown: null,
            },
        };
    } catch (error: any) {
        console.error('[generateBudgetFromSpecsAction] error', error);
        return { success: false, error: error?.message || 'Unknown error' };
    }
}
