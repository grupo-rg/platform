'use server';

import { clientRequirementsFlow } from '@/backend/ai/private-core/flows/client-requirements.flow';
import { BudgetRequirement } from '@/backend/budget/domain/budget-requirements';
import dns from 'node:dns';

// Fix for Node.js Undici fetch taking 60s to timeout on Windows IPv6 networks
dns.setDefaultResultOrder('ipv4first');
export async function processAdminMessageAction(
    conversationId: string,
    message: string,
    history: any[],
    currentRequirements: Partial<BudgetRequirement>,
    attachments: string[] = []
) {
    try {
        // ===============================================
        // ADMIN FLOW: Bypasses lead checks and rate limits
        // ===============================================

        const result = await clientRequirementsFlow({
            userMessage: message,
            history: history,
            currentRequirements: currentRequirements,
            attachments: attachments
        });

        return { success: true, data: result };
    } catch (error) {
        console.error("Error processing admin message:", error);
        return { success: false, error: "Failed to process message" };
    }
}
