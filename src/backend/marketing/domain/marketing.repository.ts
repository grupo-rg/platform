import { Sequence, Enrollment } from "./sequence";

export interface SequenceRepository {
    save(sequence: Sequence): Promise<void>;
    findById(id: string): Promise<Sequence | null>;
    findAllActive(): Promise<Sequence[]>;
}

export interface EnrollmentRepository {
    save(enrollment: Enrollment): Promise<void>;
    findById(id: string): Promise<Enrollment | null>;
    findByLeadId(leadId: string): Promise<Enrollment[]>;
    
    /**
     * Devuelve todas las suscripciones activas cuya fecha de próxima ejecución 
     * ya se ha cumplido o es anterior a la fecha proporcionada.
     */
    findDueEnrollments(until: Date): Promise<Enrollment[]>;
}

export interface TaskQueuePort {
    enqueueSequenceProcessing(enrollmentId: string): Promise<void>;
}

/**
 * Puerto mínimo para envío de email transaccional one-shot. Lo consumen
 * use cases cross-módulo (CRM/agenda/marketing/blog) que necesitan
 * notificar a una dirección concreta sin pasar por el flujo de templates +
 * lead-lookup que usa `MessagingService.sendEmail(leadId, templateId, …)`.
 * Implementación actual: `ResendEmailProvider.sendDirectEmail`.
 */
export interface EmailProviderPort {
    sendDirectEmail(to: string, subject: string, htmlBody: string): Promise<void>;
}

