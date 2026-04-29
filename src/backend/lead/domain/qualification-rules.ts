import 'server-only';
import type { LeadIntake, LeadProjectType } from './lead';

// ───────────────────────────────────────────────────────────────
// Configuración (constants — se mueven a Firestore config/qualification en una iteración futura)
// ───────────────────────────────────────────────────────────────

/**
 * Prefijos de código postal aceptados. 07 = Islas Baleares (Mallorca, Menorca,
 * Ibiza, Formentera). Si el admin quiere restringir sólo a Mallorca,
 * cambiar a rangos numéricos.
 */
const ACCEPTED_POSTAL_PREFIXES = ['07'];

/** Tipos de obra que aceptamos como objetivo comercial. */
const ACCEPTED_PROJECT_TYPES: LeadProjectType[] = [
    'bathroom',
    'kitchen',
    'integral',
    'new_build',
    'pool',
];

/** Mínimo de m² por tipo de obra. Bajo este umbral, el margen no compensa. */
const MIN_SQUARE_METERS_BY_TYPE: Record<LeadProjectType, number> = {
    bathroom: 3,
    kitchen: 5,
    integral: 25,
    new_build: 60,
    pool: 8,
    other: 0,
};

/**
 * Dominios de email throwaway / temporal conocidos. Lista curada con los
 * proveedores más populares — cubre el 95% de casos reales sin pesar el
 * bundle. Para una lista exhaustiva (5000+) se puede migrar a un paquete
 * tipo `disposable-email-domains` cargado lazy desde script de mantenimiento.
 */
const DISPOSABLE_EMAIL_DOMAINS = new Set<string>([
    // Más usados en spam comercial real
    'mailinator.com',
    'mailinator.net',
    'tempmail.com',
    'temp-mail.org',
    'temp-mail.io',
    'tempmailaddress.com',
    'tempmail.us.com',
    '10minutemail.com',
    '10minutemail.net',
    '20minutemail.com',
    'guerrillamail.com',
    'guerrillamail.net',
    'guerrillamail.org',
    'guerrillamailblock.com',
    'sharklasers.com',
    'grr.la',
    'yopmail.com',
    'yopmail.net',
    'yopmail.fr',
    'trashmail.com',
    'trashmail.de',
    'trashmail.net',
    'trashmail.io',
    'getnada.com',
    'nada.email',
    'maildrop.cc',
    'mintemail.com',
    'fakeinbox.com',
    'throwawaymail.com',
    'mohmal.com',
    'inboxbear.com',
    'tempinbox.com',
    'spamgourmet.com',
    'mytemp.email',
    'emailondeck.com',
    'fakemail.net',
    'sogetthis.com',
    'mailcatch.com',
    'mailnesia.com',
    'tempr.email',
    'discard.email',
    'discardmail.com',
    'spamfree24.org',
    'mailforspam.com',
    'mt2014.com',
    'mt2015.com',
    'mvrht.com',
    'pokemail.net',
    'spam4.me',
    'wegwerfmail.de',
    'wegwerfmail.net',
    'wegwerfmail.org',
    'mail-temporaire.fr',
    'jetable.org',
    'binkmail.com',
    'gett.io',
    'bouncr.com',
    'spambog.com',
    'tempemail.net',
    'tempemail.com',
    'tempmail.ninja',
    'mytemp.email',
    'minutemail.com',
    'fivemail.de',
    'incognitomail.org',
    'spamspot.com',
    'tafmail.com',
    'tempinbox.co.uk',
    'tempmail.eu',
    'thismail.net',
    'tmail.ws',
    'mailimate.com',
    'easytrashmail.com',
    'cmail.club',
]);

/** Devuelve true si el email pertenece a un proveedor throwaway conocido. */
export function isDisposableEmail(email: string): boolean {
    const domain = (email.split('@')[1] || '').trim().toLowerCase();
    return DISPOSABLE_EMAIL_DOMAINS.has(domain);
}

