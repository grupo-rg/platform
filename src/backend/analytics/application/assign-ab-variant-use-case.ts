import { SessionRepository, ABTestRepository } from '../domain/analytics-repository';
import { ABTest } from '../domain/ab-test';

/**
 * AssignABVariantUseCase
 * Assigns a deterministic variant for a given AB test and session.
 * If the session already has an assignment, returns it (avoiding flicker).
 */
export class AssignABVariantUseCase {
    constructor(
        private sessionRepo: SessionRepository,
        private abTestRepo: ABTestRepository
    ) { }

    async execute(params: {
        sessionId: string;
        fingerprint: string;
        testId: string;
        locale: string;
        userAgent: string;
    }): Promise<{ variantId: string; variantName: string; content: Record<string, string> } | null> {
        const test = await this.abTestRepo.findById(params.testId);
        if (!test || !test.isActive()) return null;

        let session = await this.sessionRepo.findById(params.sessionId);

        if (!session) {
            const { Session } = await import('../domain/session');
            session = Session.create(
                params.sessionId,
                params.fingerprint,
                params.locale,
                params.userAgent,
                null
            );
        }

        // Check for existing assignment
        const existingVariantId = session.getVariant(params.testId);
        if (existingVariantId) {
            const variant = test.variants.find(v => v.id === existingVariantId);
            if (variant) {
                return {
                    variantId: variant.id,
                    variantName: variant.name,
                    content: variant.content
                };
            }
        }

        // Assign new variant deterministically
        const variant = test.assignVariant(params.sessionId);
        session.assignVariant(params.testId, variant.id);
        await this.sessionRepo.save(session);

        return {
            variantId: variant.id,
            variantName: variant.name,
            content: variant.content
        };
    }
}
