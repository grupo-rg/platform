import { LeadConsent, mergeConsents, hasMarketingConsent as hasMarketingConsentFn } from './lead-consent';


export interface PersonalInfo {
    name: string;
    email: string;
    phone: string;
    address?: string;
    web?: string;

    // Datos fiscales / facturación. Todos opcionales — un Lead inicial sólo
    // necesita nombre+email+phone. Se rellenan al crear obra o al confirmar
    // datos del cliente desde el PDF.
    nif?: string;                // DNI / NIF / CIE
    companyName?: string;        // Razón social si es empresa
    billingAddress?: string;     // Dirección fiscal (si difiere de `address`)
    billingCity?: string;
    billingPostalCode?: string;
    billingProvince?: string;
    billingCountry?: string;
}

// ── Client Profile (Typeform-style profiling) ──

export type BiggestPain = 'budgeting' | 'cost-control' | 'certifications';
export type ProjectScale = '1-3' | '4-10' | '10+';
export type CurrentStack = 'excel' | 'presto' | 'other-erp';
export type AnnualSurveyorSpend = '<10k' | '10-30k' | '30-60k' | '60k+';
export type WeeklyManualHours = '<5h' | '5-15h' | '15-30h' | '30h+';
export type ClientRole = 'owner' | 'project-manager' | 'admin' | 'surveyor';

export interface ClientProfile {
    biggestPain: BiggestPain[];
    simultaneousProjects: ProjectScale;
    currentStack: CurrentStack[];
    companyName: string;
    companySize: 'solo' | '2-5' | '6-15' | '16-50' | '50+';
    annualSurveyorSpend?: AnnualSurveyorSpend;
    weeklyManualHours?: WeeklyManualHours;
    role: ClientRole;
    feedback?: {
        willingToPay?: string;
        friction?: string;
        [key: string]: string | undefined;
    };
    completedAt?: Date;
}

export interface LeadPreferences {
    contactMethod: 'whatsapp' | 'email' | 'phone';
    language: string;
}

export interface LeadVerification {
    isVerified: boolean;
    /**
     * @deprecated Código OTP en claro (legacy). Ya no se escribe: el
     * repositorio lo persiste siempre a null. Se mantiene en el tipo sólo por
     * compatibilidad con scripts de depuración.
     */
    otpCode?: string;
    /** HMAC-SHA256 del código OTP (nunca el código en claro). */
    otpHash?: string;
    otpExpiresAt?: Date;
    verifiedAt?: Date;
    /** Intentos fallidos sobre el código vigente. */
    attempts: number;
    /** Si está presente y es futuro, no se aceptan ni se emiten códigos. */
    lockedUntil?: Date;
}

/** Política OTP (también la usa el email: "válido durante N minutos"). */
export const OTP_POLICY = {
    ttlMinutes: 10,
    maxAttempts: 5,
    lockMinutes: 15,
} as const;

export type OtpVerificationResult = 'verified' | 'invalid' | 'expired' | 'locked' | 'no_code';

// ── Public Intake (datos capturados al solicitar presupuesto) ──

export type LeadProjectType =
    | 'bathroom'
    | 'kitchen'
    | 'integral'
    | 'new_build'
    | 'pool'
    | 'other';

export type LeadIntakeSource =
    | 'chat_public'
    | 'wizard'
    | 'quick_form'
    | 'detailed_form'
    | 'new_build_form'
    | 'demo';

export type LeadTimeline = 'asap' | '1-3m' | '3-6m' | '6m+';

export type LeadQualityLevel = 'basic' | 'medium' | 'premium';

