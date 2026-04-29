import { CompanyConfig, CompanyConfigRepository, DEFAULT_COMPANY_CONFIG } from '../domain/company-config';
import { getFirestore } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/backend/shared/infrastructure/firebase/admin-app';

export class FirestoreCompanyConfigRepository implements CompanyConfigRepository {
    private db;

    constructor() {
        initFirebaseAdminApp();
        this.db = getFirestore();
    }

    async getConfig(): Promise<CompanyConfig> {
        const docRef = this.db.collection('platform').doc(DEFAULT_COMPANY_CONFIG.id);
        const docSnap = await docRef.get();

        if (!docSnap.exists) {
            return DEFAULT_COMPANY_CONFIG;
        }

        const data = docSnap.data();

        return {
            ...DEFAULT_COMPANY_CONFIG,
            ...data,
            id: DEFAULT_COMPANY_CONFIG.id,
            updatedAt: data?.updatedAt?.toDate?.() || new Date(),
        } as CompanyConfig;
    }

    async saveConfig(config: CompanyConfig): Promise<void> {
        const docRef = this.db.collection('platform').doc(config.id);
        await docRef.set({
            ...config,
            updatedAt: new Date(),
        }, { merge: true });
    }
}
