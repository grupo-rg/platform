'use server';

import { FirebaseDealRepository } from '@/backend/crm/infrastructure/persistence/firebase.deal.repository';
import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';
import { PipelineStage } from '@/backend/crm/domain/deal';
import type { QualificationDecision } from '@/backend/lead/domain/lead';

export interface KanbanDealCard {
    id: string;
    leadId: string;
    stage: PipelineStage;
    estimatedValue: number;
    createdAt: string;
    updatedAt: string;
    metadata: {
        meetUrl?: string;
        nextMeeting?: string;
    };
    lead: {
        name: string;
        email: string;
        phone?: string;
        projectType?: string;
        approxBudget?: number;
        city?: string;
        postalCode?: string;
        decision?: QualificationDecision;
        score?: number;
        suspicious?: boolean;
    } | null;
}

export interface GetDealsForKanbanResult {
    success: boolean;
    deals?: KanbanDealCard[];
    error?: string;
}

/**
 * Devuelve todos los deals enriquecidos con un snapshot del lead asociado
 * (nombre, email, datos del intake, qualification). El Kanban necesita
 * mostrar la ficha completa sin hacer N+1 fetches en cliente.
 */
export async function getDealsForKanbanAction(): Promise<GetDealsForKanbanResult> {
    try {
        const dealRepo = new FirebaseDealRepository();
        const leadRepo = new FirestoreLeadRepository();

        const deals = await dealRepo.findAll();
        if (deals.length === 0) {
            return { success: true, deals: [] };
        }

        // Cargamos los leads en paralelo (Firestore no tiene un `findIn` amigable
        // y el volumen del Kanban es manejable con N requests).
        const leadsById = new Map<string, Awaited<ReturnType<typeof leadRepo.findById>>>();
        await Promise.all(
            Array.from(new Set(deals.map(d => d.leadId))).map(async leadId => {
                const lead = await leadRepo.findById(leadId);
                leadsById.set(leadId, lead);
            })
        );

        const cards: KanbanDealCard[] = deals.map(d => {
            const lead = leadsById.get(d.leadId) || null;
            return {
                id: d.id,
                leadId: d.leadId,
                stage: d.stage,
                estimatedValue: d.estimatedValue,
                createdAt: d.createdAt.toISOString(),
                updatedAt: d.updatedAt.toISOString(),
                metadata: {
                    meetUrl: d.metadata?.meetUrl,
                    nextMeeting: d.metadata?.nextMeeting,
                },
                lead: lead
                    ? {
                          name: lead.personalInfo.name,
                          email: lead.personalInfo.email,
                          phone: lead.personalInfo.phone,
                          projectType: lead.intake?.projectType,
                          approxBudget: lead.intake?.approxBudget,
                          city: lead.intake?.city,
                          postalCode: lead.intake?.postalCode,
                          decision: lead.qualification?.decision,
                          score: lead.qualification?.score,
                          suspicious: lead.intake?.suspicious,
                      }
                    : null,
            };
        });

        return { success: true, deals: cards };
    } catch (error: any) {
        console.error('getDealsForKanbanAction Error:', error);
        return { success: false, error: error?.message || 'Error obteniendo deals' };
    }
}
