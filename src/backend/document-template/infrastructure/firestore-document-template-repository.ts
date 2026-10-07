import { adminFirestore } from '@/backend/shared/infrastructure/firebase/admin-app';
import type { DocumentTemplate } from '../domain/document-template';
import type { DocumentTemplateRepository } from '../application/document-template-service';

/**
 * Colección `document_templates`. Colección pequeña gestionada por admin →
 * "cargar todas y resolver en memoria". Timestamps como ISO strings.
 * Sin gates de auth: el control de acceso vive en las server actions.
 */
export class FirestoreDocumentTemplateRepository implements DocumentTemplateRepository {
    private get collection() {
        return adminFirestore.collection('document_templates');
    }

    newId(): string {
        return this.collection.doc().id;
    }

    async listAll(): Promise<DocumentTemplate[]> {
        const snap = await this.collection.get();
        return snap.docs.map((d) => ({ ...(d.data() as DocumentTemplate), id: d.id }));
    }

    async get(id: string): Promise<DocumentTemplate | null> {
        const snap = await this.collection.doc(id).get();
        return snap.exists ? ({ ...(snap.data() as DocumentTemplate), id: snap.id }) : null;
    }

    async save(template: DocumentTemplate): Promise<void> {
        // Firestore no acepta `undefined`: limpiamos claves opcionales vacías.
        const clean = JSON.parse(JSON.stringify(template));
        await this.collection.doc(template.id).set(clean);
    }

    async setDefaultFlags(updates: Array<{ id: string; isDefault: boolean }>): Promise<void> {
        if (updates.length === 0) return;
        const batch = adminFirestore.batch();
        const now = new Date().toISOString();
        for (const u of updates) {
            batch.update(this.collection.doc(u.id), { isDefault: u.isDefault, updatedAt: now });
        }
        await batch.commit();
    }

    async delete(id: string): Promise<void> {
        await this.collection.doc(id).delete();
    }
}
