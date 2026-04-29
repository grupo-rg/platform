'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import {
    DndContext,
    DragEndEvent,
    DragOverlay,
    DragStartEvent,
    PointerSensor,
    useDraggable,
    useDroppable,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import {
    Mail,
    Phone,
    MapPin,
    Video,
    AlertTriangle,
    ShieldAlert,
    Loader2,
    GripVertical,
    ExternalLink,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { PipelineStage } from '@/backend/crm/domain/deal';
import {
    getDealsForKanbanAction,
    type KanbanDealCard,
} from '@/actions/crm/get-deals-for-kanban.action';
import { moveDealStageAction } from '@/actions/crm/move-deal.action';

const STAGES: { key: PipelineStage; label: string; accent: string }[] = [
    { key: PipelineStage.NEW_LEAD, label: 'Nuevo', accent: 'border-l-sky-500' },
    { key: PipelineStage.PUBLIC_DEMO_COMPLETED, label: 'Jugó Demo', accent: 'border-l-violet-500' },
    { key: PipelineStage.SALES_VIDEO_WATCHED, label: 'Vio VSL', accent: 'border-l-fuchsia-500' },
    { key: PipelineStage.SALES_CALL_SCHEDULED, label: 'Reunión', accent: 'border-l-amber-500' },
    { key: PipelineStage.PROPOSAL_SENT, label: 'Propuesta', accent: 'border-l-orange-500' },
    { key: PipelineStage.CLOSED_WON, label: 'Ganado 🎉', accent: 'border-l-emerald-500' },
    { key: PipelineStage.CLOSED_LOST, label: 'Perdido', accent: 'border-l-rose-500' },
];

const PROJECT_TYPE_LABEL: Record<string, string> = {
    bathroom: 'Baño',
    kitchen: 'Cocina',
    integral: 'Integral',
    new_build: 'Obra nueva',
    pool: 'Piscina',
    other: 'Otro',
};

export function CRMKanban() {
    const { toast } = useToast();
    const [deals, setDeals] = useState<KanbanDealCard[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeDeal, setActiveDeal] = useState<KanbanDealCard | null>(null);
    const [, startTransition] = useTransition();

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
    );

    useEffect(() => {
        let active = true;
        getDealsForKanbanAction()
            .then(res => {
                if (!active) return;
                if (res.success && res.deals) setDeals(res.deals);
                else if (res.error) {
                    toast({
                        variant: 'destructive',
                        title: 'No se pudieron cargar los deals',
                        description: res.error,
                    });
                }
            })
            .finally(() => active && setLoading(false));
        return () => { active = false; };
        // toast es estable (de useToast) — eslint no lo sabe.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function handleDragStart(event: DragStartEvent) {
        const id = String(event.active.id);
        const deal = deals.find(d => d.id === id) || null;
        setActiveDeal(deal);
    }

    function handleDragEnd(event: DragEndEvent) {
        const { active, over } = event;
        setActiveDeal(null);
        if (!over) return;

        const dealId = String(active.id);
        const targetStage = String(over.id) as PipelineStage;
        const target = deals.find(d => d.id === dealId);
        if (!target || target.stage === targetStage) return;

        const previousStage = target.stage;

        // Optimistic UI
        setDeals(prev =>
            prev.map(d => (d.id === dealId ? { ...d, stage: targetStage } : d))
        );

        startTransition(async () => {
            const res = await moveDealStageAction(dealId, targetStage);
            if (!res.success) {
                // Revert
                setDeals(prev =>
                    prev.map(d => (d.id === dealId ? { ...d, stage: previousStage } : d))
                );
                toast({
                    variant: 'destructive',
                    title: 'No se pudo mover el deal',
                    description: res.error || 'Error desconocido',
                });
            }
        });
    }

    if (loading) {
        return (
            <div className="flex h-64 items-center justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="ml-2 text-sm">Cargando pipeline…</span>
            </div>
        );
    }

    if (deals.length === 0) {
        return (
            <div className="rounded-xl border border-dashed border-border bg-card p-12 text-center">
                <p className="text-sm text-muted-foreground">
                    Aún no hay oportunidades en el pipeline. Cuando llegue un lead cualificado, aparecerá aquí automáticamente.
                </p>
            </div>
        );
    }

    return (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div className="flex gap-4 overflow-x-auto pb-4 pt-2">
                {STAGES.map(stage => {
                    const stageDeals = deals.filter(d => d.stage === stage.key);
                    return (
                        <KanbanColumn
                            key={stage.key}
                            stage={stage.key}
                            label={stage.label}
                            accent={stage.accent}
                            deals={stageDeals}
                        />
                    );
                })}
            </div>
            <DragOverlay>
                {activeDeal ? <DealCard deal={activeDeal} dragging /> : null}
            </DragOverlay>
        </DndContext>
    );
}

function KanbanColumn({
    stage,
    label,
    accent,
    deals,
}: {
    stage: PipelineStage;
    label: string;
    accent: string;
    deals: KanbanDealCard[];
}) {
    const { setNodeRef, isOver } = useDroppable({ id: stage });
    const totalValue = deals.reduce((sum, d) => sum + (d.estimatedValue || d.lead?.approxBudget || 0), 0);

    return (
        <div
            ref={setNodeRef}
            className={cn(
                'flex w-80 flex-shrink-0 flex-col gap-3 rounded-xl border bg-card p-4 transition-colors',
                'border-l-4',
                accent,
                isOver && 'bg-accent/40 ring-2 ring-primary/40'
            )}
            style={{ minHeight: '500px' }}
        >
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold tracking-tight">{label}</h3>
                <div className="flex items-center gap-2">
                    {totalValue > 0 && (
                        <span className="text-xs font-medium text-muted-foreground">
                            {new Intl.NumberFormat('es-ES', {
                                style: 'currency',
                                currency: 'EUR',
                                maximumFractionDigits: 0,
                            }).format(totalValue)}
                        </span>
                    )}
                    <Badge variant="secondary" className="font-mono text-xs">
                        {deals.length}
                    </Badge>
                </div>
            </div>

            <div className="flex flex-col gap-2">
                {deals.map(deal => (
                    <DraggableCard key={deal.id} deal={deal} />
                ))}
                {deals.length === 0 && (
                    <p className="px-2 py-6 text-center text-xs text-muted-foreground/70">
                        Suelta aquí
                    </p>
                )}
            </div>
        </div>
    );
}

function DraggableCard({ deal }: { deal: KanbanDealCard }) {
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: deal.id });

    return (
        <div
            ref={setNodeRef}
            {...attributes}
            {...listeners}
            className={cn(
                'cursor-grab touch-none active:cursor-grabbing',
                isDragging && 'opacity-30'
            )}
        >
            <DealCard deal={deal} />
        </div>
    );
}

