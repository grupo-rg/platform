'use client';

import { useState, useEffect } from 'react';
import { PipelineStage } from '@/backend/crm/domain/deal';

interface DealDTO {
    id: string;
    leadId: string;
    stage: PipelineStage;
    assignedName?: string;
    company?: string;
    web?: string;
    meetUrl?: string;
}

const STAGES = [
    { key: PipelineStage.NEW_LEAD, label: 'Nuevo' },
    { key: PipelineStage.PUBLIC_DEMO_COMPLETED, label: 'Jugó Demo' },
    { key: PipelineStage.SALES_VIDEO_WATCHED, label: 'Vio VSL' },
    { key: PipelineStage.SALES_CALL_SCHEDULED, label: 'Reunión' },
    { key: PipelineStage.PROPOSAL_SENT, label: 'Propuesta' },
    { key: PipelineStage.CLOSED_WON, label: 'Ganado 🎉' }
];

export function CRMKanban() {
    const [deals, setDeals] = useState<DealDTO[]>([]);
    const [draggedDealId, setDraggedDealId] = useState<string | null>(null);

    useEffect(() => {
        // Fetch deals from our backend API route
        fetch('/api/crm/deals')
            .then(res => res.json())
            .then(data => {
                if (data.deals) setDeals(data.deals);
            })
            .catch(err => console.error("Error fetching deals", err));
    }, []);

    const handleDragStart = (dealId: string) => {
        setDraggedDealId(dealId);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault(); // Necessary to allow dropping
    };

    const handleDrop = async (stage: PipelineStage) => {
        if (!draggedDealId) return;

        // Optimistic UI Update
        const targetDeal = deals.find(d => d.id === draggedDealId);
        if (targetDeal && targetDeal.stage !== stage) {
            setDeals(prev => prev.map(d => d.id === draggedDealId ? { ...d, stage } : d));

            try {
                // Call our API Route implemented previously
                const res = await fetch('/api/crm/deals/move', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ leadId: targetDeal.leadId, newStage: stage })
                });

                if (!res.ok) {
                    console.error('Failed to update stage on server');
                    // Revert optimism if needed (skipped for demo simplicity)
                }
            } catch (err) {
                console.error("Network error moving deal", err);
            }
        }
        setDraggedDealId(null);
    };

    return (
        <div className="flex gap-4 overflow-x-auto pb-4 pt-2">
            {STAGES.map(stage => (
                <div 
                    key={stage.key}
                    className="flex-shrink-0 w-80 bg-slate-900/50 border border-slate-800 rounded-xl p-4 flex flex-col gap-3 min-h-[500px]"
                    onDragOver={handleDragOver}
                    onDrop={() => handleDrop(stage.key)}
                >
                    <div className="flex justify-between items-center mb-2">
                        <h3 className="font-semibold text-slate-200">{stage.label}</h3>
                        <span className="bg-slate-800 text-xs px-2 py-1 rounded-full text-slate-400">
                            {deals.filter(d => d.stage === stage.key).length}
                        </span>
                    </div>

                    {deals.filter(d => d.stage === stage.key).map(deal => (
                        <div
                            key={deal.id}
                            draggable
                            onDragStart={() => handleDragStart(deal.id)}
                            className="bg-slate-800 border border-slate-700 p-4 rounded-lg cursor-grab hover:border-purple-500/50 transition-colors shadow-sm"
                        >
                            <p className="font-medium text-slate-200">{deal.assignedName || deal.leadId}</p>
                            <p className="text-xs text-slate-400 mt-1">{deal.company || 'Empresa TBD'}</p>
                            
                            {deal.web && (
                                <a href={deal.web.startsWith('http') ? deal.web : `https://\${deal.web}`} target="_blank" rel="noopener noreferrer" 
                                   className="text-xs text-indigo-400 hover:text-indigo-300 mt-1 block truncate w-full"
                                   onMouseDown={(e) => e.stopPropagation()}>
                                    {deal.web}
                                </a>
                            )}

                            {deal.meetUrl && (
                                <a href={deal.meetUrl} target="_blank" rel="noopener noreferrer" 
                                   className="mt-2 inline-flex items-center gap-1 text-xs bg-green-900/40 text-green-300 px-2 py-1 rounded hover:bg-green-800/60"
                                   onMouseDown={(e) => e.stopPropagation()}>
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                    Unirse al Meet
                                </a>
                            )}

                            <div className="mt-3 text-xs bg-slate-900 inline-block px-2 py-1 rounded text-purple-300">
                                {stage.label}
                            </div>
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
}
