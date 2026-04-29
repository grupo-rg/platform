'use server';

import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import { BudgetClientData } from '@/components/budget-request/schema';
import { SubmitLeadIntakeUseCase } from '@/backend/lead/application/submit-lead-intake.use-case';
import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';
import {
    LeadIntakeSource,
    LeadProjectType,
    LeadQualityLevel,
    QualificationDecision,
} from '@/backend/lead/domain/lead';
import { sanitizeUserText } from '@/backend/shared/security/input-sanitizer';
import { checkRateLimit, RATE_LIMITS } from '@/backend/shared/security/rate-limiter';
import { getClientIdentity } from '@/backend/shared/security/client-identity';
import { logSecurityEvent } from '@/backend/shared/security/audit-log';

type FormType = 'renovation' | 'quick' | 'new_build';

const RENOVATION_TYPE_MAP: Record<string, LeadProjectType> = {
    bathroom: 'bathroom',
    bathrooms: 'bathroom',
    kitchen: 'kitchen',
    integral: 'integral',
    pool: 'pool',
    new_build: 'new_build',
};

function inferProjectType(formType: FormType, data: any): LeadProjectType {
    if (formType === 'new_build') return 'new_build';
    if (data?.renovationType && RENOVATION_TYPE_MAP[data.renovationType]) {
        return RENOVATION_TYPE_MAP[data.renovationType];
    }
    if (formType === 'renovation') return 'integral';
    return 'other';
}

function inferSource(formType: FormType): LeadIntakeSource {
    if (formType === 'new_build') return 'new_build_form';
    if (formType === 'quick') return 'quick_form';
    return 'detailed_form';
}

function pickArea(data: any): number | undefined {
    return (
        data?.squareMeters ??
        data?.buildingArea ??
        data?.totalAreaM2 ??
        data?.plotArea ??
        undefined
    );
}

export async function createBudgetAction(
    type: FormType,
    clientData: BudgetClientData
): Promise<{
    success: boolean;
    leadId?: string;
    decision?: QualificationDecision;
    error?: string;
}> {
    try {
        const data = clientData as any;
        const description = sanitizeUserText(String(data.description ?? ''), 5000);
        const name = sanitizeUserText(String(data.name ?? ''), 120).text;
        const email = String(data.email ?? '').trim();
        const phone = String(data.phone ?? '').trim();
        const address = data.address ? sanitizeUserText(String(data.address), 200).text : undefined;

        if (!email || !name) {
            return { success: false, error: 'Faltan datos obligatorios (nombre o email)' };
        }

        // Rate limit por IP+UA. Protege contra spam masivo desde un mismo cliente.
        const identity = await getClientIdentity();
        const rateLimit = await checkRateLimit('leadIntakeSubmit', identity, RATE_LIMITS.leadIntakeSubmit);
        if (!rateLimit.allowed) {
            await logSecurityEvent({
                type: 'rate_limit_exceeded',
                identity,
                action: 'leadIntakeSubmit',
                details: { retryAfterSeconds: rateLimit.retryAfterSeconds },
            });
            return {
                success: false,
                error: `Has enviado demasiadas solicitudes. Vuelve a intentarlo en ${Math.ceil(rateLimit.retryAfterSeconds / 60)} minutos.`,
            };
        }

        if (description.suspicious) {
            await logSecurityEvent({
                type: 'injection_pattern_detected',
                identity,
                action: 'leadIntakeSubmit',
                snippet: description.text,
                matched: description.matchedPatterns,
            });
        }

        // Snapshot crudo del formulario para que el admin vea exactamente lo
        // que el cliente rellenó (campos que no caben en el intake estructurado).
        // Excluimos imágenes (ya viven en intake.imageUrls) y archivos pesados.
        const { files: _files, ...rawSnapshot } = data;

        // Locale activo del visitante (next-intl). Se persiste en
        // lead.preferences.language para enviar futuros emails de
        // re-engagement / propuesta en su idioma.
        let language = 'es';
        try {
            language = await getLocale();
        } catch {
            // getLocale() lanza si la action no se invoca dentro de un
            // request con i18n configurado. Mantenemos el default 'es'.
        }

        const useCase = new SubmitLeadIntakeUseCase(new FirestoreLeadRepository());
        const result = await useCase.execute({
            name,
            email,
            phone,
            address,
            projectType: inferProjectType(type, data),
            description: description.text || `Solicitud ${type}`,
            source: inferSource(type),
            approxSquareMeters: pickArea(data),
            qualityLevel: data.quality as LeadQualityLevel | undefined,
            images: Array.isArray(data.files) ? data.files : [],
            suspicious: description.suspicious,
            contactMethod: 'email',
            language,
            rawFormData: rawSnapshot,
        });

        // El admin verá el lead en su inbox y disparará el motor de presupuesto
        // desde el dashboard (F2). Por eso aún no creamos un `Budget`.
        revalidatePath('/dashboard/leads');
        revalidatePath('/dashboard/admin/budgets');

        return {
            success: true,
            leadId: result.leadId,
            decision: result.decision,
        };
    } catch (error: any) {
        console.error('Error creating lead from public form:', error);
        return { success: false, error: error?.message || 'Failed to register request' };
    }
}
