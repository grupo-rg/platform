import { LeadRepository } from '../domain/lead-repository';
import { Lead, PersonalInfo, LeadPreferences, LeadVerification, ClientProfile, LeadIntake, LeadQualification } from '../domain/lead';
import type { LeadConsent } from '../domain/lead-consent';
import { getFirestore } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/backend/shared/infrastructure/firebase/admin-app';

/**
 * Firestore rechaza valores `undefined` en cualquier nivel de un objeto.
 * Eliminamos undefined recursivamente y convertimos `Date` en `Timestamp`-compat.
 * Nota: NO procesa Map/Set/Function (no esperados en formData de un wizard).
 */
function sanitizeForFirestore(value: any): any {
    if (value === undefined) return null;
    if (value === null) return null;
    if (Array.isArray(value)) {
        return value.map(sanitizeForFirestore).filter(v => v !== null || true);
    }
    if (value && typeof value === 'object' && !(value instanceof Date)) {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(value)) {
            if (v === undefined) continue;
            out[k] = sanitizeForFirestore(v);
        }
        return out;
    }
    return value;
}

export class FirestoreLeadRepository implements LeadRepository {
    private db;

    constructor() {
        initFirebaseAdminApp();
        this.db = getFirestore();
    }

    private get collectionName() {
        return process.env.NEXT_PUBLIC_USE_TEST_DB === 'true' ? 'test_leads' : 'leads';
    }

    private toDomain(doc: FirebaseFirestore.DocumentSnapshot): Lead {
        const data = doc.data();
        if (!data) throw new Error(`Lead not found for id ${doc.id}`);

        const intake: LeadIntake | null = data.intake ? {
            projectType: data.intake.projectType,
            description: data.intake.description,
            source: data.intake.source,
            approxSquareMeters: data.intake.approxSquareMeters,
            postalCode: data.intake.postalCode,
            city: data.intake.city,
            approxBudget: data.intake.approxBudget,
            timeline: data.intake.timeline,
            qualityLevel: data.intake.qualityLevel,
            imageUrls: Array.isArray(data.intake.imageUrls) ? data.intake.imageUrls : [],
            suspicious: data.intake.suspicious || false,
            submittedAt: data.intake.submittedAt?.toDate?.() || new Date(),
            rawFormData: data.intake.rawFormData || undefined,
            chatSessionId: data.intake.chatSessionId || undefined,
        } : null;

        const qualification: LeadQualification | null = data.qualification ? {
            decision: data.qualification.decision,
            score: data.qualification.score || 0,
            reasons: Array.isArray(data.qualification.reasons) ? data.qualification.reasons : [],
            rules: Array.isArray(data.qualification.rules) ? data.qualification.rules : [],
            evaluatedAt: data.qualification.evaluatedAt?.toDate?.() || new Date(),
            evaluatedBy: data.qualification.evaluatedBy || 'auto',
            lowTrust: !!data.qualification.lowTrust,
            lowTrustReasons: Array.isArray(data.qualification.lowTrustReasons)
                ? data.qualification.lowTrustReasons
                : undefined,
            scoreHistory: Array.isArray(data.qualification.scoreHistory)
                ? data.qualification.scoreHistory.map((h: any) => ({
                      eventId: String(h.eventId || ''),
                      reason: String(h.reason || ''),
                      delta: Number(h.delta || 0),
                      score: Number(h.score || 0),
                      timestamp: h.timestamp?.toDate?.() || new Date(h.timestamp || Date.now()),
                  }))
                : [],
        } : null;

        return new Lead(
            doc.id,
            data.personalInfo as PersonalInfo,
            data.preferences as LeadPreferences,
            {
                isVerified: data.verification?.isVerified || false,
                // `otpCode` legacy (en claro) se ignora a propósito: un código
                // antiguo no puede verificarse; el lead debe pedir uno nuevo.
                otpHash: data.verification?.otpHash || undefined,
                otpExpiresAt: data.verification?.otpExpiresAt?.toDate?.(),
                verifiedAt: data.verification?.verifiedAt?.toDate?.(),
                attempts: data.verification?.attempts || 0,
                lockedUntil: data.verification?.lockedUntil?.toDate?.(),
            } as LeadVerification,
            data.profile ? {
                biggestPain: data.profile.biggestPain,
                simultaneousProjects: data.profile.simultaneousProjects,
                currentStack: data.profile.currentStack,
                companyName: data.profile.companyName,
                companySize: data.profile.companySize,
                annualSurveyorSpend: data.profile.annualSurveyorSpend,
                weeklyManualHours: data.profile.weeklyManualHours,
                role: data.profile.role,
                feedback: data.profile.feedback,
                completedAt: data.profile.completedAt?.toDate()
            } as ClientProfile : null,
            data.createdAt?.toDate() || new Date(),
            data.updatedAt?.toDate() || new Date(),
            data.demoBudgetsGenerated || 0,
            data.demoPdfsDownloaded || 0,
            data.pdfMetadata || {},
            intake,
            qualification,
            Array.isArray(data.consents)
                ? data.consents.map((c: any): LeadConsent => ({
                      type: c.type,
                      granted: !!c.granted,
                      at: c.at?.toDate?.() || new Date(c.at || 0),
                      source: c.source,
                      textVersion: String(c.textVersion || ''),
                      ...(c.ip ? { ip: String(c.ip) } : {}),
                  }))
                : []
        );
    }