function DealCard({ deal, dragging }: { deal: KanbanDealCard; dragging?: boolean }) {
    const lead = deal.lead;
    const decisionTone =
        lead?.decision === 'qualified'
            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
            : lead?.decision === 'review_required'
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'
                : lead?.decision === 'rejected'
                    ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300'
                    : 'bg-muted text-muted-foreground';

    return (
        <div
            className={cn(
                'group rounded-lg border bg-background p-3 shadow-sm transition-all',
                dragging ? 'rotate-2 shadow-2xl ring-2 ring-primary/50' : 'hover:border-primary/40 hover:shadow-md'
            )}
        >
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                        {lead?.name || `Lead ${deal.leadId.slice(0, 8)}`}
                    </p>
                    {lead?.email && (
                        <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                            <Mail className="h-3 w-3 flex-shrink-0" />
                            <span className="truncate">{lead.email}</span>
                        </p>
                    )}
                    {lead?.phone && (
                        <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                            <Phone className="h-3 w-3 flex-shrink-0" />
                            {lead.phone}
                        </p>
                    )}
                </div>
                <GripVertical className="h-4 w-4 flex-shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground" />
            </div>

            {lead && (lead.projectType || lead.city || lead.postalCode) && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {lead.projectType && (
                        <Badge variant="outline" className="text-[10px] font-normal">
                            {PROJECT_TYPE_LABEL[lead.projectType] || lead.projectType}
                        </Badge>
                    )}
                    {(lead.postalCode || lead.city) && (
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <MapPin className="h-2.5 w-2.5" />
                            {[lead.postalCode, lead.city].filter(Boolean).join(' · ')}
                        </span>
                    )}
                </div>
            )}

            {lead && (lead.decision || lead.suspicious || typeof lead.score === 'number') && (
                <div className="mt-2 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                        {lead.decision && (
                            <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-semibold', decisionTone)}>
                                {lead.decision === 'qualified'
                                    ? 'Cualificado'
                                    : lead.decision === 'review_required'
                                        ? 'Revisar'
                                        : 'Rechazado'}
                            </span>
                        )}
                        {lead.suspicious && (
                            <span className="flex items-center gap-0.5 rounded-md bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">
                                <ShieldAlert className="h-2.5 w-2.5" />
                            </span>
                        )}
                    </div>
                    {typeof lead.score === 'number' && (
                        <span className="font-mono text-[10px] text-muted-foreground">{lead.score}/100</span>
                    )}
                </div>
            )}

            {deal.metadata?.meetUrl && (
                <a
                    href={deal.metadata.meetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    onPointerDown={e => e.stopPropagation()}
                    className="mt-2 inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/20"
                >
                    <Video className="h-3 w-3" />
                    Unirse
                </a>
            )}

            {/* Atajo al detalle del lead */}
            <Link
                href={`/dashboard/leads/${deal.leadId}`}
                onClick={e => e.stopPropagation()}
                onPointerDown={e => e.stopPropagation()}
                className="mt-2 flex items-center justify-end gap-1 text-[10px] text-muted-foreground hover:text-foreground"
            >
                Ver detalle <ExternalLink className="h-2.5 w-2.5" />
            </Link>
        </div>
    );
}