export interface LeadIntake {
    projectType: LeadProjectType;
    description: string;
    source: LeadIntakeSource;
    approxSquareMeters?: number;
    postalCode?: string;
    city?: string;
    approxBudget?: number;
    timeline?: LeadTimeline;
    qualityLevel?: LeadQualityLevel;
    imageUrls: string[];        // URLs en Firebase Storage (públicas o firmadas)
    suspicious?: boolean;        // marcado por sanitizer si detecta intentos de injection
    submittedAt: Date;
    /**
     * Snapshot crudo del formulario tal como lo rellenó el cliente. Se guarda
     * sólo para leads provenientes de formularios (quick / detailed / new_build);
     * los leads del chat NO usan este campo (la transcripción vive en la
     * Conversation asociada). Útil para el admin: ver decisiones binarias del
     * wizard, m² por estancia, materiales pedidos, etc., sin perder detalle.
     */
    rawFormData?: Record<string, any>;
    /**
     * ID temporal de la sesión de chat público antes de tener leadId. Permite
     * vincular la Conversation persistida al lead cuando ocurre el handoff.
     * Sólo presente si source === 'chat_public'.
     */
    chatSessionId?: string;
}

export type QualificationDecision = 'qualified' | 'review_required' | 'rejected';

export interface LeadScoreEvent {
    /** Razón humana de por qué el score cambió. */
    reason: string;
    /** Δ aplicado al score (+ subió, − bajó). */
    delta: number;
    /** Score resultante después del ajuste. */
    score: number;
    /** ID lógico del evento (ej. 'booking_confirmed', 'budget_sent', 'email_opened'). */
    eventId: string;
    timestamp: Date;
}

export interface LeadQualification {
    decision: QualificationDecision;
    score: number;              // 0–100
    reasons: string[];
    rules: string[];
    evaluatedAt: Date;
    evaluatedBy: 'auto' | 'admin';
    /**
     * Bandera de baja confianza (e.g. email throwaway, dominio sospechoso).
     * Se muestra al admin como badge ámbar — no bloquea, sólo señala revisar.
     */
    lowTrust?: boolean;
    /**
     * Razones por las que el lead se marcó como low-trust. Útiles para
     * auditoría y para que el admin entienda la flag de un vistazo.
     */
    lowTrustReasons?: string[];
    /**
     * Historial de ajustes de score post-cualificación inicial. Permite
     * trazabilidad al admin (qué evento subió/bajó el score y cuándo).
     */
    scoreHistory?: LeadScoreEvent[];
}

/**
 * Lead Aggregate Root
 * Represents a potential client who has initiated contact.
 */
export class Lead {
    constructor(
        public readonly id: string,
        public readonly personalInfo: PersonalInfo,
        public readonly preferences: LeadPreferences,
        public verification: LeadVerification,
        public profile: ClientProfile | null,
        public readonly createdAt: Date,
        public updatedAt: Date,
        public demoBudgetsGenerated: number = 0,
        public demoPdfsDownloaded: number = 0,
        public pdfMetadata: Record<string, any> = {},
        public intake: LeadIntake | null = null,
        public qualification: LeadQualification | null = null,
        /** Log append-only de consentimientos RGPD (ver lead-consent.ts). */
        public consents: LeadConsent[] = []
    ) { }

    static create(id: string, info: PersonalInfo, preferences: LeadPreferences): Lead {
        return new Lead(
            id,
            info,
            preferences,
            { isVerified: false, attempts: 0 },
            null,
            new Date(),
            new Date(),
            0,
            0,
            {},
            null,
            null,
            []
        );
    }

    /** Registra consentimientos (sólo cambios respecto al último de cada tipo). */
    recordConsents(incoming: LeadConsent[]): void {
        if (!incoming || incoming.length === 0) return;
        const merged = mergeConsents(this.consents, incoming);
        if (merged.length !== this.consents.length) {
            this.consents = merged;
            this.updatedAt = new Date();
        }
    }

    get hasMarketingConsent(): boolean {
        return hasMarketingConsentFn(this);
    }

    setIntake(intake: LeadIntake): void {
        this.intake = intake;
        this.updatedAt = new Date();
    }

