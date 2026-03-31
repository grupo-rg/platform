'use server';

import { publicDemoRequirementsFlow } from '@/backend/ai/public-demo/agents/public-demo.agent';
import { BudgetRequirement } from '@/backend/budget/domain/budget-requirements';
import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';
import dns from 'node:dns';

// Fix for Node.js Undici fetch taking 60s to timeout on Windows IPv6 networks
dns.setDefaultResultOrder('ipv4first');

export async function processClientMessageAction(
    leadId: string,
    message: string,
    history: any[],
    currentRequirements: Partial<BudgetRequirement>,
    attachments: string[] = []
) {
    try {
        const leadRepo = new FirestoreLeadRepository();
        const lead = await leadRepo.findById(leadId);

        if (!lead) {
            return { success: false, error: "Lead not found" };
        }

        // ===============================================
        // RATE LIMITING SECURITY
        // ===============================================
        if (lead.demoBudgetsGenerated >= 1) {
            return {
                success: true,
                data: {
                    response: `Hola ${lead.personalInfo.name.split(' ')[0]}, veo que ya has generado un presupuesto de demostración anteriormente. Para mantener el servicio ágil para todos los usuarios, la demo gratuita está limitada a 1 presupuesto por empresa. ¡Hablemos de tus necesidades reales en nuestra reunión!`,
                    updatedRequirements: currentRequirements,
                    isComplete: false,
                    isLimitReached: true
                }
            };
        }

        const result = await publicDemoRequirementsFlow({
            userMessage: message,
            history: history,
            currentRequirements: currentRequirements,
            attachments: attachments,
            leadContext: {
                personalInfo: lead.personalInfo,
                profile: lead.profile || undefined,
                preferences: lead.preferences
            }
        });

        return { success: true, data: result };
    } catch (error) {
        console.error("Error processing client message:", error);
        return { success: false, error: "Failed to process message" };
    }
}
