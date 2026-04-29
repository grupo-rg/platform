import 'server-only';
import type { LeadIntake, LeadQualification } from '../domain/lead';
import { evaluateLeadIntake } from '../domain/qualification-rules';

/**
 * Aplica las reglas determinísticas y devuelve un LeadQualification listo
 * para persistir en el agregado Lead.
 *
 * Si en el futuro se añade una capa de cualificación con LLM (constrained
 * output, sólo decisión sin contenido) iría aquí, **después** de las reglas
 * — las reglas son la primera línea, el LLM solo desempata casos
 * `review_required`.
 */
export class QualifyLeadService {
    qualify(intake: LeadIntake, leadEmail: string): LeadQualification {
        const outcome = evaluateLeadIntake(intake, leadEmail);
        return {
            decision: outcome.decision,
            score: outcome.score,
            reasons: outcome.reasons,
            rules: outcome.rules,
            evaluatedAt: new Date(),
            evaluatedBy: 'auto',
            lowTrust: outcome.lowTrust,
            lowTrustReasons: outcome.lowTrustReasons,
            scoreHistory: [],
        };
    }
}