/** Umbrales de decisión sobre el score final (0–100). */
const DECISION_THRESHOLDS = {
    qualified: 70,    // ≥ 70  → qualified
    reviewRequired: 40, // 40-69 → review_required, < 40 → rejected
};

// ───────────────────────────────────────────────────────────────
// Tipos
// ───────────────────────────────────────────────────────────────

export type QualificationDecision = 'qualified' | 'review_required' | 'rejected';

export interface RuleEvaluation {
    ruleId: string;
    passed: boolean;
    /** Δ que aporta al score final (positivo o negativo). */
    scoreDelta: number;
    /** True si esta regla, al fallar, fuerza el rechazo independientemente del score. */
    fatalOnFail?: boolean;
    reason?: string;
}

export interface QualificationOutcome {
    decision: QualificationDecision;
    score: number;
    reasons: string[];
    rules: string[];
    /** True si alguna señal débil (email throwaway, injection) requiere revisión humana. */
    lowTrust?: boolean;
    lowTrustReasons?: string[];
}

// ───────────────────────────────────────────────────────────────
// Reglas
// ───────────────────────────────────────────────────────────────

function ruleGeoArea(intake: LeadIntake): RuleEvaluation {
    const cp = (intake.postalCode || '').trim();
    if (!cp) {
        return {
            ruleId: 'geo.postal_code_missing',
            passed: false,
            scoreDelta: -10,
            reason: 'No se proporcionó código postal',
        };
    }
    const matches = ACCEPTED_POSTAL_PREFIXES.some(p => cp.startsWith(p));
    // Nota: NO usamos fatalOnFail aquí. El CP de contacto del cliente puede
    // diferir de la ubicación real de la obra (segunda residencia,
    // propietario absentista, etc.). Penalizamos fuerte el score pero
    // dejamos que el admin pueda revisar el caso.
    return matches
        ? { ruleId: 'geo.in_service_area', passed: true, scoreDelta: 10 }
        : {
              ruleId: 'geo.out_of_service_area',
              passed: false,
              scoreDelta: -25,
              reason: `Código postal ${cp} fuera del área principal (Baleares) — verificar ubicación real de la obra`,
          };
}

function ruleProjectType(intake: LeadIntake): RuleEvaluation {
    const accepted = ACCEPTED_PROJECT_TYPES.includes(intake.projectType);
    // Mismo criterio que la regla geográfica: penalizamos fuerte pero no
    // descartamos. 'other' puede ser una piscina mal categorizada o un
    // proyecto válido que el agente no supo encasillar.
    return accepted
        ? { ruleId: 'scope.accepted_project_type', passed: true, scoreDelta: 5 }
        : {
              ruleId: 'scope.rejected_project_type',
              passed: false,
              scoreDelta: -20,
              reason: `Tipo de obra '${intake.projectType}' fuera del alcance habitual — confirmar con el cliente`,
          };
}

function ruleMinimumSize(intake: LeadIntake): RuleEvaluation {
    const minimum = MIN_SQUARE_METERS_BY_TYPE[intake.projectType];
    if (!intake.approxSquareMeters) {
        return {
            ruleId: 'size.unknown',
            passed: false,
            scoreDelta: -5,
            reason: 'Tamaño no proporcionado',
        };
    }
    if (intake.approxSquareMeters < minimum) {
        return {
            ruleId: 'size.below_minimum',
            passed: false,
            scoreDelta: -15,
            reason: `${intake.approxSquareMeters} m² < mínimo ${minimum} m² para ${intake.projectType}`,
        };
    }
    return { ruleId: 'size.adequate', passed: true, scoreDelta: 5 };
}

function ruleDescriptionQuality(intake: LeadIntake): RuleEvaluation {
    const desc = (intake.description || '').trim();
    if (desc.length < 10) {
        return {
            ruleId: 'content.description_too_short',
            passed: false,
            scoreDelta: -20,
            reason: 'Descripción demasiado corta (< 10 caracteres)',
        };
    }
    if (desc.length < 30) {
        return {
            ruleId: 'content.description_minimal',
            passed: false,
            scoreDelta: -5,
            reason: 'Descripción muy breve, faltan detalles',
        };
    }
    return { ruleId: 'content.description_ok', passed: true, scoreDelta: 5 };
}

