export type ABTestVariant = 'A' | 'B' | 'C' | 'CONTROL';
export type CommunicationChannel = 'EMAIL' | 'WHATSAPP';

export interface SequenceStep {
    id: string;
    dayOffset: number;       // Días desde la inscripción (0 = inmediato, 2 = a los dos días)
    channel: CommunicationChannel;
    templateId: string;      // ID de la plantilla en Sendgrid o Meta
    variantTarget: ABTestVariant; // Indica en qué variante aplica este mensaje
}

/**
 * Sequence Aggregate Root
 * Representa una Campaña de Nutrición de Marketing y sus reglas (Ej. VSL Pymes).
 */
export class Sequence {
    constructor(
        public readonly id: string,
        public name: string,
        public steps: SequenceStep[],
        public active: boolean
    ) {}

    static create(id: string, name: string, steps: SequenceStep[]): Sequence {
        return new Sequence(id, name, steps, true);
    }
}

/**
 * Enrollment Entity
 * Representa el estado actual de un Lead transitando por un Sequence.
 */
export class Enrollment {
    constructor(
        public readonly id: string,
        public readonly leadId: string,
        public readonly sequenceId: string,
        public variant: ABTestVariant,
        public currentStepIndex: number,
        public active: boolean,
        public enrolledAt: Date,
        public nextExecutionTime: Date | null,
        public updatedAt: Date,
        public openedAt: Date | null = null,
        public context: Record<string, any> = {}
    ) {}

    static start(id: string, leadId: string, sequenceId: string, variant: ABTestVariant, nextExecutionTime: Date = new Date(), context: Record<string, any> = {}): Enrollment {
        return new Enrollment(
            id,
            leadId,
            sequenceId,
            variant,
            0,
            true,
            new Date(),
            nextExecutionTime,
            new Date(),
            null,
            context
        );
    }

    advanceToStep(stepIndex: number, nextExecution: Date | null): void {
        this.currentStepIndex = stepIndex;
        this.nextExecutionTime = nextExecution;
        this.updatedAt = new Date();
    }

    markAsOpened(): void {
        if (!this.openedAt) {
            this.openedAt = new Date();
            this.updatedAt = new Date();
        }
    }

    complete(): void {
        this.active = false;
        this.nextExecutionTime = null;
        this.updatedAt = new Date();
    }

    cancel(): void {
        this.active = false;
        this.nextExecutionTime = null;
        this.updatedAt = new Date();
    }
}
