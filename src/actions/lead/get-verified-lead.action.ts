'use server';

import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';
import { clearLeadSession, getLeadSession } from '@/backend/lead/infrastructure/lead-session';

export interface VerifiedLeadDTO {
    id: string;
    name: string;
    email: string;
    phone: string;
    address?: string;
    isVerified: boolean;
}

/**
 * Devuelve los datos de contacto del lead de la SESIÓN (cookie httpOnly
 * firmada emitida tras verificar el OTP), para precargar formularios.
 *
 * Ya no acepta `leadId` del navegador (antes devolvía nombre/email/teléfono
 * de cualquier leadId → IDOR). Sólo responde con datos personales si la
 * sesión es de identidad verificada (`v=1`).
 */
export async function getVerifiedLeadAction(): Promise<{
    success: boolean;
    lead?: VerifiedLeadDTO | null;
    error?: string;
}> {
    try {
        const session = await getLeadSession();
        if (!session || !session.verified) return { success: true, lead: null };

        const repo = new FirestoreLeadRepository();
        const lead = await repo.findById(session.leadId);
        if (!lead) {
            await clearLeadSession();
            return { success: true, lead: null };
        }

        return {
            success: true,
            lead: {
                id: lead.id,
                name: lead.personalInfo.name,
                email: lead.personalInfo.email,
                phone: lead.personalInfo.phone,
                address: lead.personalInfo.address,
                isVerified: true,
            },
        };
    } catch (error: any) {
        console.error('getVerifiedLeadAction Error:', error);
        return { success: false, error: 'Error obteniendo lead' };
    }
}