    /**
     * Anexa URLs al `intake.imageUrls` sin duplicar. Devuelve `true` si hubo
     * cambios reales (al menos una URL nueva). El chat público lo usa para
     * mantener el intake al día con las fotos que el visitante adjunta en
     * turnos posteriores al handoff inicial.
     */
    appendIntakeImages(urls: string[]): boolean {
        if (!this.intake || urls.length === 0) return false;
        const existing = this.intake.imageUrls || [];
        const merged = Array.from(new Set([...existing, ...urls]));
        if (merged.length === existing.length) return false;
        this.intake = { ...this.intake, imageUrls: merged };
        this.updatedAt = new Date();
        return true;
    }

    setQualification(qualification: LeadQualification): void {
        this.qualification = qualification;
        this.updatedAt = new Date();
    }

    completeProfile(data: Omit<ClientProfile, 'completedAt'>): void {
        this.profile = {
            ...data,
            completedAt: new Date()
        };
        this.updatedAt = new Date();
    }

    incrementDemoBudgets(): void {
        this.demoBudgetsGenerated += 1;
        this.updatedAt = new Date();
    }

    incrementDemoPdfs(): void {
        this.demoPdfsDownloaded += 1;
        this.updatedAt = new Date();
    }

    get isProfiled(): boolean {
        return this.profile?.completedAt != null;
    }

    isOtpLocked(now: Date = new Date()): boolean {
        return !!this.verification.lockedUntil && this.verification.lockedUntil.getTime() > now.getTime();
    }

    /**
     * Emite un nuevo OTP guardando SÓLO su hash. Devuelve `false` (sin tocar
     * nada) si el lead está bloqueado por demasiados intentos fallidos.
     *
     * Nota: NO cambia `isVerified`. Un lead verificado anteriormente que pide
     * código vuelve a tener que demostrar el control del email: la identidad
     * en servidor la da la cookie firmada emitida tras verificar, no el flag.
     */
    generateOtp(codeHash: string, now: Date = new Date(), ttlMinutes: number = OTP_POLICY.ttlMinutes): boolean {
        if (this.isOtpLocked(now)) return false;
        this.verification = {
            ...this.verification,
            otpCode: undefined,
            otpHash: codeHash,
            otpExpiresAt: new Date(now.getTime() + ttlMinutes * 60_000),
            attempts: 0,
            lockedUntil: undefined,
        };
        this.updatedAt = now;
        return true;
    }

    /**
     * Verifica SIEMPRE el código (no hay atajo por `isVerified`).
     *
     * @param matches compara el código introducido con el hash guardado
     *                (inyectado para no acoplar el dominio a `crypto`).
     */
    verifyOtp(
        code: string,
        matches: (code: string, storedHash: string) => boolean,
        now: Date = new Date()
    ): OtpVerificationResult {
        if (this.isOtpLocked(now)) return 'locked';

        const { otpHash, otpExpiresAt } = this.verification;
        if (!otpHash || !otpExpiresAt) return 'no_code';

        if (now.getTime() > otpExpiresAt.getTime()) {
            // Código caducado: lo invalidamos para que no pueda reutilizarse.
            this.verification = { ...this.verification, otpHash: undefined, otpExpiresAt: undefined, otpCode: undefined };
            this.updatedAt = now;
            return 'expired';
        }

        if (!code || !matches(code, otpHash)) {
            const attempts = (this.verification.attempts || 0) + 1;
            if (attempts >= OTP_POLICY.maxAttempts) {
                // Bloqueo temporal + invalidación del código vigente.
                this.verification = {
                    ...this.verification,
                    attempts,
                    otpHash: undefined,
                    otpExpiresAt: undefined,
                    otpCode: undefined,
                    lockedUntil: new Date(now.getTime() + OTP_POLICY.lockMinutes * 60_000),
                };
                this.updatedAt = now;
                return 'locked';
            }
            this.verification = { ...this.verification, attempts };
            this.updatedAt = now;
            return 'invalid';
        }

        // Éxito: el código es de un solo uso.
        this.verification = {
            isVerified: true,
            verifiedAt: now,
            attempts: 0,
        };
        this.updatedAt = now;
        return 'verified';
    }

    updatePdfMetadata(metadata: Record<string, any>): void {
        this.pdfMetadata = metadata;
        this.updatedAt = new Date();
    }
}
