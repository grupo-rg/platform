'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link2, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export function AssignClientModal({ budgetId }: { budgetId: string }) {
    const [isOpen, setIsOpen] = useState(false);
    const [leads, setLeads] = useState<any[]>([]);
    const [isLoadingLeads, setIsLoadingLeads] = useState(false);
    const [selectedLeadId, setSelectedLeadId] = useState('');
    const [isAssigning, setIsAssigning] = useState(false);
    const { toast } = useToast();

    const handleOpen = async (open: boolean) => {
        setIsOpen(open);
        if (open && leads.length === 0) {
            setIsLoadingLeads(true);
            try {
                const { getLeadsAction } = await import('@/actions/lead/dashboard.action');
                const data = await getLeadsAction(100, 0); // Get up to 100 leads for now
                setLeads(data);
            } catch (e) {
                console.error("Failed to load leads", e);
            } finally {
                setIsLoadingLeads(false);
            }
        }
    };

    const handleAssign = async () => {
        if (!selectedLeadId) return;

        setIsAssigning(true);
        try {
            const { assignBudgetClientAction } = await import('@/actions/budget/assign-budget-client.action');
            const result = await assignBudgetClientAction(budgetId, selectedLeadId);

            if (result.success) {
                toast({
                    title: "Cliente Asignado",
                    description: "El presupuesto ha sido vinculado al cliente exitosamente.",
                });
                setIsOpen(false);
                // Action calls revalidatePath, so router refresh or reload will occur naturally
                window.location.reload();
            } else {
                toast({
                    title: "Error de asignación",
                    description: result.error || "Ocurrió un error al vincular el cliente.",
                    variant: "destructive"
                });
            }
        } catch (error) {
            console.error("Error assigning:", error);
        } finally {
            setIsAssigning(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleOpen}>
            <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="ml-3 border-indigo-200 text-indigo-600 hover:bg-indigo-50">
                    <Link2 className="w-4 h-4 mr-2" />
                    Asignar a Cliente
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Asignar Presupuesto</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <p className="text-sm text-slate-500">
                        Selecciona un cliente de tu CRM para vincularlo a este presupuesto huérfano.
                    </p>
                    {isLoadingLeads ? (
                        <div className="flex justify-center py-4 text-muted-foreground">
                            <Loader2 className="w-6 h-6 animate-spin" />
                        </div>
                    ) : (
                        <Select value={selectedLeadId} onValueChange={setSelectedLeadId}>
                            <SelectTrigger className="w-full">
                                <SelectValue placeholder="Seleccionar cliente..." />
                            </SelectTrigger>
                            <SelectContent>
                                {leads.map(lead => (
                                    <SelectItem key={lead.id} value={lead.id}>
                                        {lead.name} {lead.email ? `(${lead.email})` : ''}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setIsOpen(false)}>Cancelar</Button>
                    <Button onClick={handleAssign} disabled={!selectedLeadId || isAssigning}>
                        {isAssigning && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        Vincular
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
