'use server';

import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';
import { BudgetRepositoryFirestore } from '@/backend/budget/infrastructure/budget-repository-firestore';
import { FirebaseDealRepository } from '@/backend/crm/infrastructure/persistence/firebase.deal.repository';
import type {
    LeadIntakeSource,
    LeadProjectType,
    LeadTimeline,
    QualificationDecision,
} from '@/backend/lead/domain/lead';

export interface AdminLeadDetail {
    id: string;
    createdAt: string;
    updatedAt: string;
    personalInfo: {
        name: string;
        email: string;
        phone: string;
        address?: string;
    };
    preferences: {
        contactMethod: string;
        language: string;
    };
    verification: {
        isVerified: boolean;
        verifiedAt: string | null;
    };
    intake: {
        projectType: LeadProjectType;
        source: LeadIntakeSource;
        description: string;
        approxSquareMeters?: number;
        postalCode?: string;
        city?: string;
        approxBudget?: number;
        timeline?: LeadTimeline;
        qualityLevel?: string;
        imageUrls: string[];
        suspicious: boolean;
        submittedAt: string;
        rawFormData?: Record<string, any>;
        chatSessionId?: string;
    } | null;
    qualification: {
        decision: QualificationDecision;
        score: number;
        reasons: string[];
        rules: string[];
        evaluatedAt: string;
        evaluatedBy: string;
        lowTrust?: boolean;
        lowTrustReasons?: string[];
        scoreHistory?: {
            eventId: string;
            reason: string;
            delta: number;
            score: number;
            timestamp: string;
        }[];
    } | null;
    associatedBudgets: {
        id: string;
        status: string;
        total: number;
        createdAt: string;
        source?: string;
    }[];
    /**
     * Todas las oportunidades (Deals) generadas por este lead. Cada solicitud
     * cualificable crea un Deal nuevo con su propio intake snapshot, incluso
     * si vienen del mismo cliente — pueden ser obras distintas.
     *
     * El `intakeSnapshot` replica el shape del `intake` principal del lead
     * para que la UI pueda mostrar la "solicitud" del deal seleccionado en
     * vez del último intake del lead (ver `?dealId=` en la página).
     */
    associatedDeals: {
        id: string;
        stage: string;
        estimatedValue: number;
        createdAt: string;
        updatedAt: string;
        intakeSnapshot?: {
            projectType?: string;
            source?: string;
            description?: string;
            approxSquareMeters?: number;
            qualityLevel?: string;
            postalCode?: string;
            city?: string;
            approxBudget?: number;
            timeline?: string;
            imageUrls?: string[];
            suspicious?: boolean;
            submittedAt?: string;
            rawFormData?: Record<string, any>;
        };
    }[];
}

export async function getAdminLeadDetailAction(leadId: string): Promise<{
    success: boolean;
    lead?: AdminLeadDetail;
    error?: string;
}> {
    try {
        const leadRepo = new FirestoreLeadRepository();
        const budgetRepo = new BudgetRepositoryFirestore();
        const dealRepo = new FirebaseDealRepository();

        const lead = await leadRepo.findById(leadId);
        if (!lead) return { success: false, error: 'Lead no encontrado' };

        const [budgets, deals] = await Promise.all([
            budgetRepo.findByLeadId(leadId),
            dealRepo.findAllByLeadId(leadId),
        ]);

        const detail: AdminLeadDetail = {
            id: lead.id,
            createdAt: lead.createdAt.toISOString(),
            updatedAt: lead.updatedAt.toISOString(),
            personalInfo: {
                name: lead.personalInfo.name,
                email: lead.personalInfo.email,
                phone: lead.personalInfo.phone,
                address: lead.personalInfo.address,
            },
            preferences: {
                contactMethod: lead.preferences.contactMethod,
                language: lead.preferences.language,
            },
            verification: {
                isVerified: lead.verification.isVerified,
                verifiedAt: lead.verification.verifiedAt?.toISOString() || null,
            },
            intake: lead.intake
                ? {
                      projectType: lead.intake.projectType,
                      source: lead.intake.source,
                      description: lead.intake.description,
                      approxSquareMeters: lead.intake.approxSquareMeters,
                      postalCode: lead.intake.postalCode,
                      city: lead.intake.city,
                      approxBudget: lead.intake.approxBudget,
                      timeline: lead.intake.timeline,
                      qualityLevel: lead.intake.qualityLevel,
                      imageUrls: lead.intake.imageUrls || [],
                      suspicious: !!lead.intake.suspicious,
                      submittedAt: lead.intake.submittedAt.toISOString(),
                      rawFormData: lead.intake.rawFormData,
                      chatSessionId: lead.intake.chatSessionId,
                  }
                : null,
            qualification: lead.qualification
                ? {
                      decision: lead.qualification.decision,
                      score: lead.qualification.score,
                      reasons: lead.qualification.reasons || [],
                      rules: lead.qualification.rules || [],
                      evaluatedAt: lead.qualification.evaluatedAt.toISOString(),
                      evaluatedBy: lead.qualification.evaluatedBy,
                      lowTrust: lead.qualification.lowTrust,
                      lowTrustReasons: lead.qualification.lowTrustReasons,
                      scoreHistory: (lead.qualification.scoreHistory || []).map(h => ({
                          eventId: h.eventId,
                          reason: h.reason,
                          delta: h.delta,
                          score: h.score,
                          timestamp: h.timestamp.toISOString(),
                      })),
                  }
                : null,
            associatedBudgets: budgets.map(b => ({
                id: b.id,
                status: b.status,
                total: b.costBreakdown?.total ?? b.totalEstimated ?? 0,
                createdAt: b.createdAt.toISOString(),
                source: b.source,
            })),
            associatedDeals: deals.map(d => {
                const snap = d.metadata?.intakeSnapshot;
                return {
                    id: d.id,
                    stage: d.stage,
                    estimatedValue: d.estimatedValue || 0,
                    createdAt: d.createdAt.toISOString(),
                    updatedAt: d.updatedAt.toISOString(),
                    intakeSnapshot: snap
                        ? {
                              projectType: snap.projectType,
                              source: snap.source,
                              description: snap.description,
                              approxSquareMeters: snap.approxSquareMeters,
                              qualityLevel: snap.qualityLevel,
                              postalCode: snap.postalCode,
                              city: snap.city,
                              approxBudget: snap.approxBudget,
                              timeline: snap.timeline,
                              imageUrls: Array.isArray(snap.imageUrls) ? snap.imageUrls : [],
                              suspicious: !!snap.suspicious,
                              submittedAt: snap.submittedAt,
                              rawFormData: snap.rawFormData,
                          }
                        : undefined,
                };
            }),
        };

        return { success: true, lead: detail };
    } catch (error: any) {
        console.error('getAdminLeadDetailAction Error:', error);
        return { success: false, error: error?.message || 'Error obteniendo detalle' };
    }
}
