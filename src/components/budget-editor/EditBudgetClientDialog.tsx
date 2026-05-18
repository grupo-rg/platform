'use client';

/**
 * Inline editor for the client snapshot + budget title that appears in the
 * BudgetEditor header. Persists a partial Budget update via `updateBudgetAction`
 * — does NOT mutate the linked Lead (the snapshot is intentionally a frozen
 * copy at budget creation time; correcting it here only fixes the Budget).
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Budget } from '@/backend/budget/domain/budget';
import { PersonalInfo } from '@/backend/lead/domain/lead';
import { updateBudgetAction } from '@/actions/budget/update-budget.action';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Save, Pencil } from 'lucide-react';

interface EditBudgetClientDialogProps {
    budget: Budget;
    /** Si `true`, renderiza el trigger por defecto (icono + texto). Si pasas
     * children custom, ese será el trigger. */
    children?: React.ReactNode;
}

export function EditBudgetClientDialog({ budget, children }: EditBudgetClientDialogProps) {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const router = useRouter();
    const { toast } = useToast();

    const c = budget.clientSnapshot || ({} as PersonalInfo);

    const [title, setTitle] = useState(budget.title || '');
    const [name, setName] = useState(c.name || '');
    const [email, setEmail] = useState(c.email || '');
    const [phone, setPhone] = useState(c.phone || '');
    const [nif, setNif] = useState(c.nif || '');
    const [companyName, setCompanyName] = useState(c.companyName || '');
    const [address, setAddress] = useState(c.address || '');
    const [billingAddress, setBillingAddress] = useState(c.billingAddress || '');
    const [billingCity, setBillingCity] = useState(c.billingCity || '');
    const [billingPostalCode, setBillingPostalCode] = useState(c.billingPostalCode || '');
    const [billingProvince, setBillingProvince] = useState(c.billingProvince || '');
    const [billingCountry, setBillingCountry] = useState(c.billingCountry || '');

    // Resync cuando se reabre el dialog: refleja el último Budget guardado.
    useEffect(() => {
        if (!open) return;
        const cur = budget.clientSnapshot || ({} as PersonalInfo);
        setTitle(budget.title || '');
        setName(cur.name || '');
        setEmail(cur.email || '');
        setPhone(cur.phone || '');
        setNif(cur.nif || '');
        setCompanyName(cur.companyName || '');
        setAddress(cur.address || '');
        setBillingAddress(cur.billingAddress || '');
        setBillingCity(cur.billingCity || '');
        setBillingPostalCode(cur.billingPostalCode || '');
        setBillingProvince(cur.billingProvince || '');
        setBillingCountry(cur.billingCountry || '');
    }, [open, budget]);

    const handleSave = async () => {
        setLoading(true);
        try {
            const updatedSnapshot: PersonalInfo = {
                name: name.trim() || 'Cliente Generico',
                email: email.trim(),
                phone: phone.trim(),
                address: address.trim() || undefined,
                nif: nif.trim() || undefined,
                companyName: companyName.trim() || undefined,
                billingAddress: billingAddress.trim() || undefined,
                billingCity: billingCity.trim() || undefined,
                billingPostalCode: billingPostalCode.trim() || undefined,
                billingProvince: billingProvince.trim() || undefined,
                billingCountry: billingCountry.trim() || undefined,
            };
            const res = await updateBudgetAction(budget.id, {
                clientSnapshot: updatedSnapshot,
                title: title.trim() || undefined,
            } as any);
            if (res.success) {
                toast({ title: 'Datos del presupuesto actualizados' });
                setOpen(false);
                router.refresh();
            } else {
                toast({ title: 'Error al guardar', description: res.error, variant: 'destructive' });
            }
        } catch (err: any) {
            toast({ title: 'Error de conexión', description: err?.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <div onClick={() => setOpen(true)} className="inline-flex">
                {children ?? (
                    <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground">
                        <Pencil className="w-3.5 h-3.5" />
                        Editar datos
                    </Button>
                )}
            </div>

            <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Editar datos del presupuesto</DialogTitle>
                    <DialogDescription>
                        Modifica el título y los datos del cliente. Estos cambios solo
                        afectan a este presupuesto — el Lead original no se altera.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    <div className="space-y-1.5">
                        <Label htmlFor="bce-title">Título del presupuesto</Label>
                        <Input
                            id="bce-title"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            placeholder="Ej: Reforma cocina Calle Mayor 23"
                        />
                    </div>

                    <div className="border-t border-zinc-200 dark:border-zinc-800 pt-4">
                        <h4 className="text-sm font-semibold mb-3">Cliente</h4>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5 col-span-2">
                                <Label className="text-xs">Nombre / Razón social *</Label>
                                <Input value={name} onChange={e => setName(e.target.value)} />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Email</Label>
                                <Input type="email" value={email} onChange={e => setEmail(e.target.value)} />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Teléfono</Label>
                                <Input value={phone} onChange={e => setPhone(e.target.value)} />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">DNI / NIF / CIF</Label>
                                <Input value={nif} onChange={e => setNif(e.target.value)} />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Razón social (si difiere)</Label>
                                <Input value={companyName} onChange={e => setCompanyName(e.target.value)} />
                            </div>
                            <div className="space-y-1.5 col-span-2">
                                <Label className="text-xs">Dirección</Label>
                                <Input value={address} onChange={e => setAddress(e.target.value)} />
                            </div>
                        </div>
                    </div>

                    <details className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-2">
                        <summary className="cursor-pointer text-sm font-medium px-2 py-1">
                            Datos de facturación
                        </summary>
                        <div className="grid grid-cols-2 gap-3 mt-3">
                            <div className="space-y-1.5 col-span-2">
                                <Label className="text-xs">Dirección fiscal</Label>
                                <Input value={billingAddress} onChange={e => setBillingAddress(e.target.value)} />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Código postal</Label>
                                <Input value={billingPostalCode} onChange={e => setBillingPostalCode(e.target.value)} />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Ciudad</Label>
                                <Input value={billingCity} onChange={e => setBillingCity(e.target.value)} />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Provincia</Label>
                                <Input value={billingProvince} onChange={e => setBillingProvince(e.target.value)} />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">País</Label>
                                <Input value={billingCountry} onChange={e => setBillingCountry(e.target.value)} />
                            </div>
                        </div>
                    </details>
                </div>

                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
                        Cancelar
                    </Button>
                    <Button
                        onClick={handleSave}
                        disabled={loading || !name.trim()}
                        className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white"
                    >
                        {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Guardando…</> : <><Save className="w-4 h-4 mr-2" />Guardar</>}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
