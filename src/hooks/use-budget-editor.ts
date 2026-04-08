import { useReducer, useCallback, useEffect, useState } from 'react';
import { BudgetLineItem, BudgetCostBreakdown } from '@/backend/budget/domain/budget';
import { BudgetEditorState, BudgetEditorAction, EditableBudgetLineItem, BudgetConfig, ExecutionMode } from '@/types/budget-editor';

// Simple ID generator
const generateId = () => Math.random().toString(36).substr(2, 9);

const calculateBreakdown = (items: EditableBudgetLineItem[], config: BudgetConfig, executionMode: ExecutionMode = 'complete'): BudgetCostBreakdown => {
    // 1. Calculate base execution price (Complete Mode)
    const rawMaterialExecutionPrice = items.reduce((sum, item) => sum + parseFloat(String(item.item?.totalPrice || 0)), 0);

    // 2. Calculate deductions based on executionMode
    let variableCostsToDeduct = 0;
    
    if (executionMode === 'execution') {
        variableCostsToDeduct = items.reduce((sum, item) => {
            if (!item.item?.breakdown) return sum;
            const vCost = item.item.breakdown
                .filter((comp: any) => comp.is_variable === true || comp.is_variable === 'true' || comp.isVariable === true)
                .reduce((acc: number, comp: any) => {
                    const cPrice = comp.unitPrice || comp.price || 0;
                    const cQuantity = comp.quantity || comp.yield || 1;
                    return acc + (comp.totalPrice || comp.total || (cPrice * cQuantity));
                }, 0);
            return sum + (vCost * (item.item?.quantity || 1));
        }, 0);
    } else if (executionMode === 'labor') {
        const laborCosts = items.reduce((sum, item) => {
            if (!item.item?.breakdown) return sum;
            const moCost = item.item.breakdown
                .filter((comp: any) => comp.code && String(comp.code).toLowerCase().startsWith('mo'))
                .reduce((acc: number, comp: any) => {
                    const cPrice = comp.unitPrice || comp.price || 0;
                    const cQuantity = comp.quantity || comp.yield || 1;
                    return acc + (comp.totalPrice || comp.total || (cPrice * cQuantity));
                }, 0);
            return sum + (moCost * (item.item?.quantity || 1));
        }, 0);
        variableCostsToDeduct = rawMaterialExecutionPrice - laborCosts;
    }

    // Calculation helper
    const calcSubtotal = (pem: number) => {
        const gh = pem * (config.marginGG / 100);
        const bi = pem * (config.marginBI / 100);
        return pem + gh + bi;
    };
    const round = (num: number) => Math.round((num + Number.EPSILON) * 100) / 100;

    // We must ensure the execution pem doesn't go below 0
    const pemComplete = isNaN(rawMaterialExecutionPrice) ? 0 : rawMaterialExecutionPrice;
    const activePem = Math.max(0, pemComplete - variableCostsToDeduct);

    // Selected Mode Values
    const activeSubtotal = calcSubtotal(activePem);
    const activeTax = activeSubtotal * (config.tax / 100);
    
    // Explicit tracking
    const completeTotal = calcSubtotal(pemComplete) * (1 + (config.tax / 100));
    const executionOnlyTotal = calcSubtotal(Math.max(0, pemComplete - variableCostsToDeduct)) * (1 + (config.tax / 100)); // Still tracks the active total, not just "execution" strictly. We can leave it named this way or rename it in types.

    return {
        materialExecutionPrice: round(activePem),
        overheadExpenses: round(activePem * (config.marginGG / 100)),
        industrialBenefit: round(activePem * (config.marginBI / 100)),
        tax: round(activeTax),
        globalAdjustment: 0,
        total: round(activeSubtotal + activeTax),
        completeTotal: round(completeTotal),
        executionOnlyTotal: round(executionOnlyTotal)
    };
};

