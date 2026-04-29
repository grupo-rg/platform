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
import { LeadCreatedEvent } from '../domain/events/lead-created.event';
import { EventDispatcher } from '@/backend/shared/events/event-dispatcher';
import { normalizeToPublicUrls } from '@/backend/shared/infrastructure/storage/upload-public-image';
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
    /** URLs ya subidas (cliente), o base64 (chat). Se normaliza a URLs estables. */
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
    /** Si el visitante ya pasó OTP, usamos su leadId directamente y saltamos la búsqueda por email. */
    existingLeadId?: string;
}

export interface SubmitLeadIntakeResult {
    leadId: string;
    decision: QualificationDecision;
    score: number;
    reasons: string[];
    isNewLead: boolean;
}

/**
 * Use case central para todas las solicitudes públicas (chat, formularios).
 *
 * 1. Sube imágenes a Storage si vienen como base64.
 * 2. Crea o reusa el Lead por email.
 * 3. Persiste el intake.
 * 4. Cualifica (provisional, F2 reemplaza esto).
 * 5. Despacha LeadCreatedEvent (listener envía email al admin si corresponde).
 */
export class SubmitLeadIntakeUseCase {
    constructor(private readonly leadRepository: LeadRepository) {}

    async execute(input: SubmitLeadIntakeInput): Promise<SubmitLeadIntakeResult> {
        // 1. Normalizar imágenes
        const imageUrls = input.images && input.images.length > 0
            ? await normalizeToPublicUrls(input.images, `leads/${input.email.replace(/[^a-zA-Z0-9.-]/g, '_')}`)
            : [];

        // 2. Resolver Lead: prioridad al ID verificado por OTP, luego por email,
        // y si ninguno existe, crear nuevo.
        let lead: Lead | null = null;
        if (input.existingLeadId) {
            lead = await this.leadRepository.findById(input.existingLeadId);
        }
        if (!lead) {
            lead = await this.leadRepository.findByEmail(input.email);
        }

        let isNewLead: boolean;

        if (lead) {
            isNewLead = false;
        } else {
            const personalInfo: PersonalInfo = {
                name: input.name,
                email: input.email,
                phone: input.phone,
                address: input.address,
            };
            lead = Lead.create(randomUUID(), personalInfo, {
                contactMethod: input.contactMethod || 'email',
                language: input.language || 'es',
            });
            isNewLead = true;
        }

        // 3. Persistir intake
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
        lead.setIntake(intake);

        // 4. Cualificación con reglas determinísticas
        const qualification = new QualifyLeadService().qualify(intake, input.email);
        lead.setQualification(qualification);

        // 5. Persistir
        await this.leadRepository.save(lead);

        // 6. Despachar evento (no bloquea si listener falla — Promise.allSettled interno)
        try {
            // Idempotente: protege cuando instrumentation.ts no haya corrido (e.g. tests, dev hot-reload)
            const { registerEventListeners } = await import('@/backend/shared/events/register-listeners');
            registerEventListeners();

            await EventDispatcher.getInstance().dispatch(
                new LeadCreatedEvent(
                    lead.id,
                    lead.personalInfo.name,
                    lead.personalInfo.email,
                    input.source,
                    qualification.decision,
                    qualification.score,
                    intake,
                    lead.preferences?.language
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
        };
    }
}
