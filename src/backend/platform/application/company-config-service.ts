import 'server-only';
import { CompanyConfig, CompanyConfigRepository } from '../domain/company-config';
import { FirestoreCompanyConfigRepository } from '../infrastructure/firestore-company-config.repository';

const CACHE_TTL_MS = 5 * 60 * 1000;

class CompanyConfigService {
    private repo: CompanyConfigRepository;
    private cache: { value: CompanyConfig; expiresAt: number } | null = null;

    constructor(repo?: CompanyConfigRepository) {
        this.repo = repo ?? new FirestoreCompanyConfigRepository();
    }

    async get(): Promise<CompanyConfig> {
        const now = Date.now();
        if (this.cache && this.cache.expiresAt > now) {
            return this.cache.value;
        }
        const value = await this.repo.getConfig();
        this.cache = { value, expiresAt: now + CACHE_TTL_MS };
        return value;
    }

    async save(config: CompanyConfig): Promise<void> {
        await this.repo.saveConfig(config);
        this.cache = null;
    }

    /**
     * Buzón interno para avisos (citas, alertas): `NEXT_PUBLIC_ADMIN_EMAIL` si
     * está definido; si no, el email de Ajustes › Empresa. '' si no hay ninguno.
     */
    async notificationEmail(): Promise<string> {
        const fromEnv = process.env.NEXT_PUBLIC_ADMIN_EMAIL?.trim();
        if (fromEnv) return fromEnv;
        return (await this.get()).email?.trim() || '';
    }

    invalidate(): void {
        this.cache = null;
    }
}

export const companyConfigService = new CompanyConfigService();
