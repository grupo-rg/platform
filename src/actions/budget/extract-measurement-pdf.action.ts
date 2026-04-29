'use server';

import { v4 as uuidv4 } from 'uuid';

export async function extractMeasurementPdfAction(formData: FormData, effectiveId: string, strategy: 'INLINE' | 'ANNEXED' = 'INLINE', providedBudgetId?: string) {
    try {
        const file = formData.get('file') as File;
        if (!file) throw new Error("No file provided");

        // El cliente puede generar el budgetId para alinear el canal de telemetría
        // (pipeline_telemetry/{budgetId}) desde el primer render del panel de actividad.
        const budgetId = providedBudgetId || uuidv4();

        // Append strict tracking IDs for the Python task
        formData.append('leadId', effectiveId || 'anonymous');
        formData.append('budgetId', budgetId);
        formData.append('strategy', strategy);

        // Send to the Asynchronous Python Microservice (FastAPI)
        // Locally it runs on 8080. In GCP, AI_CORE_URL will be injected via ENV.
        const AI_CORE_URL = process.env.AI_CORE_URL || 'http://127.0.0.1:8080';
        const targetUrl = `${AI_CORE_URL}/api/v1/jobs/measurements`;

        console.log(`[Next.js Action] Proxying PDF to Python Core Engine: ${targetUrl}`);

        const internalToken = process.env.INTERNAL_WORKER_TOKEN;
        const response = await fetch(targetUrl, {
            method: 'POST',
            headers: internalToken ? { 'x-internal-token': internalToken } : undefined,
            body: formData, // Auto-sets multipart/form-data boundary
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("[Next.js Proxy Error]", errorText);
            throw new Error(`AI Core service failed: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        console.log("[Next.js Action] Python Core Accepted Job:", result);

        // Fast return so the UI can start streaming from Firestore
        return { 
            success: true, 
            budgetId: result.budgetId || budgetId, 
            isPending: true,
            message: "El Motor IA ha comenzado a procesar en segundo plano."
        };
        
    } catch (error: any) {
        console.error("Extraction error:", error);
        return { success: false, error: error.message || "Unknown error occurred" };
    }
}
