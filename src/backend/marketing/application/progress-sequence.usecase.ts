import { SequenceRepository, EnrollmentRepository } from "../domain/marketing.repository";
import { MessagingService } from "./messaging.service";
import { LeadRepository } from "../../lead/domain/lead-repository";

export class ProgressSequenceUseCase {
    constructor(
        private sequenceRepository: SequenceRepository,
        private enrollmentRepository: EnrollmentRepository,
        private leadRepository: LeadRepository,
        private messagingService: MessagingService
    ) {}

    // Refactorización: Ahora solo procesa 1 solo enrollment dictado por el Worker de GCP
    async execute(enrollmentId: string): Promise<void> {
        try {
            const enrollment = await this.enrollmentRepository.findById(enrollmentId);
            if (!enrollment) {
                console.warn(`[Worker] Enrollment ${enrollmentId} descartado (no existe).`);
                return;
            }

            const sequence = await this.sequenceRepository.findById(enrollment.sequenceId);
            
            if (!sequence || !sequence.active) {
                enrollment.complete();
                await this.enrollmentRepository.save(enrollment);
                return;
            }

            const lead = await this.leadRepository.findById(enrollment.leadId);
            if (!lead) {
                console.warn(`[Worker] Lead ${enrollment.leadId} no encontrado, omitiendo.`);
                return;
            }

            const currentStep = sequence.steps[enrollment.currentStepIndex];
            
            if (currentStep && (currentStep.variantTarget === enrollment.variant || currentStep.variantTarget === 'CONTROL')) {
                
                const leadVars: Record<string, string> = {
                    name: lead.personalInfo?.name || 'Cliente',
                    email: lead.personalInfo?.email || '',
                    company: lead.profile?.companyName || 'tu empresa',
                    pains: (lead.profile?.biggestPain || []).join(', '),
                    stack: (lead.profile?.currentStack || []).join(', '),
                    role: lead.profile?.role || 'profesional de la construcción',
                    enrollmentId: enrollment.id,
                    ...(enrollment.context || {})
                };

                console.log(`[Worker] Disparando ${currentStep.channel} para ${lead.personalInfo.email}, Variante [${enrollment.variant}] usando Gemini...`);

                if (currentStep.channel === 'EMAIL') {
                    await this.messagingService.sendEmail(enrollment.leadId, currentStep.templateId, leadVars);
                } else if (currentStep.channel === 'WHATSAPP') {
                    await this.messagingService.sendWhatsApp(lead.personalInfo.phone || '+34000000000', currentStep.templateId, leadVars); 
                }
            }

            // Mover al siguiente bloque
            const nextStepIndex = enrollment.currentStepIndex + 1;
            const nextStep = sequence.steps[nextStepIndex];

            if (nextStep) {
                const nextTime = new Date();
                nextTime.setDate(nextTime.getDate() + nextStep.dayOffset);
                enrollment.advanceToStep(nextStepIndex, nextTime);
            } else {
                enrollment.complete();
            }

            await this.enrollmentRepository.save(enrollment);
            console.log(`[Worker] Enrollment ${enrollment.id} progresado correctamente.`);

        } catch (error) {
            console.error(`[Worker] Error crítico procesando enrollment ${enrollmentId}:`, error);
        }
    }
}
