import { EnrollmentRepository, TaskQueuePort } from "../domain/marketing.repository";

export class TriggerSequencesUseCase {
    constructor(
        private enrollmentRepo: EnrollmentRepository,
        private taskQueue: TaskQueuePort
    ) {}

    async execute(): Promise<number> {
        const now = new Date();
        const dueEnrollments = await this.enrollmentRepo.findDueEnrollments(now);

        console.log(`[Cron Trigger] Detectados ${dueEnrollments.length} enrollments atrasados. Apilando en Cloud Tasks...`);
        
        for (const enrollment of dueEnrollments) {
            await this.taskQueue.enqueueSequenceProcessing(enrollment.id);
        }

        return dueEnrollments.length;
    }
}
