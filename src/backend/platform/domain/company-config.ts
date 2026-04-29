/**
 * Datos globales de la empresa emisora (single-tenant).
 * Fuente única para: PDFs de presupuesto, headers/footers públicos,
 * emails transaccionales, prompts de IA, sitemap/robots y JSON-LD.
 */
export interface CompanyConfig {
    id: string; // 'company'

    // Identidad
    name: string;              // "Grupo RG"
    legalName: string;         // "Grupo RG S.L."
    cif: string;               // B12345678
    logoUrl?: string;          // URL pública de Firebase Storage
    tagline?: string;          // "Construcción y reformas en Mallorca"

    // Contacto
    address: string;           // Calle, número, CP, ciudad
    phone: string;
    email: string;
    web: string;               // https://gruporg.es

    // Redes sociales (opcional)
    social?: {
        instagram?: string;
        facebook?: string;
        linkedin?: string;
        twitter?: string;
        youtube?: string;
    };

    // Facturación (metadatos de emisor, no confundir con BudgetConfig de márgenes)
    billing?: {
        ivaRate?: number;      // 0.10 / 0.21 — por defecto
        regime?: string;       // "General", "Recargo", etc.
        bankAccount?: string;  // IBAN parcial para el PDF
    };

    // Pie de PDF y emails
    footerText?: string;       // "Inscrita en el Registro Mercantil de..."

    updatedAt: Date;
    updatedBy: string;
}

export const DEFAULT_COMPANY_CONFIG: CompanyConfig = {
    id: 'company',
    name: 'Grupo RG',
    legalName: 'Grupo RG S.L.',
    cif: '',
    address: '',
    phone: '',
    email: '',
    web: '',
    updatedAt: new Date(),
    updatedBy: 'system',
};

export interface CompanyConfigRepository {
    getConfig(): Promise<CompanyConfig>;
    saveConfig(config: CompanyConfig): Promise<void>;
}
