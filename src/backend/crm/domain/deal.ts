export enum PipelineStage {
    NEW_LEAD = 'NEW_LEAD',
    PUBLIC_DEMO_COMPLETED = 'PUBLIC_DEMO_COMPLETED',
    SALES_VIDEO_WATCHED = 'SALES_VIDEO_WATCHED',
    SALES_CALL_SCHEDULED = 'SALES_CALL_SCHEDULED',
    PROPOSAL_SENT = 'PROPOSAL_SENT',
    CLOSED_WON = 'CLOSED_WON',
    CLOSED_LOST = 'CLOSED_LOST'
}

export interface StageHistoryEntry {
    stage: PipelineStage;
    timestamp: Date;
}

/**
 * Deal Aggregate Root
 * Representa una oportunidad de negocio asociada a un Lead en el embudo comercial.
 */
export class Deal {
    constructor(
        public readonly id: string,
        public readonly leadId: string,
        public stage: PipelineStage,
        public estimatedValue: number,
        public readonly createdAt: Date,
        public updatedAt: Date,
        public stageHistory: StageHistoryEntry[] = [],
        public metadata: Record<string, any> = {}
    ) {}

    static create(id: string, leadId: string): Deal {
        const initialStage = PipelineStage.NEW_LEAD;
        return new Deal(
            id,
            leadId,
            initialStage,
            0,
            new Date(),
            new Date(),
            [{ stage: initialStage, timestamp: new Date() }],
            {}
        );
    }

    moveToStage(newStage: PipelineStage): void {
        if (this.stage === newStage) return;
        this.stage = newStage;
        this.stageHistory.push({ stage: newStage, timestamp: new Date() });
        this.updatedAt = new Date();
    }

    updateEstimatedValue(value: number): void {
        if (value < 0) throw new Error("Estimated value cannot be negative.");
        this.estimatedValue = value;
        this.updatedAt = new Date();
    }
}