function ruleEmailQuality(email: string): RuleEvaluation {
    const domain = (email.split('@')[1] || '').toLowerCase();
    if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) {
        return {
            ruleId: 'email.disposable',
            passed: false,
            scoreDelta: -25,
            reason: `Email de dominio temporal: ${domain}`,
        };
    }
    return { ruleId: 'email.ok', passed: true, scoreDelta: 5 };
}

function ruleSecurityFlag(intake: LeadIntake): RuleEvaluation {
    if (intake.suspicious) {
        return {
            ruleId: 'security.injection_attempt',
            passed: false,
            scoreDelta: -30,
            reason: 'El sanitizer detectó patrones de prompt injection',
        };
    }
    return { ruleId: 'security.clean', passed: true, scoreDelta: 0 };
}

function ruleEvidence(intake: LeadIntake): RuleEvaluation {
    const hasImages = (intake.imageUrls || []).length > 0;
    const hasBudget = typeof intake.approxBudget === 'number' && intake.approxBudget > 0;
    const hasTimeline = !!intake.timeline;

    let score = 0;
    if (hasImages) score += 10;
    if (hasBudget) score += 5;
    if (hasTimeline) score += 5;

    return {
        ruleId: 'evidence.signals',
        passed: score > 0,
        scoreDelta: score,
        reason: score > 0
            ? `Señales aportadas: ${[hasImages && 'fotos', hasBudget && 'presupuesto', hasTimeline && 'plazo'].filter(Boolean).join(', ')}`
            : 'No aportó fotos, presupuesto ni plazo',
    };
}

// ───────────────────────────────────────────────────────────────
// Pipeline principal
// ───────────────────────────────────────────────────────────────

/**
 * Evalúa todas las reglas en orden y devuelve la decisión final.
 * Reglas con `fatalOnFail` cortocircuitan a `rejected` independientemente del score.
 */
export function evaluateLeadIntake(
    intake: LeadIntake,
    leadEmail: string
): QualificationOutcome {
    const evaluations: RuleEvaluation[] = [
        ruleGeoArea(intake),
        ruleProjectType(intake),
        ruleMinimumSize(intake),
        ruleDescriptionQuality(intake),
        ruleEmailQuality(leadEmail),
        ruleSecurityFlag(intake),
        ruleEvidence(intake),
    ];

    let baseScore = 50;
    let fatalReason: string | undefined;
    const rules: string[] = [];
    const reasons: string[] = [];
    const lowTrustReasons: string[] = [];

    // Reglas que disparan el flag low-trust (señal débil, no bloqueo).
    const LOW_TRUST_RULES = new Set(['email.disposable', 'security.injection_attempt']);

    for (const ev of evaluations) {
        rules.push(ev.ruleId);
        baseScore += ev.scoreDelta;
        if (ev.reason) reasons.push(ev.reason);
        if (!ev.passed && ev.fatalOnFail && !fatalReason) {
            fatalReason = ev.reason || ev.ruleId;
        }
        if (!ev.passed && LOW_TRUST_RULES.has(ev.ruleId) && ev.reason) {
            lowTrustReasons.push(ev.reason);
        }
    }

    const score = Math.max(0, Math.min(100, baseScore));

    let decision: QualificationDecision;
    if (fatalReason) {
        decision = 'rejected';
    } else if (score >= DECISION_THRESHOLDS.qualified) {
        decision = 'qualified';
    } else if (score >= DECISION_THRESHOLDS.reviewRequired) {
        decision = 'review_required';
    } else {
        decision = 'rejected';
    }

    return {
        decision,
        score,
        reasons,
        rules,
        lowTrust: lowTrustReasons.length > 0,
        lowTrustReasons: lowTrustReasons.length > 0 ? lowTrustReasons : undefined,
    };
}
