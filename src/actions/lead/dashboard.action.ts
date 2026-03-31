'use server';

import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';

const leadRepo = new FirestoreLeadRepository();

export interface LeadTableRow {
    id: string;
    name: string;
    email: string;
    phone: string;
    isVerified: boolean;
    isProfiled: boolean;
    companyName: string | null;
    biggestPain: string | null;
    role: string | null;
    simultaneousProjects: string | null;
    createdAt: string;
}

/**
 * Get paginated leads for the dashboard table
 */
export async function getLeadsAction(limit: number = 50, offset: number = 0): Promise<LeadTableRow[]> {
    const leads = await leadRepo.findAll(limit, offset);

    return leads.map(lead => ({
        id: lead.id,
        name: lead.personalInfo.name,
        email: lead.personalInfo.email,
        phone: lead.personalInfo.phone,
        isVerified: lead.verification.isVerified,
        isProfiled: lead.profile?.completedAt != null,
        companyName: lead.profile?.companyName ?? null,
        biggestPain: Array.isArray(lead.profile?.biggestPain) ? lead.profile?.biggestPain.join(', ') : (lead.profile?.biggestPain as unknown as string ?? null),
        role: lead.profile?.role ?? null,
        simultaneousProjects: lead.profile?.simultaneousProjects ?? null,
        createdAt: lead.createdAt.toISOString()
    }));
}

/**
 * Get lead counts by status for dashboard stats
 */
export async function getLeadStatsAction(): Promise<{ verified: number; unverified: number; profiled: number }> {
    return leadRepo.countByStatus();
}

/**
 * Get full lead details by ID
 */
export async function getLeadByIdAction(id: string) {
    const lead = await leadRepo.findById(id);
    if (!lead) return null;
    return {
        id: lead.id,
        personalInfo: lead.personalInfo,
        preferences: lead.preferences,
        verification: lead.verification,
        profile: lead.profile,
        createdAt: lead.createdAt.toISOString(),
        updatedAt: lead.updatedAt.toISOString(),
        demoBudgetsGenerated: lead.demoBudgetsGenerated,
        demoPdfsDownloaded: lead.demoPdfsDownloaded,
    };
}

