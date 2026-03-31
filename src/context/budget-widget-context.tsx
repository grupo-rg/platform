'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { usePathname } from 'next/navigation';

export type BudgetMode = 'general' | 'pool' | 'reform' | 'new-build' | 'kitchen' | 'bathroom' | 'wizard' | 'chat' | 'agenda';

type WidgetContextType = {
    isOpen: boolean;
    activeMode: BudgetMode;
    openWidget: (mode?: BudgetMode) => void;
    closeWidget: () => void;
    toggleWidget: () => void;
    leadId: string | null;
    setLeadId: (id: string | null) => void;
    initialPrompt: string;
    setInitialPrompt: (prompt: string) => void;
};

const BudgetWidgetContext = createContext<WidgetContextType | undefined>(undefined);

export function BudgetWidgetProvider({ children }: { children: ReactNode }) {
    const [isOpen, setIsOpen] = useState(false);
    const [activeMode, setActiveMode] = useState<BudgetMode>('general');
    const [leadId, setLeadIdState] = useState<string | null>(null);
    const [initialPrompt, setInitialPrompt] = useState<string>('');
    const pathname = usePathname();

    // Hydrate leadId from localStorage on mount safely
    useEffect(() => {
        try {
            const savedItem = window.localStorage.getItem('nexoai_lead_id');
            if (savedItem) {
                setLeadIdState(savedItem);
            }
        } catch (error) {
            console.warn("Error reading localStorage", error);
        }
    }, []);

    // Custom setter to persist leadId
    const setLeadId = (id: string | null) => {
        try {
            setLeadIdState(id);
            if (id) {
                window.localStorage.setItem('nexoai_lead_id', id);
            } else {
                window.localStorage.removeItem('nexoai_lead_id');
            }
        } catch (error) {
            console.warn("Error setting localStorage", error);
        }
    };

    // Helper to determine mode from path
    const getModeFromPath = (path: string): BudgetMode => {
        if (path.includes('/services/piscinas')) return 'pool';
        if (path.includes('/services/reformas') || path.includes('/transformations')) return 'reform';
        if (path.includes('/services/cocinas')) return 'kitchen';
        if (path.includes('/services/banos')) return 'bathroom';
        if (path.includes('/obra-nueva')) return 'new-build';
        return 'general';
    };

    // Smart Context Detection
    useEffect(() => {
        if (!pathname) return;
        setActiveMode(getModeFromPath(pathname));
    }, [pathname]);

    const openWidget = (mode?: BudgetMode) => {
        if (mode) setActiveMode(mode);
        setIsOpen(true);
    };

    const closeWidget = () => {
        setIsOpen(false);
        // Reset to default mode for this page after animation
        setTimeout(() => {
            if (pathname) setActiveMode(getModeFromPath(pathname));
        }, 500);
    };

    const toggleWidget = () => setIsOpen(prev => !prev);

    return (
        <BudgetWidgetContext.Provider value={{ isOpen, activeMode, openWidget, closeWidget, toggleWidget, leadId, setLeadId, initialPrompt, setInitialPrompt }}>
            {children}
        </BudgetWidgetContext.Provider>
    );
}

export function useWidgetContext() {
    const context = useContext(BudgetWidgetContext);
    if (context === undefined) {
        throw new Error('useWidgetContext must be used within a BudgetWidgetProvider');
    }
    return context;
}
