export type DataSourceType = 'internal_admin' | 'public_demo' | 'baseline_migration';
export type HeuristicStatus = 'golden' | 'pending_review' | 'rejected';

export interface HeuristicContext {
    budgetId: string;
    pdfOriginalText?: string | null;
    originalDescription?: string | null;
    originalQuantity?: number | null;
    originalUnit?: string | null;
}

export interface HeuristicAIInferenceTrace {
    proposedCandidateId?: string | null;
    proposedUnitPrice: number;
    aiReasoning?: string | null;
}

export interface HeuristicHumanCorrection {
    selectedCandidateTuple?: string | null;
    selectedCandidateCode?: string | null;
    correctedUnitPrice?: number | null;
    correctedUnit?: string | null;
    heuristicRule: string;
    correctedByUserId?: string | null;
}

/**
 * HeuristicFragment represents a single unit of Reinforcement Learning / In-Context Learning
 * extracted from a human override. Next.js creates this and Python consumes it.
 */
export interface HeuristicFragment {
    id: string; // Typically filled by Firestore upon creation, so might be optional on creation via Omit
    sourceType: DataSourceType;
    status: HeuristicStatus;
    context: HeuristicContext;
    aiInferenceTrace: HeuristicAIInferenceTrace;
    humanCorrection: HeuristicHumanCorrection;
    tags: string[];
    timestamp: Date | string; // Handled by Firebase Timestamp or ISO string
}
