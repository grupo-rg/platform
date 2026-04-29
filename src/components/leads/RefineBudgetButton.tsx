'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Loader2, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useWidgetContext } from '@/context/budget-widget-context';
import { getLeadBriefAction } from '@/actions/lead/get-lead-brief.action';

/**
 * Reemplaza al antiguo DispatchBudgetButton (que disparaba el motor IA con
 * un brief mínimo). Ahora el flujo es AI-first:
 *
 *  1. Construye un brief narrativo del lead (intake + qualification + form
 *     data crudo si vino de form).
 *  2. Lo inyecta como `initialPrompt` del widget context.
 *  3. Redirige al wizard admin (`/dashboard/assistant?leadId={id}`).
 *  4. El wizard envía automáticamente el brief al agente Arquitecto, que
 *     pregunta lo que falta y refina con el admin antes de disparar el
 *     motor formal de presupuesto.
 *
 * El budget generado queda asociado al lead real (ver `targetLeadIdFromQuery`
 * en BudgetWizardChat) y aparece en el detalle del lead.
 */
export function RefineBudgetButton({
    leadId,
    decision,
    dealId,
}: {
    leadId: string;
    decision?: 'qualified' | 'review_required' | 'rejected';
    /** Cuando se pasa, el brief se construye con el intake del deal concreto (no el último del lead). */
    dealId?: string;
}) {
    const router = useRouter();
    const { toast } = useToast();
    const { setInitialPrompt } = useWidgetContext();
    const [isPending, startTransition] = useTransition();

    function handleClick() {
        startTransition(async () => {
            const result = await getLeadBriefAction(leadId, dealId);
            if (!result.success || !result.brief) {
                toast({
                    variant: 'destructive',
                    title: 'No se pudo construir el brief',
                    description: result.error || 'Error desconocido',
                });
                return;
            }

            // El wizard lee `initialPrompt` y lo envía como primer mensaje del
            // usuario al agente Arquitecto cuando termina de montar.
            setInitialPrompt(result.brief);
            const params = new URLSearchParams({ leadId });
            if (dealId) params.set('dealId', dealId);
            router.push(`/dashboard/assistant?${params.toString()}`);
        });
    }

    const warnRejected = decision === 'rejected';

    return (
        <div className="flex flex-col items-end gap-1.5">
            <Button onClick={handleClick} disabled={isPending} size="lg">
                {isPending ? (
                    <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Preparando brief…
                    </>
                ) : (
                    <>
                        <Wand2 className="h-4 w-4 mr-2" />
                        {dealId ? 'Refinar este deal' : 'Refinar y generar pre-presupuesto'}
                    </>
                )}
            </Button>
            <p className="text-[11px] text-muted-foreground text-right max-w-xs">
                <Sparkles className="inline h-3 w-3 mr-1 text-primary" />
                {dealId
                    ? 'Abre el asistente IA con el contexto de esta oportunidad concreta.'
                    : 'Abre el asistente IA con todo el contexto del lead. Refinas con el agente y disparas el motor cuando esté listo.'}
            </p>
            {warnRejected && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 max-w-xs text-right">
                    Este lead fue rechazado por las reglas; el wizard te dejará iterar igual.
                </p>
            )}
        </div>
    );
}
