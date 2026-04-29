
export interface PersonalInfo {
    name: string;
    email: string;
    phone: string;
    address?: string;
    web?: string; // NEW: Optional website
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
    otpCode?: string;
    otpExpiresAt?: Date;
    verifiedAt?: Date;
    attempts: number;
}

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
        public qualification: LeadQualification | null = null
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
            null
        );
    }

    setIntake(intake: LeadIntake): void {
        this.intake = intake;
        this.updatedAt = new Date();
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

    // Domain Logic: Request OTP
    generateOtp(code: string, expiresInMinutes: number = 15): void {
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + expiresInMinutes);

        this.verification = {
            ...this.verification,
            otpCode: code,
            otpExpiresAt: expiresAt,
            attempts: 0
        };
        this.updatedAt = new Date();
    }

    // Domain Logic: Verify OTP
    verifyOtp(code: string): boolean {
        if (this.verification.isVerified) return true;

        if (!this.verification.otpCode || !this.verification.otpExpiresAt) {
            return false;
        }

        if (new Date() > this.verification.otpExpiresAt) {
            return false;
        }

        if (this.verification.otpCode !== code) {
            this.verification.attempts++;
            return false;
        }

        this.verification = {
            isVerified: true,
            verifiedAt: new Date(),
            attempts: this.verification.attempts
        };
        this.updatedAt = new Date();
        return true;
    }

    updatePdfMetadata(metadata: Record<string, any>): void {
        this.pdfMetadata = metadata;
        this.updatedAt = new Date();
    }
}