const initialState: BudgetEditorState = {
    items: [],
    chapters: [],
    costBreakdown: {
        materialExecutionPrice: 0,
        overheadExpenses: 0,
        industrialBenefit: 0,
        tax: 0,
        globalAdjustment: 0,
        total: 0
    },
    config: { marginGG: 13, marginBI: 6, tax: 21 }, // Default, can be overridden by INIT_STATE
    historyIndex: -1,
    hasUnsavedChanges: false,
    isSaving: false,
    executionMode: 'complete',
    history: []
};

// Add new INIT_STATE action
export type BudgetEditorInitAction = { type: 'INIT_STATE'; payload: { items: EditableBudgetLineItem[]; config?: BudgetConfig; executionMode?: ExecutionMode } };

function budgetEditorReducer(state: BudgetEditorState, action: BudgetEditorAction | BudgetEditorInitAction): BudgetEditorState {
    switch (action.type) {
        case 'INIT_STATE': {
            console.log('[BudgetEditor] INIT_STATE triggered with', action.payload.items.length, 'items');
            const newItems = action.payload.items.map(item => ({
                ...item,
                id: item.id || generateId(),
                isEditing: false,
                isDirty: false,
                chapter: item.chapter || 'General',
                order: item.order || 0
            }));

            const derivedChapters = Array.from(new Set(newItems.map(i => i.chapter).filter(Boolean) as string[]));
            const chapters = derivedChapters.length > 0 ? derivedChapters : ['General'];
            const config = action.payload.config || state.config;
            const executionMode = action.payload.executionMode ?? state.executionMode;

            const breakdown = calculateBreakdown(newItems, config, executionMode);
            return {
                ...state,
                items: newItems,
                chapters: chapters,
                config: config,
                executionMode: executionMode,
                costBreakdown: breakdown,
                history: [{ items: newItems, timestamp: Date.now() }],
                historyIndex: 0,
                hasUnsavedChanges: false
            };
        }
        case 'SET_ITEMS': {
            console.log('[BudgetEditor] SET_ITEMS triggered with', action.payload.length, 'items');
            // Extract unique chapters or default to 'General'
            const newItems = action.payload.map(item => ({
                ...item,
                id: item.id || generateId(),
                isEditing: false,
                isDirty: false,
                chapter: item.chapter || 'General', // Default chapter
                order: item.order || 0, // Ensure order exists
                originalState: item.originalState || (item.item ? {
                    unitPrice: Number(item.item.unitPrice || 0),
                    quantity: Number(item.item.quantity || 0),
                    description: item.item.description || '',
                    unit: item.item.unit || ''
                } : undefined) // Snapshot with strict defaults
            }));

            const derivedChapters = Array.from(new Set(newItems.map(i => i.chapter).filter(Boolean) as string[]));
            const chapters = derivedChapters.length > 0 ? derivedChapters : ['General'];

            const breakdown = calculateBreakdown(newItems, state.config, state.executionMode);
            return {
                ...state,
                items: newItems,
                chapters: chapters,
                costBreakdown: breakdown,
                history: [{ items: newItems, timestamp: Date.now() }],
                historyIndex: 0
            };
        }

        case 'SET_EXECUTION_MODE': {
            const newExecutionMode = action.payload;
            const newBreakdown = calculateBreakdown(state.items, state.config, newExecutionMode);
            return {
                ...state,
                executionMode: newExecutionMode,
                costBreakdown: newBreakdown,
            };
        }

        case 'ADD_CHAPTER': {
            return {
                ...state,
                chapters: [...state.chapters, action.payload]
            };
        }

        case 'REMOVE_CHAPTER': {
            const chapterToRemove = action.payload;
            const newChapters = state.chapters.filter(c => c !== chapterToRemove);

            // DELETE items in that chapter (User intent: remove cost)
            const newItems = state.items.filter(item => item.chapter !== chapterToRemove);

            // Ensure we have at least 'General' if all chapters removed
            if (newChapters.length === 0 && !newChapters.includes('General')) {
                newChapters.push('General');
            }

            const breakdown = calculateBreakdown(newItems, state.config, state.executionMode);

            const newHistory = state.history.slice(0, state.historyIndex + 1);
            newHistory.push({ items: newItems, timestamp: Date.now() });

            return {
                ...state,
                items: newItems,
                chapters: newChapters,
                costBreakdown: breakdown,
                history: newHistory,
                historyIndex: newHistory.length - 1,
                hasUnsavedChanges: true
            };
        } case 'RENAME_CHAPTER': {
            const { oldName, newName } = action.payload;
            const newChapters = state.chapters.map(c => c === oldName ? newName : c);
            const newItems = state.items.map(item =>
                item.chapter === oldName
                    ? { ...item, chapter: newName, isDirty: true }
                    : item
            );

            return {
                ...state,
                items: newItems,
                chapters: newChapters,
                hasUnsavedChanges: true
            };
        }

        case 'REORDER_CHAPTERS': {
            return {
                ...state,
                chapters: action.payload,
                hasUnsavedChanges: true
            };
        }

        case 'UPDATE_ITEM': {
            const updatedItems = state.items.map(oldItem => {
                if (oldItem.id !== action.payload.id) return oldItem;

                // Grab the intended changes
                const changes = action.payload.changes;
                const payloadItemChanges = changes.item;
                const prevUnitPrice = Number(oldItem.item?.unitPrice || 0);
                
                // 1. Proportional Scaling Logic for Breakdown
                let newBreakdown = oldItem.item?.breakdown;
                if (payloadItemChanges && payloadItemChanges.unitPrice !== undefined && newBreakdown) {
                    const newUnitPrice = Number(payloadItemChanges.unitPrice);
                    if (prevUnitPrice > 0 && newUnitPrice !== prevUnitPrice) {
                        const scaleFactor = newUnitPrice / prevUnitPrice;
                        newBreakdown = newBreakdown.map(comp => {
                            const newCompPrice = (comp.price || comp.unitPrice || 0) * scaleFactor;
                            const qty = comp.yield || comp.quantity || 1;
                            const newTotal = newCompPrice * qty;
                            return {
                                ...comp,
                                price: newCompPrice,
                                unitPrice: newCompPrice, // Keep compatibility with both structures
                                total: newTotal,
                                totalPrice: newTotal
                            };
                        });
                    }
                }

                // 2. Merge all changes
                const mergedItem = {
                    ...oldItem,
                    ...changes,
                    isDirty: true
                };

                // 3. Re-assign scaled breakdown and fixed properties
                if (mergedItem.item) {
                    if (newBreakdown) {
                        mergedItem.item.breakdown = newBreakdown;
                    }
                    const quantity = mergedItem.item.quantity || 0;
                    const unitPrice = mergedItem.item.unitPrice || 0;
                    mergedItem.item.totalPrice = quantity * unitPrice;
                }

                return mergedItem;
            });

            const breakdown = calculateBreakdown(updatedItems, state.config, state.executionMode);

            // Add to history
            const newHistory = state.history.slice(0, state.historyIndex + 1);
            newHistory.push({ items: updatedItems, timestamp: Date.now() });

            return {
                ...state,
                items: updatedItems,
                costBreakdown: breakdown,
                history: newHistory,
                historyIndex: newHistory.length - 1,
                hasUnsavedChanges: true
            };
        }

        case 'REORDER_ITEMS': {
            // Note: In grouped view, REORDER_ITEMS might receive a subset or the whole list.
            // If the UI passes ONLY the modified group, we need to merge.
            // But if we simply update the 'order' of ALL items provided in payload, keeping others intact:

            const payloadItems = action.payload;

            // Create a map for quick lookup of payload items
            const payloadMap = new Map(payloadItems.map((item, index) => [item.id, index]));

            const newItems = state.items.map(item => {
                const payloadIndex = payloadMap.get(item.id);
                if (payloadIndex !== undefined) {
                    // This item is in the reordered payload, update it
                    return {
                        ...payloadItems[payloadIndex],
                        order: payloadIndex + 1 // Or keep relative order logic if needed
                    };
                }
                return item;
            });

            // Wait, if we use Framer Motion per group, 'payload' is just that group's items in new order.
            // We need to merge that back into the main list, respecting the chapter.

            // Actually, for simplicity, let `reorderItems` accept the FULL list if possible, 
            // OR if we pass a chunk, we replace that chunk in the state.

            // STRATEGY: The payload contains the new state of a specific set of items (e.g. a Chapter).
            // We should replace these items in the main state.

            const updatedIds = new Set(payloadItems.map(i => i.id));
            const mergedItems = state.items.map(item => {
                if (updatedIds.has(item.id)) {
                    return payloadItems.find(p => p.id === item.id)!;
                }
                return item;
            });

            // Re-sort based on chapters? No, the order within the chapter is what matters.
            // The payload items should already have their updated 'order' property if we set it before dispatch.
            // IF NOT, we should set it here.

            // Let's assume the payload items come in the correct order.
            // We assign them sequential indices relative to their chapter? 
            // Or just trust the payload order.

            // Simple merge:
            const history = state.history.slice(0, state.historyIndex + 1);
            history.push({ items: mergedItems, timestamp: Date.now() });

            return {
                ...state,
                items: mergedItems,
                history: history,
                historyIndex: history.length - 1,
                hasUnsavedChanges: true
            };
        }

        case 'ADD_ITEM': {
            const newItem = {
                ...action.payload,
                id: action.payload.id || generateId(),
                isEditing: false,
                isDirty: true,
                chapter: action.payload.chapter || 'General',
                order: state.items.length + 1
            };

            const newItems = [...state.items, newItem];

            // Ensure chapter exists
            const newChapters = state.chapters.includes(newItem.chapter)
                ? state.chapters
                : [...state.chapters, newItem.chapter];

            const breakdown = calculateBreakdown(newItems, state.config, state.executionMode);

            const newHistory = state.history.slice(0, state.historyIndex + 1);
            newHistory.push({ items: newItems, timestamp: Date.now() });

            return {
                ...state,
                items: newItems,
                chapters: newChapters,
                costBreakdown: breakdown,
                history: newHistory,
                historyIndex: newHistory.length - 1,
                hasUnsavedChanges: true
            };
        }

        case 'DUPLICATE_ITEM': {
            const originalItem = state.items.find(i => i.id === action.payload);
            if (!originalItem) return state;

            const newItem: EditableBudgetLineItem = {
                ...originalItem,
                id: generateId(),
                isDirty: true,
                originalTask: `${originalItem.originalTask} (Copia)`,
                item: originalItem.item ? { ...originalItem.item, description: `${originalItem.item.description}` } as any : undefined,
                order: originalItem.order + 0.5
            };

            // Replace order in array
            const originalIndex = state.items.findIndex(i => i.id === action.payload);
            const newItems = [...state.items];
            newItems.splice(originalIndex + 1, 0, newItem);

            const breakdown = calculateBreakdown(newItems, state.config, state.executionMode);

            const newHistory = state.history.slice(0, state.historyIndex + 1);
            newHistory.push({ items: newItems, timestamp: Date.now() });

            return {
                ...state,
                items: newItems,
                costBreakdown: breakdown,
                history: newHistory,
                historyIndex: newHistory.length - 1,
                hasUnsavedChanges: true
            };
        }

        case 'REMOVE_ITEM': {
            const newItems = state.items.filter(item => item.id !== action.payload);
            const breakdown = calculateBreakdown(newItems, state.config, state.executionMode);

            const newHistory = state.history.slice(0, state.historyIndex + 1);
            newHistory.push({ items: newItems, timestamp: Date.now() });

            return {
                ...state,
                items: newItems,
                costBreakdown: breakdown,
                history: newHistory,
                historyIndex: newHistory.length - 1,
                hasUnsavedChanges: true
            };
        }

        case 'UNDO':
            if (state.historyIndex <= 0) return state;
            const prevVersion = state.history[state.historyIndex - 1];
            return {
                ...state,
                items: prevVersion.items,
                costBreakdown: calculateBreakdown(prevVersion.items, state.config, state.executionMode),
                historyIndex: state.historyIndex - 1,
                hasUnsavedChanges: true
            };

        case 'REDO':
            if (state.historyIndex >= state.history.length - 1) return state;
            const nextVersion = state.history[state.historyIndex + 1];
            return {
                ...state,
                items: nextVersion.items,
                costBreakdown: calculateBreakdown(nextVersion.items, state.config, state.executionMode),
                historyIndex: state.historyIndex + 1,
                hasUnsavedChanges: true
            };

        case 'SET_EXECUTION_MODE': {
            const newMode = action.payload;
            return {
                ...state,
                executionMode: newMode,
                costBreakdown: calculateBreakdown(state.items, state.config, newMode)
            };
        }

        case 'UPDATE_CONFIG': {
            const newConfig = { ...state.config, ...action.payload };
            return {
                ...state,
                config: newConfig,
                costBreakdown: calculateBreakdown(state.items, newConfig, state.executionMode),
                hasUnsavedChanges: true
            };
        }

        case 'APPLY_MARKUP': {
            const { scope, targetId, percentage } = action.payload;
            const factor = 1 + (percentage / 100);

            const newItems = state.items.map(item => {
                let apply = false;
                if (scope === 'global') apply = true;
                else if (scope === 'chapter' && item.chapter === targetId) apply = true;
                else if (scope === 'item' && item.id === targetId) apply = true;

                if (apply && item.item) {
                    const currentPrice = Number(item.item.unitPrice || 0);
                    const newUnitPrice = currentPrice * factor;
                    const quantity = Number(item.item.quantity || 1);

                    // Scale breakdown proportionally
                    let newBreakdown = item.item.breakdown;
                    if (newBreakdown && currentPrice > 0) {
                        newBreakdown = newBreakdown.map(comp => {
                            const newCompPrice = (comp.price || comp.unitPrice || 0) * factor;
                            const qty = comp.yield || comp.quantity || 1;
                            const newTotal = newCompPrice * qty;
                            return {
                                ...comp,
                                price: newCompPrice,
                                unitPrice: newCompPrice,
                                total: newTotal,
                                totalPrice: newTotal
                            };
                        });
                    }

                    return {
                        ...item,
                        isDirty: true,
                        item: {
                            ...item.item,
                            unitPrice: newUnitPrice,
                            totalPrice: quantity * newUnitPrice,
                            breakdown: newBreakdown
                        }
                    };
                }
                return item;
            });

            const breakdown = calculateBreakdown(newItems, state.config, state.executionMode);

            const newHistory = state.history.slice(0, state.historyIndex + 1);
            newHistory.push({ items: newItems, timestamp: Date.now() });

            return {
                ...state,
                items: newItems,
                costBreakdown: breakdown,
                history: newHistory,
                historyIndex: newHistory.length - 1,
                hasUnsavedChanges: true
            };
        }

        case 'SAVE_START':
            return { ...state, isSaving: true };

        case 'SAVE_SUCCESS':
            return { ...state, isSaving: false, hasUnsavedChanges: false, lastSavedAt: action.payload };

        case 'SAVE_ERROR':
            return { ...state, isSaving: false };

        default:
            return state;
    }
}

