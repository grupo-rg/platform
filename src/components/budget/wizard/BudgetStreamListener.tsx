'use client';

import { useEffect, useRef } from 'react';
import { useWidgetContext } from '@/context/budget-widget-context';
import { sileo } from 'sileo';
import { CheckCircle2, Hammer, Package, Search } from 'lucide-react';
import { cn } from '@/lib/utils'; // Assuming you have this utility

type GenerationEvent = {
    type: 'subtasks_extracted' | 'item_resolving' | 'item_resolved' | 'validation_start' | 'complete' | 'error' |
    'chapter_start' | 'decomposition_start' | 'vector_search';
    leadId: string;
    data: any;
    timestamp: number;
};

export function BudgetStreamListener() {
    const { leadId } = useWidgetContext();
    const eventSourceRef = useRef<EventSource | null>(null);
    const processedEvents = useRef<Set<number>>(new Set());

    useEffect(() => {
        if (!leadId) return;

        // Close existing connection if any
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
        }

        const url = `/api/budget/stream?leadId=${leadId}`;
        const es = new EventSource(url);
        eventSourceRef.current = es;

        es.onmessage = (event) => {
            console.log("[BudgetStream] Raw event received:", event.data); // DEBUG
            try {
                const parsed: GenerationEvent = JSON.parse(event.data);
                console.log("[BudgetStream] Parsed event:", parsed.type, parsed.data); // DEBUG

                // Deduplicate events if needed (timestamp check)
                if (processedEvents.current.has(parsed.timestamp)) {
                    console.log("[BudgetStream] Duplicate event skipped:", parsed.timestamp); // DEBUG
                    return;
                }
                processedEvents.current.add(parsed.timestamp);

                handleGenerationEvent(parsed);
            } catch (e) {
                console.error("[BudgetStream] Parse error or heartbeat:", e); // DEBUG
            }
        };

        es.onerror = (err) => {
            console.error("[BudgetStream] Connection error:", err); // DEBUG
        };

        return () => {
            es.close();
        };
    }, [leadId]);

    return null; // Headless component
}

function handleGenerationEvent(event: GenerationEvent) {
    switch (event.type) {
        case 'subtasks_extracted':
            sileo.info({
                title: "Análisis Completado",
                description: `Identificadas ${event.data.count} tareas constructivas.`,
                duration: 4000,
                icon: <Search className="text-blue-500" />
            });
            break;

        case 'chapter_start':
            sileo.info({
                title: "Nuevo Capítulo",
                description: `Procesando: ${event.data.name}`,
                duration: 3000,
                icon: <Package className="text-purple-500" />
            });
            break;

        case 'decomposition_start':
            // Optional: Maybe too noisy? Let's show it but shorter
            /*
            sileo.loading({
                title: "Desglosando...",
                description: event.data.description,
                duration: 2000
            });
            */
            break;

        case 'vector_search':
            // "Searching PriceBook..."
            sileo.show({
                title: "Consultando Precios",
                description: `Buscando: "${event.data.query}"`,
                duration: 2500,
                position: 'bottom-right',
                icon: <Search className="text-amber-500 animate-pulse" />
            });
            break;

        case 'item_resolved':
            // Inline items are now handled natively inside BudgetGenerationProgress.tsx
            // We no longer trigger Sileo popups for every single item to prevent clutter.
            break;

        case 'complete':
            sileo.success({
                title: "Presupuesto Generado",
                description: `Generadas ${event.data.itemCount} partidas. Total: ${formatCurrency(event.data.total)}`,
                duration: 6000,
                icon: <CheckCircle2 className="text-green-500" />
            });
            break;
    }
}

function formatCurrency(val: number) {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(val);
}