    private toPersistence(lead: Lead): any {
        const intakePayload = lead.intake ? {
            projectType: lead.intake.projectType,
            description: lead.intake.description,
            source: lead.intake.source,
            imageUrls: lead.intake.imageUrls || [],
            suspicious: lead.intake.suspicious || false,
            submittedAt: lead.intake.submittedAt,
            ...(lead.intake.approxSquareMeters !== undefined ? { approxSquareMeters: lead.intake.approxSquareMeters } : {}),
            ...(lead.intake.postalCode ? { postalCode: lead.intake.postalCode } : {}),
            ...(lead.intake.city ? { city: lead.intake.city } : {}),
            ...(lead.intake.approxBudget !== undefined ? { approxBudget: lead.intake.approxBudget } : {}),
            ...(lead.intake.timeline ? { timeline: lead.intake.timeline } : {}),
            ...(lead.intake.qualityLevel ? { qualityLevel: lead.intake.qualityLevel } : {}),
            ...(lead.intake.rawFormData ? { rawFormData: sanitizeForFirestore(lead.intake.rawFormData) } : {}),
            ...(lead.intake.chatSessionId ? { chatSessionId: lead.intake.chatSessionId } : {}),
        } : null;

        const qualificationPayload = lead.qualification ? {
            decision: lead.qualification.decision,
            score: lead.qualification.score,
            reasons: lead.qualification.reasons || [],
            rules: lead.qualification.rules || [],
            evaluatedAt: lead.qualification.evaluatedAt,
            evaluatedBy: lead.qualification.evaluatedBy,
            ...(lead.qualification.lowTrust ? { lowTrust: true } : {}),
            ...(lead.qualification.lowTrustReasons && lead.qualification.lowTrustReasons.length > 0
                ? { lowTrustReasons: lead.qualification.lowTrustReasons }
                : {}),
            ...(lead.qualification.scoreHistory && lead.qualification.scoreHistory.length > 0
                ? {
                      scoreHistory: lead.qualification.scoreHistory.map(h => ({
                          eventId: h.eventId,
                          reason: h.reason,
                          delta: h.delta,
                          score: h.score,
                          timestamp: h.timestamp,
                      })),
                  }
                : {}),
        } : null;

        return {
            personalInfo: lead.personalInfo,
            preferences: lead.preferences,
            verification: {
                isVerified: lead.verification.isVerified,
                // Nunca persistimos el OTP en claro (purga el legacy al guardar).
                otpCode: null,
                otpHash: lead.verification.otpHash || null,
                otpExpiresAt: lead.verification.otpExpiresAt || null,
                verifiedAt: lead.verification.verifiedAt || null,
                attempts: lead.verification.attempts || 0,
                lockedUntil: lead.verification.lockedUntil || null,
            },
            consents: (lead.consents || []).map(c => ({
                type: c.type,
                granted: c.granted,
                at: c.at,
                source: c.source,
                textVersion: c.textVersion,
                ...(c.ip ? { ip: c.ip } : {}),
            })),
            profile: lead.profile ? {
                biggestPain: lead.profile.biggestPain,
                simultaneousProjects: lead.profile.simultaneousProjects,
                currentStack: lead.profile.currentStack,
                companyName: lead.profile.companyName,
                companySize: lead.profile.companySize,
                role: lead.profile.role,
                ...(lead.profile.annualSurveyorSpend ? { annualSurveyorSpend: lead.profile.annualSurveyorSpend } : {}),
                ...(lead.profile.weeklyManualHours ? { weeklyManualHours: lead.profile.weeklyManualHours } : {}),
                ...(lead.profile.feedback ? { feedback: lead.profile.feedback } : {}),
                ...(lead.profile.completedAt ? { completedAt: lead.profile.completedAt } : {})
            } : null,
            intake: intakePayload,
            qualification: qualificationPayload,
            demoBudgetsGenerated: lead.demoBudgetsGenerated,
            demoPdfsDownloaded: lead.demoPdfsDownloaded,
            pdfMetadata: lead.pdfMetadata,
            createdAt: lead.createdAt,
            updatedAt: lead.updatedAt
        };
    }

