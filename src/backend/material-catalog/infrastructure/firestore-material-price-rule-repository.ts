
import { adminFirestore } from '@/backend/shared/infrastructure/firebase/admin-app';
import { MaterialPriceRule } from '@/backend/material-catalog/domain/material-price-rule';

/**
 * Repositorio Firestore de reglas de ajuste de precio de materiales.
 *
 * Colección `material_price_rules`. La colección es PEQUEÑA (gestionada por
 * admin) → el patrón es "cargar todas y resolver en memoria" (ver
 * `resolveMaterialFactor`), NO query por material.
 *
 * Sin gates de auth aquí (usa admin SDK): el control de acceso vive en las
 * server actions / API routes que llaman a este repo (otra wave).
 */
export class FirestoreMaterialPriceRuleRepository {
    private collectionName = 'material_price_rules';

    private get collection() {
        return adminFirestore.collection(this.collectionName);
    }

    /** Solo las reglas activas — es lo que consume el resolver. */
    async listActive(): Promise<MaterialPriceRule[]> {
        const snapshot = await this.collection.where('active', '==', true).get();
        return snapshot.docs.map((doc) => doc.data() as MaterialPriceRule);
    }

    /** Todas las reglas (activas e inactivas) — para gestión en la UI de admin. */
    async listAll(): Promise<MaterialPriceRule[]> {
        const snapshot = await this.collection.get();
        return snapshot.docs.map((doc) => doc.data() as MaterialPriceRule);
    }

    /**
     * Crea una regla. Genera el id si no viene, sella `createdAt`/`updatedAt`
     * (ISO strings) y devuelve el id del documento.
     */
    async create(rule: Omit<MaterialPriceRule, 'id'> & { id?: string }): Promise<string> {
        const id = rule.id || this.collection.doc().id;
        const now = new Date().toISOString();

        const toSave: MaterialPriceRule = {
            ...rule,
            id,
            createdAt: rule.createdAt || now,
            updatedAt: now,
        };

        await this.collection.doc(id).set(toSave);
        return id;
    }

    /**
     * Aplica un patch parcial y refresca `updatedAt`. `id`, `createdAt` y
     * `createdBy` no se pueden sobrescribir por esta vía.
     */
    async update(
        id: string,
        patch: Partial<Omit<MaterialPriceRule, 'id' | 'createdAt' | 'createdBy'>>,
    ): Promise<void> {
        await this.collection.doc(id).update({
            ...patch,
            updatedAt: new Date().toISOString(),
        });
    }

    /** Activa/desactiva una regla sin tocar el resto. */
    async setActive(id: string, active: boolean): Promise<void> {
        await this.collection.doc(id).update({
            active,
            updatedAt: new Date().toISOString(),
        });
    }

    async delete(id: string): Promise<void> {
        await this.collection.doc(id).delete();
    }
}
