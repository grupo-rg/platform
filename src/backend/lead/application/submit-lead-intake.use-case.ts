import 'server-only';
import { randomUUID } from 'crypto';
import { LeadRepository } from '../domain/lead-repository';
import {
    Lead,
    LeadIntake,
    LeadIntakeSource,
    LeadProjectType,
    LeadQualityLevel,
    LeadTimeline,
    PersonalInfo,
    QualificationDecision,
} from '../domain/lead';
import type { LeadConsent } from '../domain/lead-consent';
import { LeadCreatedEvent } from '../domain/events/lead-created.event';
import { EventDispatcher } from '@/backend/shared/events/event-dispatcher';
import { normalizeLeadAttachments } from '@/backend/lead/infrastructure/lead-uploads';
import { QualifyLeadService } from './qualify-lead.service';

export interface SubmitLeadIntakeInput {
    name: string;
    email: string;
    phone: string;
    address?: string;
    projectType: LeadProjectType;
    description: string;
    source: LeadIntakeSource;
    approxSquareMeters?: number;
    postalCode?: string;
    city?: string;
    approxBudget?: number;
    timeline?: LeadTimeline;
    qualityLevel?: LeadQualityLevel;
    /**
     * Adjuntos: base64 (chat) o referencias privadas `gs://…/lead_uploads/…`
     * (formularios, devueltas por `uploadLeadAttachmentAction`). Las URLs
     * http(s) arbitrarias se descartan.
     */
    images?: string[];
    /** Marcado por sanitizer si detectó intentos de injection. */
    suspicious?: boolean;
    /** Idioma del visitante (next-intl locale). */
    language?: string;
    /** Método preferido de contacto. */
    contactMethod?: 'whatsapp' | 'email' | 'phone';
    /** Snapshot crudo del formulario (sólo para forms, no chat). */
    rawFormData?: Record<string, any>;
    /** Sesión de chat público temporal (sólo si source==='chat_public'). */
    chatSessionId?: string;
    /**
     * leadId de CONFIANZA: el de la cookie firmada `rg_lead_session`. Nunca
     * un valor enviado por el navegador.
     */
    sessionLeadId?: string;
    /** Consentimientos declarados en esta solicitud. */
    consents?: LeadConsent[];
}

export interface SubmitLeadIntakeResult {
    /**
     * Lead al que se asoció la solicitud. Si `identityUnverified=true` es el
     * id de un lead AJENO a la sesión: NO debe devolverse al navegador.
     */
    leadId: string;
    decision: QualificationDecision;
    score: number;
    reasons: string[];
    isNewLead: boolean;
    /** true → email existente sin sesión verificada: lead no modificado. */
    identityUnverified: boolean;
    /** true → el llamador puede emitir una sesión `v=0` para este lead (lo acaba de crear este navegador). */
    canGrantOwnerSession: boolean;
}

/**
 * Use case central para todas las solicitudes públicas (chat, formularios).
 *
 * Resolución de identidad:
 *  1. Si hay `sessionLeadId` (cookie firmada) → se usa ese lead.
 *  2. Si no, y el email NO existe → se crea un lead nuevo (propiedad de
 *     este navegador: el llamador puede emitir sesión `v=0`).
 *  3. Si no, y el email YA existe → NO se toca el lead existente (ni
 *     intake, ni cualificación, ni consentimientos): la solicitud viaja en
 *     el `LeadCreatedEvent` con `identityUnverified=true`, el CRM crea un
 *     Deal marcado como no verificado y el admin decide. Antes cualquiera
 *     sobrescribía el intake de otro cliente conociendo su email.
 */
export class SubmitLeadIntakeUseCase {
    constructor(private readonly leadRepository: LeadRepository) {}

    async execute(input: SubmitLeadIntakeInput): Promise<SubmitLeadIntakeResult> {
        const email = String(input.email || '').trim();

        // 1. Resolver Lead
        let lead: Lead | null = null;
        let isNewLead = false;
        let identityUnverified = false;

        if (input.sessionLeadId) {
            lead = await this.leadRepository.findById(input.sessionLeadId);
        }
        if (!lead) {
            const existing = email ? await this.leadRepository.findByEmail(email) : null;
            if (existing) {
                lead = existing;
                identityUnverified = true;
            } else {
                const personalInfo: PersonalInfo = {
                    name: input.name,
                    email: email.toLowerCase(),
                    phone: input.phone,
                    address: input.address,
                };
                lead = Lead.create(randomUUID(), personalInfo, {
                    contactMethod: input.contactMethod || 'email',
                    language: input.language || 'es',
                });
                isNewLead = true;
            }
        }

        // 2. Adjuntos a almacenamiento privado (sin email en la ruta).
        const owner = identityUnverified
            ? `u-${input.chatSessionId || randomUUID()}`
            : lead.id;
        const imageUrls = input.images && input.images.length > 0
            ? await normalizeLeadAttachments(input.images, owner, { allowPdf: true, allowVideo: true })
            : [];

        // 3. Intake
        const intake: LeadIntake = {
            projectType: input.projectType,
            description: input.description,
            source: input.source,
            approxSquareMeters: input.approxSquareMeters,
            postalCode: input.postalCode,
            city: input.city,
            approxBudget: input.approxBudget,
            timeline: input.timeline,
            qualityLevel: input.qualityLevel,
            imageUrls,
            suspicious: input.suspicious,
            submittedAt: new Date(),
            rawFormData: input.rawFormData,
            chatSessionId: input.chatSessionId,
        };

        // 4. Cualificación con reglas determinísticas
        const qualification = new QualifyLeadService().qualify(intake, email);

        // 5. Persistir SÓLO si el lead es de esta sesión o nuevo.
        if (!identityUnverified) {
            lead.setIntake(intake);
            lead.setQualification(qualification);
            if (input.consents && input.consents.length > 0) lead.recordConsents(input.consents);
            await this.leadRepository.save(lead);
        }

        // 6. Despachar evento (no bloquea si listener falla)
        try {
            const { registerEventListeners } = await import('@/backend/shared/events/register-listeners');
            registerEventListeners();

            await EventDispatcher.getInstance().dispatch(
                new LeadCreatedEvent(
                    lead.id,
                    // En el caso no verificado, el nombre es el DECLARADO (no el del lead).
                    identityUnverified ? input.name : lead.personalInfo.name,
                    lead.personalInfo.email,
                    input.source,
                    qualification.decision,
                    qualification.score,
                    intake,
                    input.language || lead.preferences?.language,
                    identityUnverified,
                    input.consents
                )
            );
        } catch (err) {
            console.error('[SubmitLeadIntake] Falló dispatch de LeadCreatedEvent:', err);
        }

        return {
            leadId: lead.id,
            decision: qualification.decision,
            score: qualification.score,
            reasons: qualification.reasons,
            isNewLead,
            identityUnverified,
            canGrantOwnerSession: isNewLead,
        };
    }
}
