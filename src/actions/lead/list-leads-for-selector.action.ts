'use server';

import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';

export interface LeadSelectorItem {
    id: string;
    name: string;
    email: string;
    phone: string;
    address?: string;
    nif?: string;
    companyName?: string;
    billingAddress?: string;
    billingCity?: string;
    billingPostalCode?: string;
    billingProvince?: string;
    billingCountry?: string;
}

export interface ListLeadsForSelectorResult {
    success: boolean;
    leads?: LeadSelectorItem[];
    error?: string;
}

/**
 * Versión ligera de la lista de leads pensada para combobox/autocomplete. Solo
 * devuelve los campos necesarios para identificar al cliente y rellenar el
 * `clientSnapshot` de Project sin tener que hacer un round-trip extra.
 */
export async function listLeadsForSelectorAction(
    options: { limit?: number; textQuery?: string } = {}
): Promise<ListLeadsForSelectorResult> {
    try {
        const repository = new FirestoreLeadRepository();
        const limit = options.limit ?? 100;
        const leads = await repository.findAll(limit, 0);

        const text = options.textQuery?.toLowerCase().trim() || '';

        const items: LeadSelectorItem[] = leads
            .filter(lead => {
                if (!text) return true;
                const hay = [
                    lead.personalInfo.name,
                    lead.personalInfo.email,
                    lead.personalInfo.phone,
                    lead.personalInfo.companyName || '',
                    lead.personalInfo.nif || '',
                ].join(' ').toLowerCase();
                return hay.includes(text);
            })
            .map(lead => ({
                id: lead.id,
                name: lead.personalInfo.name,
                email: lead.personalInfo.email,
                phone: lead.personalInfo.phone,
                address: lead.personalInfo.address,
                nif: lead.personalInfo.nif,
                companyName: lead.personalInfo.companyName,
                billingAddress: lead.personalInfo.billingAddress,
                billingCity: lead.personalInfo.billingCity,
                billingPostalCode: lead.personalInfo.billingPostalCode,
                billingProvince: lead.personalInfo.billingProvince,
                billingCountry: lead.personalInfo.billingCountry,
            }));

        return { success: true, leads: items };
    } catch (error: any) {
        console.error('listLeadsForSelectorAction Error:', error);
        return { success: false, error: error?.message || 'Error al listar clientes.' };
    }
}
