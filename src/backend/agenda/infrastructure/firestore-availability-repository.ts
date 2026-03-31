import { AvailabilityRepository } from '../domain/availability-repository';
import { AvailabilityConfig, DaySchedule } from '../domain/availability-config';
import { getFirestore } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/backend/shared/infrastructure/firebase/admin-app';

export class FirestoreAvailabilityRepository implements AvailabilityRepository {
    private db;
    private collectionName = 'config';
    private docId = 'agenda-availability';

    constructor() {
        initFirebaseAdminApp();
        this.db = getFirestore();
    }

    private toDomain(doc: FirebaseFirestore.DocumentSnapshot): AvailabilityConfig {
        const data = doc.data();
        if (!data) return AvailabilityConfig.createDefault();

        const weekSchedule: Record<number, DaySchedule> = {};
        if (data.weekSchedule) {
            for (const [key, val] of Object.entries(data.weekSchedule)) {
                weekSchedule[Number(key)] = val as DaySchedule;
            }
        }

        return new AvailabilityConfig(
            doc.id,
            Object.keys(weekSchedule).length > 0 ? weekSchedule : AvailabilityConfig.createDefault().weekSchedule,
            data.slotDurationMinutes || 30,
            data.bufferMinutes || 0,
            data.updatedAt?.toDate() || new Date()
        );
    }

    private toPersistence(config: AvailabilityConfig): any {
        return {
            weekSchedule: config.weekSchedule,
            slotDurationMinutes: config.slotDurationMinutes,
            bufferMinutes: config.bufferMinutes,
            updatedAt: config.updatedAt
        };
    }

    async getConfig(): Promise<AvailabilityConfig> {
        const doc = await this.db.collection(this.collectionName).doc(this.docId).get();
        if (!doc.exists) {
            const defaultConfig = AvailabilityConfig.createDefault(this.docId);
            await this.save(defaultConfig);
            return defaultConfig;
        }
        return this.toDomain(doc);
    }

    async save(config: AvailabilityConfig): Promise<void> {
        await this.db.collection(this.collectionName).doc(this.docId).set(this.toPersistence(config), { merge: true });
    }

    async isSlotAvailable(date: Date, slot: string): Promise<boolean> {
        // En implementación real, se debe buscar en Firestore si hay colisiones con bookings activos
        // Para efectos de POC/Frontend flow, confirmaremos todo.
        return true; 
    }
}
