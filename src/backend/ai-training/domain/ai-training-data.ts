export interface AiGenerationMetrics {
    baselineTokens: number;
    baselineTimeMs: number;
    humanEditTimeMs: number;
}

export type AiTrainingResolution = 'accepted_as_is' | 'human_edited' | 'rejected';

export interface AiTrainingDataProps {
    id: string;
    leadId: string;
    originalPrompt: string;           // What the user typed ("Reforma baño 5m2")
    baselineJson: any;                // What the Multi-Agent System initially predicted
    finalHumanJson: any | null;       // What the human downloaded (if they made edits)
    resolution: AiTrainingResolution; // Categorization to filter the dataset later
    metrics: AiGenerationMetrics;
    createdAt: Date;
    projectId?: string;               // Optional link to a specific project scope
}

export class AiTrainingData {
    private props: AiTrainingDataProps;

    constructor(props: AiTrainingDataProps) {
        this.validateProps(props);
        this.props = props;
    }

    private validateProps(props: AiTrainingDataProps): void {
        if (!props.id) throw new Error("AiTrainingData must have an ID");
        if (!props.leadId) throw new Error("AiTrainingData must be linked to a leadId");
        if (!props.originalPrompt || props.originalPrompt.trim() === '') {
            throw new Error("AiTrainingData must have the originalPrompt");
        }
    }

    // Factory method for capturing a completely new interaction
    public static captureInteraction(
        id: string,
        leadId: string,
        originalPrompt: string,
        baselineJson: any,
        metrics: Omit<AiGenerationMetrics, 'humanEditTimeMs'>,
        projectId?: string
    ): AiTrainingData {
        return new AiTrainingData({
            id,
            leadId,
            originalPrompt,
            baselineJson,
            finalHumanJson: null,
            resolution: 'rejected', // Defaults to rejected until they actually download/save it
            metrics: {
                ...metrics,
                humanEditTimeMs: 0
            },
            createdAt: new Date(),
            projectId
        });
    }

    // Domain behavior: The human edits the budget and decides to save/download it
    public recordHumanEdit(finalJson: any, timeSpentEditingMs: number): void {
        this.props.finalHumanJson = finalJson;
        this.props.metrics.humanEditTimeMs = timeSpentEditingMs;

        // Simple heuristic to see if they actually changed something
        const isSame = JSON.stringify(this.props.baselineJson) === JSON.stringify(finalJson);
        this.props.resolution = isSame ? 'accepted_as_is' : 'human_edited';
    }

    // Convert back to simple map for DB storage
    public toMap(): any {
        const { projectId, ...rest } = this.props;
        return {
            ...rest,
            createdAt: this.props.createdAt.toISOString(),
            ...(projectId ? { projectId } : {})
        };
    }

    // Rehydrate from DB
    public static fromMap(data: any): AiTrainingData {
        return new AiTrainingData({
            ...data,
            createdAt: new Date(data.createdAt)
        });
    }

    get id(): string { return this.props.id; }
    get leadId(): string { return this.props.leadId; }
    get baselineJson(): any { return this.props.baselineJson; }
    get originalPrompt(): string { return this.props.originalPrompt; }
    get finalHumanJson(): any { return this.props.finalHumanJson; }
    get resolution(): AiTrainingResolution { return this.props.resolution; }
    get createdAt(): Date { return this.props.createdAt; }
}
