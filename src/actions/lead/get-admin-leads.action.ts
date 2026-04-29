'use server';

import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';
import type {
    LeadIntakeSource,
    LeadProjectType,
    QualificationDecision,
} from '@/backend/lead/domain/lead';

export interface AdminLeadListItem {
    id: string;
    name: string;
    email: string;
    phone: string;
    address?: string;
    createdAt: string;
    isVerified: boolean;
    intake: {
        projectType: LeadProjectType;
        source: LeadIntakeSource;
        approxSquareMeters?: number;
        postalCode?: string;
        city?: string;
        timeline?: string;
        approxBudget?: number;
        imagesCount: number;
        suspicious: boolean;
        descriptionPreview: string;
    } | null;
    qualification: {
        decision: QualificationDecision;
        score: number;
        lowTrust?: boolean;
        lowTrustReasons?: string[];
    } | null;
}

export interface GetAdminLeadsFilters {
    decisions?: QualificationDecision[];
    sources?: LeadIntakeSource[];
    /** Fragmento de nombre/email para filtro client-side rudimentario. */
    textQuery?: string;
    /** Cuántos leads devolver (default 50). */
    limit?: number;
    /** Para paginación: número de leads a saltar antes de la página actual. */
    offset?: number;
}

export interface GetAdminLeadsResult {
    success: boolean;
    leads?: AdminLeadListItem[];
    error?: string;
}

function previewDescription(s: string | undefined, max = 140): string {
    if (!s) return '';
    const oneLine = s.replace(/\s+/g, ' ').trim();
    return oneLine.length > max ? oneLine.slice(0, max - 1) + '…' : oneLine;
}

export async function getAdminLeadsAction(
    filters: GetAdminLeadsFilters = {}
): Promise<GetAdminLeadsResult> {
    try {
        const repository = new FirestoreLeadRepository();
        const limit = filters.limit ?? 50;
        const offset = filters.offset ?? 0;

        // Sobre-fetch un poco para acomodar el filtrado en memoria.
        const fetchSize = filters.decisions || filters.sources || filters.textQuery
            ? Math.max(limit * 4, 200)
            : limit;
        const leads = await repository.findAll(fetchSize, offset);

        const decisions = filters.decisions ? new Set(filters.decisions) : null;
        const sources = filters.sources ? new Set(filters.sources) : null;
        const text = filters.textQuery?.toLowerCase().trim() || '';

        const items: AdminLeadListItem[] = leads
            .filter(lead => {
                if (decisions && !decisions.has(lead.qualification?.decision || 'review_required')) {
                    return false;
                }
                if (sources && !sources.has(lead.intake?.source || 'demo')) {
                    return false;
                }
                if (text) {
                    const hay =
                        lead.personalInfo.name.toLowerCase() +
                        ' ' +
                        lead.personalInfo.email.toLowerCase() +
                        ' ' +
                        (lead.personalInfo.phone || '').toLowerCase();
                    if (!hay.includes(text)) return false;
                }
                return true;
            })
            .slice(0, limit)
            .map(lead => ({
                id: lead.id,
                name: lead.personalInfo.name,
                email: lead.personalInfo.email,
                phone: lead.personalInfo.phone,
                address: lead.personalInfo.address,
                createdAt: lead.createdAt.toISOString(),
                isVerified: lead.verification.isVerified,
                intake: lead.intake
                    ? {
                          projectType: lead.intake.projectType,
                          source: lead.intake.source,
                          approxSquareMeters: lead.intake.approxSquareMeters,
                          postalCode: lead.intake.postalCode,
                          city: lead.intake.city,
                          timeline: lead.intake.timeline,
                          approxBudget: lead.intake.approxBudget,
                          imagesCount: (lead.intake.imageUrls || []).length,
                          suspicious: !!lead.intake.suspicious,
                          descriptionPreview: previewDescription(lead.intake.description),
                      }
                    : null,
                qualification: lead.qualification
                    ? {
                          decision: lead.qualification.decision,
                          score: lead.qualification.score,
                          lowTrust: lead.qualification.lowTrust,
                          lowTrustReasons: lead.qualification.lowTrustReasons,
                      }
                    : null,
            }));

        return { success: true, leads: items };
    } catch (error: any) {
        console.error('getAdminLeadsAction Error:', error);
        return { success: false, error: error?.message || 'Error al listar leads.' };
    }
}
