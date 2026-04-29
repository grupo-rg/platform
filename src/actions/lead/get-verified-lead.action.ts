'use server';

import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';

export interface VerifiedLeadDTO {
    id: string;
    name: string;
    email: string;
    phone: string;
    address?: string;
    isVerified: boolean;
}

/**
 * Devuelve el snapshot de los campos del lead que un formulario público necesita
 * para precargar después de pasar el OTP. Sólo expone datos personales —
 * intake/qualification se obtienen por otras vías.
 *
 * Se usa desde `useVerifiedLead()` en cliente. Devuelve null si el lead no
 * existe (e.g. localStorage stale apuntando a un lead borrado en producción).
 */
export async function getVerifiedLeadAction(
    leadId: string
): Promise<{ success: boolean; lead?: VerifiedLeadDTO | null; error?: string }> {
    try {
        if (!leadId) return { success: true, lead: null };
        const repo = new FirestoreLeadRepository();
        const lead = await repo.findById(leadId);
        if (!lead) return { success: true, lead: null };

        return {
            success: true,
            lead: {
                id: lead.id,
                name: lead.personalInfo.name,
                email: lead.personalInfo.email,
                phone: lead.personalInfo.phone,
                address: lead.personalInfo.address,
                isVerified: lead.verification.isVerified,
            },
        };
    } catch (error: any) {
        console.error('getVerifiedLeadAction Error:', error);
        return { success: false, error: error?.message || 'Error obteniendo lead' };
    }
}
