/**
 * AB Test Variant Value Object
 */
export interface Variant {
    id: string;
    name: string;
    weight: number; // 0-1, sum of all variants should be 1
    content: Record<string, string>;
}

/**
 * AB Test Status
 */
export type ABTestStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED';

/**
 * AB Test Metric
 */
export interface ABTestMetric {
    name: string;
    type: 'PRIMARY' | 'SECONDARY' | 'GUARDRAIL';
    description: string;
}

/**
 * AB Test Entity
 * Manages experiment configuration and variant assignment.
 */
export class ABTest {
    constructor(
        public readonly id: string,
        public readonly name: string,
        public readonly hypothesis: string,
        public readonly variants: Variant[],
        public status: ABTestStatus,
        public readonly metrics: ABTestMetric[],
        public readonly startDate: Date,
        public endDate: Date | null,
        public readonly requiredSampleSize: number,
        public readonly createdAt: Date
    ) { }

    static create(
        id: string,
        name: string,
        hypothesis: string,
        variants: Variant[],
        metrics: ABTestMetric[],
        requiredSampleSize: number
    ): ABTest {
        return new ABTest(
            id,
            name,
            hypothesis,
            variants,
            'DRAFT',
            metrics,
            new Date(),
            null,
            requiredSampleSize,
            new Date()
        );
    }

    isActive(): boolean {
        return this.status === 'ACTIVE';
    }

    activate(): void {
        if (this.status !== 'DRAFT' && this.status !== 'PAUSED') {
            throw new Error(`Cannot activate test in status: ${this.status}`);
        }
        this.status = 'ACTIVE';
    }

    complete(): void {
        this.status = 'COMPLETED';
        this.endDate = new Date();
    }

    /**
     * Assigns a variant using weighted random selection.
     * Deterministic for the same sessionId to avoid flicker on re-renders.
     */
    assignVariant(sessionId: string): Variant {
        // Simple hash-based deterministic assignment
        let hash = 0;
        for (let i = 0; i < sessionId.length; i++) {
            const char = sessionId.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0; // Convert to 32-bit integer
        }
        const normalized = Math.abs(hash) / 2147483647; // normalize to 0-1

        let cumulative = 0;
        for (const variant of this.variants) {
            cumulative += variant.weight;
            if (normalized <= cumulative) {
                return variant;
            }
        }

        // Fallback to last variant
        return this.variants[this.variants.length - 1];
    }
}
