import { BudgetCostBreakdown, BudgetBreakdownComponent } from '@/backend/budget/domain/budget';

export interface LegacyBudgetLineItemDetails {
    quantity: number;
    unit: string;
    unitPrice: number;
    totalPrice?: number;
    description: string;
    code?: string;
}

export interface EditableBudgetLineItem {
    id: string;
    order: number;
    originalTask?: string;
    original_item?: any; // Añadido para preservar el OCR PDF de entrada
    type?: 'PARTIDA' | 'MATERIAL'; // Distinction for Adaptive UI

    // The legacy grid expects a nested 'item' object for the actual data
    item?: LegacyBudgetLineItemDetails & {
        matchConfidence?: number;
        pricingSource?: string;
        // New fields for Construction Analyst details
        breakdown?: BudgetBreakdownComponent[];
        isRealCost?: boolean;
        note?: string; // New field for analyst notes
        candidates?: any[]; // Alternative RAG candidates for Human-in-the-Loop selection
        alternativeCandidates?: any[]; // Alternative RAG candidates from the PDF Multi-Agent flow
        needsHumanReview?: boolean; // Highlight alert for human review
        aiResolution?: any; // Telemetry and reasoning from Zero-Leak pipeline
        ai_justification?: string; // Additional reasoning trace from Python engine
    };

    // Editor State
    isEditing?: boolean;
    isDirty?: boolean;
    valErrors?: Record<string, string>;

    // Grouping
    chapter?: string;
    found?: boolean;

    // Ghost Mode
    originalState?: LegacyBudgetLineItemDetails;
}

export interface BudgetConfig {
    marginGG: number;
    marginBI: number;
    tax: number;
}


export interface BudgetEditorState {
    items: EditableBudgetLineItem[];
    costBreakdown: BudgetCostBreakdown;
    history: {
        items: EditableBudgetLineItem[];
        timestamp: number;
    }[];
    historyIndex: number;
    hasUnsavedChanges: boolean;
    lastSavedAt?: Date;
    isSaving: boolean;
    chapters: string[]; // List of chapter names in order
    isExecutionOnly: boolean; // Toggle for Execution Only mode
    config: BudgetConfig;
}

export type BudgetEditorAction =
    | { type: 'SET_ITEMS'; payload: EditableBudgetLineItem[] }
    | { type: 'UPDATE_ITEM'; payload: { id: string; changes: Partial<EditableBudgetLineItem> } }
    | { type: 'ADD_ITEM'; payload: EditableBudgetLineItem }
    | { type: 'DUPLICATE_ITEM'; payload: string }
    | { type: 'REMOVE_ITEM'; payload: string }
    | { type: 'REORDER_ITEMS'; payload: EditableBudgetLineItem[] }
    | { type: 'ADD_CHAPTER'; payload: string }
    | { type: 'REMOVE_CHAPTER'; payload: string }
    | { type: 'RENAME_CHAPTER'; payload: { oldName: string; newName: string } }
    | { type: 'REORDER_CHAPTERS'; payload: string[] }
    | { type: 'UNDO' }
    | { type: 'REDO' }
    | { type: 'TOGGLE_EXECUTION_MODE' }
    | { type: 'UPDATE_CONFIG'; payload: Partial<BudgetConfig> }
    | { type: 'APPLY_MARKUP'; payload: { scope: 'global' | 'chapter' | 'item'; targetId?: string; percentage: number } }
    | { type: 'SAVE_START' }
    | { type: 'SAVE_SUCCESS'; payload: Date }
    | { type: 'SAVE_ERROR' };
