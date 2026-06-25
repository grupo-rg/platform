'use client';

import { useState } from 'react';
import { approveBudgetAction } from '@/actions/budget/approve-budget.action';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle2, Loader2, Building2, AlertTriangle, Sparkles, PartyPopper } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface BudgetApproveButtonProps {
    budgetId: string;
    /** Número de presupuesto tipo factura (YYYY-MM/NNNN); fallback al id corto. */
    budgetNumber?: string;
    clientName: string;
    totalEstimated: number;
    locale: string;
}

export function BudgetApproveButton({ budgetId, budgetNumber, clientName, totalEstimated, locale }: BudgetApproveButtonProps) {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [projectName, setProjectName] = useState(`Obra - ${clientName}`);
    const [address, setAddress] = useState('');
    const [startDate, setStartDate] = useState('');
    const [estimatedEndDate, setEstimatedEndDate] = useState('');
    const router = useRouter();

    const fmt = (v: number) =>
        new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);

    const handleApprove = async () => {
        setLoading(true);
        setError(null);
        const result = await approveBudgetAction(budgetId, {
            name: projectName || undefined,
            address: address || undefined,
            startDate: startDate || undefined,
            estimatedEndDate: estimatedEndDate || undefined,
        });

        setLoading(false);

        if (result.success) {
            setSuccess(true);
            // Auto-redirect after 2s
            setTimeout(() => {
                if (result.projectId) {
                    router.push(`/dashboard/projects/${result.projectId}?new=true`);
                } else {
                    router.refresh();
                    setOpen(false);
                }
            }, 2000);
        } else {
            setError(result.error || 'Error desconocido');
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button
                    size="sm"
                    className="bg-emerald-500 hover:bg-emerald-600 text-white shadow-md shadow-emerald-500/20 transition-all duration-200 hover:shadow-lg hover:shadow-emerald-500/30 hover:scale-[1.02] gap-1.5"
                >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Aprobar
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
                {success ? (
                    <div className="flex flex-col items-center justify-center py-8 space-y-4 animate-in fade-in zoom-in-95 duration-500">
                        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/30">
                            <PartyPopper className="w-8 h-8 text-white" />
                        </div>
                        <h3 className="text-xl font-bold">¡Obra Creada!</h3>
                        <p className="text-muted-foreground text-center text-sm">
                            El presupuesto ha sido aprobado y se ha generado la obra
                            <span className="font-semibold text-foreground"> {projectName}</span>.
                        </p>
                        <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                            Redirigiendo...
                        </Badge>
                    </div>
                ) : (
                    <>
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <Building2 className="w-5 h-5 text-emerald-500" />
                                Aprobar Presupuesto y Crear Obra
                            </DialogTitle>
                            <DialogDescription>
                                Se aprobará el presupuesto y se creará una obra con las fases generadas automáticamente.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="space-y-4 py-4">
                            {/* Budget summary */}
                            <div className="rounded-xl bg-zinc-50 dark:bg-zinc-900/50 p-4 space-y-2 border border-zinc-200 dark:border-zinc-800">
                                <div className="flex justify-between items-center">
                                    <span className="text-xs text-muted-foreground">Cliente</span>
                                    <span className="text-sm font-semibold">{clientName}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-xs text-muted-foreground">Importe</span>
                                    <span className="text-sm font-bold text-emerald-600">{fmt(totalEstimated)}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-xs text-muted-foreground">Ref.</span>
                                    <span className="text-[10px] font-mono bg-zinc-200 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
                                        Nº {budgetNumber || budgetId.substring(0, 8).toUpperCase()}
                                    </span>
                                </div>
                            </div>

                            {/* Overrides */}
                            <div className="space-y-3">
                                <div className="space-y-1.5">
                                    <Label htmlFor="projectName" className="text-xs font-medium">
                                        Nombre de la Obra
                                    </Label>
                                    <Input
                                        id="projectName"
                                        value={projectName}
                                        onChange={e => setProjectName(e.target.value)}
                                        placeholder="Ej: Reforma integral vivienda..."
                                        className="bg-white dark:bg-zinc-950"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="address" className="text-xs font-medium">
                                        Dirección (opcional)
                                    </Label>
                                    <Input
                                        id="address"
                                        value={address}
                                        onChange={e => setAddress(e.target.value)}
                                        placeholder="Ej: Carrer de la Mar 45, Palma..."
                                        className="bg-white dark:bg-zinc-950"
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <Label htmlFor="startDate" className="text-xs font-medium">
                                            Fecha de Inicio
                                        </Label>
                                        <Input
                                            id="startDate"
                                            type="date"
                                            value={startDate}
                                            onChange={e => setStartDate(e.target.value)}
                                            className="bg-white dark:bg-zinc-950"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label htmlFor="estimatedEndDate" className="text-xs font-medium">
                                            Fecha Fin Estimada
                                        </Label>
                                        <Input
                                            id="estimatedEndDate"
                                            type="date"
                                            value={estimatedEndDate}
                                            onChange={e => setEstimatedEndDate(e.target.value)}
                                            className="bg-white dark:bg-zinc-950"
                                        />
                                    </div>
                                </div>
                            </div>

                            {error && (
                                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                                    <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                                    <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
                                </div>
                            )}
                        </div>

                        <DialogFooter className="gap-2">
                            <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
                                Cancelar
                            </Button>
                            <Button
                                onClick={handleApprove}
                                disabled={loading}
                                className="bg-emerald-500 hover:bg-emerald-600 text-white shadow-md shadow-emerald-500/20 gap-2"
                            >
                                {loading ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Creando obra...
                                    </>
                                ) : (
                                    <>
                                        <Sparkles className="w-4 h-4" />
                                        Aprobar y Crear Obra
                                    </>
                                )}
                            </Button>
                        </DialogFooter>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}
