import { ABTestVariant, CommunicationChannel, Sequence } from "../domain/sequence";
import { SequenceRepository, EnrollmentRepository } from "../domain/marketing.repository";
import { Enrollment } from "../domain/sequence";

export class EnrollLeadInSequenceUseCase {
    constructor(
        private sequenceRepository: SequenceRepository,
        private enrollmentRepository: EnrollmentRepository
    ) {}

    async execute(leadId: string, sequenceId: string, variant: ABTestVariant = 'A', contextData: Record<string, any> = {}): Promise<Enrollment> {
        const sequence = await this.sequenceRepository.findById(sequenceId);
        if (!sequence || !sequence.active) {
            throw new Error(`Sequence ${sequenceId} not found or is inactive`);
        }

        const existingEnrollments = await this.enrollmentRepository.findByLeadId(leadId);
        const alreadyEnrolled = existingEnrollments.some(e => e.sequenceId === sequenceId && e.active);
        
        if (alreadyEnrolled) {
            throw new Error(`Lead ${leadId} is already enrolled in sequence: ${sequenceId}`);
        }

        // We determine the first execution time based on the sequence step 0
        const firstStep = sequence.steps[0];
        let nextTime = new Date();
        if (firstStep && firstStep.dayOffset > 0) {
            nextTime.setDate(nextTime.getDate() + firstStep.dayOffset);
        }

        const enrollmentId = `enr_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        const enrollment = Enrollment.start(enrollmentId, leadId, sequenceId, variant, nextTime, contextData);

        await this.enrollmentRepository.save(enrollment);
        return enrollment;
    }
}