export function useBudgetEditor(initialItems: BudgetLineItem[] = [], initialConfig?: BudgetConfig) {
    const [state, dispatch] = useReducer(budgetEditorReducer, initialState);

    const [isInitialized, setIsInitialized] = useState(false);

    // Initialize items only on the first load to prevent race conditions when saving
    useEffect(() => {
        if (!isInitialized) {
            if (initialItems && initialItems.length > 0) {
                console.log('[useBudgetEditor] Initializing state with initialItems:', initialItems.length);
                dispatch({ type: 'INIT_STATE', payload: { items: initialItems as any, config: initialConfig } });
                setIsInitialized(true);
            } else if (initialConfig && state.items.length === 0) {
                dispatch({ type: 'INIT_STATE', payload: { items: [], config: initialConfig } });
                setIsInitialized(true);
            }
        }
    }, [initialItems, initialConfig, isInitialized]);

    // Prevent accidental exit with unsaved changes
    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (state.hasUnsavedChanges) {
                e.preventDefault();
                e.returnValue = ''; // Standard for modern browsers
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [state.hasUnsavedChanges]);

    const updateItem = useCallback((id: string, changes: Partial<EditableBudgetLineItem>) => {
        dispatch({ type: 'UPDATE_ITEM', payload: { id, changes } });
    }, []);

    const reorderItems = useCallback((newItems: EditableBudgetLineItem[]) => {
        // When reordering a chapter, we receive just that chapter's items in new order.
        // We need to ensure they have the correct 'order' field updated.
        const reindexedItems = newItems.map((item, index) => ({
            ...item,
            order: index + 1 // Reset order for this chunk
        }));
        dispatch({ type: 'REORDER_ITEMS', payload: reindexedItems });
    }, []);

    const addItem = useCallback((item: Partial<EditableBudgetLineItem>) => {
        // Prepare item with defaults
        const newItem: EditableBudgetLineItem = {
            id: generateId(),
            isEditing: false,
            isDirty: true,
            chapter: 'General',
            ...item
        } as EditableBudgetLineItem;

        dispatch({ type: 'ADD_ITEM', payload: newItem });
    }, []);

    const removeItem = useCallback((id: string) => {
        dispatch({ type: 'REMOVE_ITEM', payload: id });
    }, []);

    const undo = useCallback(() => dispatch({ type: 'UNDO' }), []);
    const redo = useCallback(() => dispatch({ type: 'REDO' }), []);

    const saveStart = useCallback(() => dispatch({ type: 'SAVE_START' }), []);
    const saveSuccess = useCallback(() => dispatch({ type: 'SAVE_SUCCESS', payload: new Date() }), []);
    const saveError = useCallback(() => dispatch({ type: 'SAVE_ERROR' }), []);

    // New Actions
    const addChapter = useCallback((name: string) => dispatch({ type: 'ADD_CHAPTER', payload: name }), []);
    const removeChapter = useCallback((name: string) => dispatch({ type: 'REMOVE_CHAPTER', payload: name }), []);
    const renameChapter = useCallback((oldName: string, newName: string) => dispatch({ type: 'RENAME_CHAPTER', payload: { oldName, newName } }), []);
    const reorderChapters = useCallback((newOrder: string[]) => dispatch({ type: 'REORDER_CHAPTERS', payload: newOrder }), []);

    const setExecutionMode = useCallback((mode: ExecutionMode) => dispatch({ type: 'SET_EXECUTION_MODE', payload: mode }), []);

    const updateConfig = useCallback((config: Partial<BudgetConfig>) => dispatch({ type: 'UPDATE_CONFIG', payload: config }), []);

    const applyMarkup = useCallback((scope: 'global' | 'chapter' | 'item', percentage: number, targetId?: string) =>
        dispatch({ type: 'APPLY_MARKUP', payload: { scope, targetId, percentage } }), []);

    // Feature: Duplicate
    const duplicateItem = useCallback((id: string) => dispatch({ type: 'DUPLICATE_ITEM', payload: id }), []);

    return {
        state,
        updateItem,
        addItem,
        reorderItems,
        removeItem,
        duplicateItem, // Export
        undo,
        redo,
        saveStart,
        saveSuccess,
        saveError,
        canUndo: state.historyIndex > 0,
        canRedo: state.historyIndex < state.history.length - 1,
        // Chapters
        addChapter,
        removeChapter,
        renameChapter,
        reorderChapters,
        setExecutionMode,
        updateConfig,
        applyMarkup
    };
}
