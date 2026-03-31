'use client';

import React, { createContext, useContext, ReactNode } from 'react';
import { useBudgetEditor } from '@/hooks/use-budget-editor';

// Extract the exact return type of useBudgetEditor
export type BudgetEditorContextType = ReturnType<typeof useBudgetEditor> & {
    // We can also pass along context-specific UI flags like isReadOnly
    isReadOnly?: boolean;
    isAdmin?: boolean;
    leadId?: string;
};

const BudgetEditorContext = createContext<BudgetEditorContextType | undefined>(undefined);

interface BudgetEditorProviderProps {
    children: ReactNode;
    value: BudgetEditorContextType;
}

export function BudgetEditorProvider({ children, value }: BudgetEditorProviderProps) {
    return (
        <BudgetEditorContext.Provider value={value}>
            {children}
        </BudgetEditorContext.Provider>
    );
}

export function useBudgetEditorContext() {
    const context = useContext(BudgetEditorContext);
    if (!context) {
        throw new Error('useBudgetEditorContext must be used within a BudgetEditorProvider');
    }
    return context;
}
