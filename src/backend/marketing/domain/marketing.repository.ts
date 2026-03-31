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

