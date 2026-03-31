import { EnrollmentRepository } from '../../domain/marketing.repository';
import { Enrollment, ABTestVariant } from '../../domain/sequence';
import { getFirestore } from 'firebase-admin/firestore';

export class FirebaseEnrollmentRepository implements EnrollmentRepository {
    private get collectionName() {
        return process.env.NEXT_PUBLIC_USE_TEST_DB === 'true' ? 'test_marketing_enrollments' : 'marketing_enrollments';
    }

    private get db() {
        return getFirestore();
    }

    async save(enrollment: Enrollment): Promise<void> {
        const data = {
            id: enrollment.id,
            leadId: enrollment.leadId,
            sequenceId: enrollment.sequenceId,
            variant: enrollment.variant,
            currentStepIndex: enrollment.currentStepIndex,
            active: enrollment.active,
            enrolledAt: enrollment.enrolledAt.toISOString(),
            nextExecutionTime: enrollment.nextExecutionTime ? enrollment.nextExecutionTime.toISOString() : null,
            updatedAt: enrollment.updatedAt.toISOString(),
            openedAt: enrollment.openedAt ? enrollment.openedAt.toISOString() : null,
            context: enrollment.context || {}
        };
        await this.db.collection(this.collectionName).doc(enrollment.id).set(data, { merge: true });
    }

    async findById(id: string): Promise<Enrollment | null> {
        const doc = await this.db.collection(this.collectionName).doc(id).get();
        if (!doc.exists) return null;
        return this.mapToEntity(doc.data() as any);
    }

    async findByLeadId(leadId: string): Promise<Enrollment[]> {
        const snapshot = await this.db.collection(this.collectionName).where('leadId', '==', leadId).get();
        if (snapshot.empty) return [];
        return snapshot.docs.map(doc => this.mapToEntity(doc.data() as any));
    }

    async findDueEnrollments(until: Date): Promise<Enrollment[]> {
        const snapshot = await this.db.collection(this.collectionName)
            .where('active', '==', true)
            .where('nextExecutionTime', '<=', until.toISOString())
            .get();
        
        if (snapshot.empty) return [];
        return snapshot.docs.map(doc => this.mapToEntity(doc.data() as any));
    }

    private mapToEntity(data: any): Enrollment {
        return new Enrollment(
            data.id,
            data.leadId,
            data.sequenceId,
            data.variant as ABTestVariant,
            data.currentStepIndex,
            data.active,
            new Date(data.enrolledAt),
            data.nextExecutionTime ? new Date(data.nextExecutionTime) : null,
            new Date(data.updatedAt),
            data.openedAt ? new Date(data.openedAt) : null,
            data.context || {}
        );
    }
}
