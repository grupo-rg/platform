'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { deleteLeadAction } from '@/actions/lead/delete-lead.action';

export function DeleteLeadButton({ leadId }: { leadId: string }) {
    const router = useRouter();
    const { toast } = useToast();
    const [isPending, startTransition] = useTransition();
    const [confirming, setConfirming] = useState(false);

    function handleClick() {
        if (!confirming) {
            setConfirming(true);
            return;
        }
        startTransition(async () => {
            const res = await deleteLeadAction(leadId);
            if (res.success) {
                toast({ title: 'Lead eliminado', description: 'Se borraron también los deals asociados.' });
                router.push('/dashboard/leads?tab=inbox');
            } else {
                toast({ variant: 'destructive', title: 'No se pudo eliminar', description: res.error });
                setConfirming(false);
            }
        });
    }

    if (confirming) {
        return (
            <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">¿Confirmas borrar este lead y sus deals?</span>
                <Button onClick={handleClick} disabled={isPending} variant="destructive" size="sm">
                    {isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5 mr-1.5" />}
                    Sí, borrar
                </Button>
                <Button onClick={() => setConfirming(false)} disabled={isPending} variant="ghost" size="sm">
                    Cancelar
                </Button>
            </div>
        );
    }

    return (
        <Button onClick={handleClick} variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Eliminar lead
        </Button>
    );
}
