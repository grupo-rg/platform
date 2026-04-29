'use server';

import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';
import { FirebaseDealRepository } from '@/backend/crm/infrastructure/persistence/firebase.deal.repository';
import { buildLeadBrief } from '@/backend/lead/application/build-lead-brief';
import type { LeadProjectType, QualificationDecision } from '@/backend/lead/domain/lead';

export interface LeadBannerInfo {
    name: string;
    email: string;
    projectType?: LeadProjectType;
    city?: string;
    postalCode?: string;
    approxSquareMeters?: number;
    decision?: QualificationDecision;
    score?: number;
}

/**
 * Devuelve un brief narrativo del lead listo para inyectar como `initialPrompt`
 * del wizard admin, junto con datos resumidos para mostrar un banner visual en
 * el header del wizard ("Refinando para Carlos · Reforma de baño · Palma").
 *
 * Si se pasa `dealId`, el brief se construye con el `intakeSnapshot` de ese
 * deal concreto (cada deal puede ser una obra distinta del mismo cliente).
 * Sin `dealId` se usa el último intake del lead.
 */
export async function getLeadBriefAction(leadId: string, dealId?: string): Promise<{
    success: boolean;
    brief?: string;
    banner?: LeadBannerInfo;
    error?: string;
}> {
    try {
        if (!leadId) return { success: false, error: 'Lead ID no proporcionado' };
        const repo = new FirestoreLeadRepository();
        const lead = await repo.findById(leadId);
        if (!lead) return { success: false, error: 'Lead no encontrado' };

        // Si el admin está mirando un deal específico, construimos un lead
        // "virtual" con el intake snapshot de ese deal, manteniendo el resto
        // del lead intacto. Así el brief es coherente con la oportunidad
        // seleccionada y no con el último intake del lead.
        if (dealId) {
            const dealRepo = new FirebaseDealRepository();
            const deal = await dealRepo.findById(dealId);
            const snap = deal?.metadata?.intakeSnapshot;
            if (snap) {
                (lead as any).intake = {
                    ...(lead.intake || {}),
                    ...snap,
                    submittedAt: snap.submittedAt
                        ? new Date(snap.submittedAt)
                        : lead.intake?.submittedAt || new Date(),
                };
            }
        }

        return {
            success: true,
            brief: buildLeadBrief(lead),
            banner: {
                name: lead.personalInfo.name,
                email: lead.personalInfo.email,
                projectType: lead.intake?.projectType,
                city: lead.intake?.city,
                postalCode: lead.intake?.postalCode,
                approxSquareMeters: lead.intake?.approxSquareMeters,
                decision: lead.qualification?.decision,
                score: lead.qualification?.score,
            },
        };
    } catch (error: any) {
        console.error('getLeadBriefAction Error:', error);
        return { success: false, error: error?.message || 'Error obteniendo brief' };
    }
}
