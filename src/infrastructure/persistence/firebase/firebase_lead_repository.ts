import { Lead } from '../../../domain/marketing/leads/entity/lead';
import { ILeadRepository } from '../../../domain/marketing/leads/repository/i_lead_repository';
import { LeadEmail } from '../../../domain/marketing/leads/value_objects/lead_email';
import { LeadStatus } from '../../../domain/marketing/leads/value_objects/lead_status';
// import { getFirestore } from 'firebase-admin/firestore'; 
// Assumes Firebase Admin DB is available or injected.

export class FirebaseLeadRepository implements ILeadRepository {
    // private db = getFirestore();
    private collectionPath = 'marketing_leads';

    public async save(lead: Lead): Promise<void> {
        // const docRef = this.db.collection(this.collectionPath).doc(lead.id);
        const data = {
            id: lead.id,
            email: lead.email.value,
            source: lead.source,
            companyProfile: lead.companyProfile || null,
            status: lead.status.value,
            createdAt: lead.createdAt.toISOString(),
            updatedAt: lead.updatedAt.toISOString(),
        };
        // await docRef.set(data, { merge: true });
        console.log(`[Firestore Mock] Saved Lead ${lead.id}`, data);
    }

    public async findById(id: string): Promise<Lead | null> {
        // const doc = await this.db.collection(this.collectionPath).doc(id).get();
        // if (!doc.exists) return null;
        // const data = doc.data();
        // Reconstruct Lead from data...
        console.log(`[Firestore Mock] Find Lead by ID ${id}`);
        return null;
    }

    public async findByEmail(email: string): Promise<Lead | null> {
        // const snapshot = await this.db.collection(this.collectionPath).where('email', '==', email).limit(1).get();
        // if (snapshot.empty) return null;
        console.log(`[Firestore Mock] Find Lead by email ${email}`);
        return null;
    }
}