    async save(lead: Lead): Promise<void> {
        await this.db.collection(this.collectionName).doc(lead.id).set(this.toPersistence(lead));
    }

    async findById(id: string): Promise<Lead | null> {
        const doc = await this.db.collection(this.collectionName).doc(id).get();
        if (!doc.exists) return null;
        return this.toDomain(doc);
    }

    /**
     * Busca por email (exacto o en minúsculas — los leads antiguos pueden
     * tener mayúsculas). Si hubiera duplicados históricos, devuelve de forma
     * DETERMINISTA el más antiguo, para que la emisión y la verificación del
     * OTP siempre operen sobre el mismo documento.
     */
    async findByEmail(email: string): Promise<Lead | null> {
        const raw = String(email || '').trim();
        if (!raw) return null;
        const candidates = Array.from(new Set([raw, raw.toLowerCase()]));
        const snapshot = await this.db.collection(this.collectionName)
            .where('personalInfo.email', 'in', candidates)
            .limit(10)
            .get();

        if (snapshot.empty) return null;
        const docs = [...snapshot.docs].sort((a, b) => {
            const ta = a.data()?.createdAt?.toMillis?.() ?? 0;
            const tb = b.data()?.createdAt?.toMillis?.() ?? 0;
            return ta - tb || a.id.localeCompare(b.id);
        });
        return this.toDomain(docs[0]);
    }

    async findAll(limit: number, offset: number): Promise<Lead[]> {
        let query = this.db.collection(this.collectionName)
            .orderBy('createdAt', 'desc')
            .limit(limit);

        if (offset > 0) {
            const offsetSnap = await this.db.collection(this.collectionName)
                .orderBy('createdAt', 'desc')
                .limit(offset)
                .get();

            if (!offsetSnap.empty) {
                const lastDoc = offsetSnap.docs[offsetSnap.docs.length - 1];
                query = query.startAfter(lastDoc);
            }
        }

        const snapshot = await query.get();
        return snapshot.docs.map(doc => this.toDomain(doc));
    }

    async countByStatus(): Promise<{ verified: number; unverified: number; profiled: number }> {
        const allDocs = await this.db.collection(this.collectionName).get();
        let verified = 0;
        let unverified = 0;
        let profiled = 0;

        for (const doc of allDocs.docs) {
            const data = doc.data();
            if (data.profile?.completedAt) {
                profiled++;
            } else if (data.verification?.isVerified) {
                verified++;
            } else {
                unverified++;
            }
        }

        return { verified, unverified, profiled };
    }

    async delete(id: string): Promise<void> {
        await this.db.collection(this.collectionName).doc(id).delete();
    }
}
