
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
        public pdfMetadata: Record<string, any> = {}
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
            {}
        );
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
