'use client';

import { useEffect, useMemo, useState } from 'react';
import { Budget } from '@/backend/budget/domain/budget';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { createProjectAction } from '@/actions/project/create-project.action';
import {
    listLeadsForSelectorAction,
    type LeadSelectorItem,
} from '@/actions/lead/list-leads-for-selector.action';
import { createAdminLeadAction } from '@/actions/lead/create-admin-lead.action';
import {
    HardHat,
    FileText,
    Euro,
    Loader2,
    UserPlus,
    Search,
    Check,
    Building2,
} from 'lucide-react';

interface CreateProjectModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    approvedBudgets: Budget[];
    locale: string;
}

type Mode = 'budget' | 'direct';

interface NewClientForm {
    name: string;
    email: string;
    phone: string;
    nif: string;
    companyName: string;
    address: string;
    billingAddress: string;
    billingCity: string;
    billingPostalCode: string;
    billingProvince: string;
    billingCountry: string;
}

const emptyClient: NewClientForm = {
    name: '',
    email: '',
    phone: '',
    nif: '',
    companyName: '',
    address: '',
    billingAddress: '',
    billingCity: '',
    billingPostalCode: '',
    billingProvince: '',
    billingCountry: '',
};

export function CreateProjectModal({ open, onOpenChange, approvedBudgets, locale }: CreateProjectModalProps) {
    const [mode, setMode] = useState<Mode>('budget');

    // Modo "budget"
    const [selectedBudgetId, setSelectedBudgetId] = useState<string | null>(null);

    // Modo "direct" — cliente
    const [clientTab, setClientTab] = useState<'existing' | 'new'>('existing');
    const [leads, setLeads] = useState<LeadSelectorItem[]>([]);
    const [leadsLoading, setLeadsLoading] = useState(false);
    const [leadSearch, setLeadSearch] = useState('');
    const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
    const [newClient, setNewClient] = useState<NewClientForm>(emptyClient);

    // Project fields
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [address, setAddress] = useState('');
    const [startDate, setStartDate] = useState('');
    const [estimatedEndDate, setEstimatedEndDate] = useState('');
    const [estimatedBudget, setEstimatedBudget] = useState<string>('');

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const selectedBudget = approvedBudgets.find(b => b.id === selectedBudgetId);

    const formatCurrency = (amount: number) =>
        new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(amount);

    // Carga inicial de leads cuando se abre el modal o se cambia a modo directo.
    useEffect(() => {
        if (!open) return;
        if (mode !== 'direct') return;
        let cancelled = false;
        setLeadsLoading(true);
        listLeadsForSelectorAction({ limit: 200 }).then(res => {
            if (cancelled) return;
            if (res.success && res.leads) setLeads(res.leads);
            setLeadsLoading(false);
        });
        return () => { cancelled = true; };
    }, [open, mode]);

    const filteredLeads = useMemo(() => {
        const q = leadSearch.trim().toLowerCase();
        if (!q) return leads;
        return leads.filter(l =>
            (l.name + ' ' + l.email + ' ' + (l.companyName || '') + ' ' + (l.nif || ''))
                .toLowerCase()
                .includes(q)
        );
    }, [leads, leadSearch]);

    const resetForm = () => {
        setMode('budget');
        setSelectedBudgetId(null);
        setClientTab('existing');
        setLeadSearch('');
        setSelectedLeadId(null);
        setNewClient(emptyClient);
        setName('');
        setDescription('');
        setAddress('');
        setStartDate('');
        setEstimatedEndDate('');
        setEstimatedBudget('');
        setError(null);
    };

    const handleSubmit = async () => {
        setError(null);

        // --- Validaciones por modo ---
        if (mode === 'budget') {
            if (!selectedBudgetId) {
                setError('Selecciona un presupuesto aprobado o cambia a "Obra directa".');
                return;
            }
        } else {
            if (!name.trim()) {
                setError('El nombre de la obra es obligatorio.');
                return;
            }
            if (clientTab === 'existing' && !selectedLeadId) {
                setError('Selecciona un cliente existente o crea uno nuevo.');
                return;
            }
            if (clientTab === 'new') {
                if (!newClient.name.trim() || !newClient.email.trim() || !newClient.phone.trim()) {
                    setError('Para crear cliente: nombre, email y teléfono son obligatorios.');
                    return;
                }
            }
        }

        setLoading(true);
        try {
            let leadId: string | undefined;

            // Si vamos por modo directo + cliente nuevo, primero creamos el Lead.
            if (mode === 'direct' && clientTab === 'new') {
                const leadRes = await createAdminLeadAction({
                    name: newClient.name.trim(),
                    email: newClient.email.trim(),
                    phone: newClient.phone.trim(),
                    address: newClient.address || undefined,
                    nif: newClient.nif || undefined,
                    companyName: newClient.companyName || undefined,
                    billingAddress: newClient.billingAddress || undefined,
                    billingCity: newClient.billingCity || undefined,
                    billingPostalCode: newClient.billingPostalCode || undefined,
                    billingProvince: newClient.billingProvince || undefined,
                    billingCountry: newClient.billingCountry || undefined,
                });
                if (!leadRes.success || !leadRes.lead) {
                    setError(leadRes.error || 'No se pudo crear el cliente.');
                    setLoading(false);
                    return;
                }
                leadId = leadRes.lead.id;
            } else if (mode === 'direct' && clientTab === 'existing') {
                leadId = selectedLeadId!;
            }

            const result = await createProjectAction({
                budgetId: mode === 'budget' ? selectedBudgetId! : undefined,
                leadId,
                name: name || undefined,
                description: description || undefined,
                address: address || undefined,
                startDate: startDate || undefined,
                estimatedEndDate: estimatedEndDate || undefined,
                estimatedBudget: mode === 'direct' && estimatedBudget
                    ? Number(estimatedBudget)
                    : undefined,
            });

            if (result.success) {
                onOpenChange(false);
                resetForm();
            } else {
                setError(result.error || 'Error al crear la obra');
            }
        } catch (err: any) {
            setError(err?.message || 'Error inesperado al crear la obra');
        } finally {
            setLoading(false);
        }
    };

    const submitDisabled = loading
        || (mode === 'budget' && !selectedBudgetId)
        || (mode === 'direct' && !name.trim())
        || (mode === 'direct' && clientTab === 'existing' && !selectedLeadId)
        || (mode === 'direct' && clientTab === 'new' && (
            !newClient.name.trim() || !newClient.email.trim() || !newClient.phone.trim()
        ));

    return (
        <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) resetForm(); }}>
            <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-xl">
                        <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-900/30">
                            <HardHat className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                        </div>
                        Nueva Obra
                    </DialogTitle>
                    <DialogDescription>
                        Crea una obra desde un presupuesto aprobado o ábrela directamente con los datos del cliente.
                    </DialogDescription>
                </DialogHeader>

                <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)} className="mt-2">
                    <TabsList className="grid grid-cols-2 w-full">
                        <TabsTrigger value="budget" className="gap-2">
                            <FileText className="w-4 h-4" />
                            Desde presupuesto
                        </TabsTrigger>
                        <TabsTrigger value="direct" className="gap-2">
                            <Building2 className="w-4 h-4" />
                            Obra directa
                        </TabsTrigger>
                    </TabsList>

                    {/* === Modo presupuesto === */}
                    <TabsContent value="budget" className="space-y-5 py-4">
                        <div className="space-y-2">
                            <Label className="font-semibold">Presupuesto aprobado</Label>
                            {approvedBudgets.length === 0 ? (
                                <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 p-4 text-sm text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                                    No hay presupuestos aprobados disponibles. Puedes cambiar a la pestaña <strong>"Obra directa"</strong> para abrir la obra sin presupuesto.
                                </div>
                            ) : (
                                <div className="space-y-2 max-h-48 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-700 p-2">
                                    {approvedBudgets.map(budget => (
                                        <button
                                            key={budget.id}
                                            type="button"
                                            onClick={() => setSelectedBudgetId(budget.id)}
                                            className={`w-full text-left rounded-lg p-3 transition-all duration-200 border ${selectedBudgetId === budget.id
                                                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 ring-2 ring-indigo-500/30'
                                                    : 'border-transparent hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                                                }`}
                                        >
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <FileText className="w-4 h-4 text-muted-foreground" />
                                                    <span className="font-medium text-sm">
                                                        {budget.clientSnapshot?.name || `Presupuesto ${budget.id.slice(0, 8)}`}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <Badge variant="secondary" className="text-xs">
                                                        <Euro className="w-3 h-3 mr-1" />
                                                        {formatCurrency(budget.totalEstimated || budget.costBreakdown?.total || 0)}
                                                    </Badge>
                                                </div>
                                            </div>
                                            {budget.type && (
                                                <span className="text-xs text-muted-foreground mt-1 block capitalize">{budget.type.replace('_', ' ')}</span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </TabsContent>

                    {/* === Modo obra directa === */}
                    <TabsContent value="direct" className="space-y-5 py-4">
                        <div className="space-y-2">
                            <Label className="font-semibold">Cliente</Label>
                            <Tabs value={clientTab} onValueChange={(v) => setClientTab(v as any)}>
                                <TabsList className="grid grid-cols-2 w-full">
                                    <TabsTrigger value="existing" className="gap-2">
                                        <Search className="w-4 h-4" />
                                        Existente
                                    </TabsTrigger>
                                    <TabsTrigger value="new" className="gap-2">
                                        <UserPlus className="w-4 h-4" />
                                        Crear nuevo
                                    </TabsTrigger>
                                </TabsList>

                                <TabsContent value="existing" className="space-y-2 pt-3">
                                    <div className="relative">
                                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                        <Input
                                            placeholder="Buscar por nombre, email, empresa o NIF…"
                                            value={leadSearch}
                                            onChange={e => setLeadSearch(e.target.value)}
                                            className="pl-9"
                                        />
                                    </div>
                                    <div className="max-h-48 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-700 p-1">
                                        {leadsLoading ? (
                                            <div className="p-4 text-center text-sm text-muted-foreground">
                                                <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                                                Cargando clientes…
                                            </div>
                                        ) : filteredLeads.length === 0 ? (
                                            <div className="p-4 text-center text-sm text-muted-foreground">
                                                No hay clientes que coincidan. Pulsa "Crear nuevo".
                                            </div>
                                        ) : (
                                            filteredLeads.map(lead => (
                                                <button
                                                    key={lead.id}
                                                    type="button"
                                                    onClick={() => setSelectedLeadId(lead.id)}
                                                    className={`w-full text-left rounded-md p-2.5 transition-all duration-150 border ${selectedLeadId === lead.id
                                                            ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                                                            : 'border-transparent hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                                                        }`}
                                                >
                                                    <div className="flex items-center justify-between gap-2">
                                                        <div className="min-w-0">
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-medium text-sm truncate">
                                                                    {lead.companyName || lead.name}
                                                                </span>
                                                                {lead.companyName && (
                                                                    <span className="text-xs text-muted-foreground truncate">
                                                                        — {lead.name}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="text-xs text-muted-foreground truncate">
                                                                {lead.email}{lead.nif ? ` · NIF ${lead.nif}` : ''}
                                                            </div>
                                                        </div>
                                                        {selectedLeadId === lead.id && (
                                                            <Check className="w-4 h-4 text-indigo-500 shrink-0" />
                                                        )}
                                                    </div>
                                                </button>
                                            ))
                                        )}
                                    </div>
                                </TabsContent>

                                <TabsContent value="new" className="space-y-3 pt-3">
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-1">
                                            <Label htmlFor="nc-name">Nombre *</Label>
                                            <Input id="nc-name" value={newClient.name}
                                                onChange={e => setNewClient(c => ({ ...c, name: e.target.value }))} />
                                        </div>
                                        <div className="space-y-1">
                                            <Label htmlFor="nc-company">Razón social</Label>
                                            <Input id="nc-company" placeholder="Si es empresa"
                                                value={newClient.companyName}
                                                onChange={e => setNewClient(c => ({ ...c, companyName: e.target.value }))} />
                                        </div>
                                        <div className="space-y-1">
                                            <Label htmlFor="nc-email">Email *</Label>
                                            <Input id="nc-email" type="email" value={newClient.email}
                                                onChange={e => setNewClient(c => ({ ...c, email: e.target.value }))} />
                                        </div>
                                        <div className="space-y-1">
                                            <Label htmlFor="nc-phone">Teléfono *</Label>
                                            <Input id="nc-phone" value={newClient.phone}
                                                onChange={e => setNewClient(c => ({ ...c, phone: e.target.value }))} />
                                        </div>
                                        <div className="space-y-1">
                                            <Label htmlFor="nc-nif">NIF / DNI / CIF</Label>
                                            <Input id="nc-nif" value={newClient.nif}
                                                onChange={e => setNewClient(c => ({ ...c, nif: e.target.value }))} />
                                        </div>
                                        <div className="space-y-1">
                                            <Label htmlFor="nc-address">Dirección</Label>
                                            <Input id="nc-address" value={newClient.address}
                                                onChange={e => setNewClient(c => ({ ...c, address: e.target.value }))} />
                                        </div>
                                    </div>

                                    <details className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-2">
                                        <summary className="cursor-pointer text-sm font-medium px-2 py-1">
                                            Datos de facturación (opcional)
                                        </summary>
                                        <div className="grid grid-cols-2 gap-3 mt-3">
                                            <div className="space-y-1 col-span-2">
                                                <Label htmlFor="nc-bill-addr">Dirección fiscal</Label>
                                                <Input id="nc-bill-addr" value={newClient.billingAddress}
                                                    onChange={e => setNewClient(c => ({ ...c, billingAddress: e.target.value }))} />
                                            </div>
                                            <div className="space-y-1">
                                                <Label htmlFor="nc-bill-cp">Código Postal</Label>
                                                <Input id="nc-bill-cp" value={newClient.billingPostalCode}
                                                    onChange={e => setNewClient(c => ({ ...c, billingPostalCode: e.target.value }))} />
                                            </div>
                                            <div className="space-y-1">
                                                <Label htmlFor="nc-bill-city">Ciudad</Label>
                                                <Input id="nc-bill-city" value={newClient.billingCity}
                                                    onChange={e => setNewClient(c => ({ ...c, billingCity: e.target.value }))} />
                                            </div>
                                            <div className="space-y-1">
                                                <Label htmlFor="nc-bill-prov">Provincia</Label>
                                                <Input id="nc-bill-prov" value={newClient.billingProvince}
                                                    onChange={e => setNewClient(c => ({ ...c, billingProvince: e.target.value }))} />
                                            </div>
                                            <div className="space-y-1">
                                                <Label htmlFor="nc-bill-country">País</Label>
                                                <Input id="nc-bill-country" value={newClient.billingCountry}
                                                    onChange={e => setNewClient(c => ({ ...c, billingCountry: e.target.value }))} />
                                            </div>
                                        </div>
                                    </details>
                                </TabsContent>
                            </Tabs>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="direct-estimated">Presupuesto estimado (€) — opcional</Label>
                            <Input
                                id="direct-estimated"
                                type="number"
                                min={0}
                                step={100}
                                placeholder="0"
                                value={estimatedBudget}
                                onChange={e => setEstimatedBudget(e.target.value)}
                            />
                            <p className="text-xs text-muted-foreground">
                                Puedes dejarlo en blanco y vincular un presupuesto más adelante.
                            </p>
                        </div>
                    </TabsContent>
                </Tabs>

                {/* --- Campos comunes de Project --- */}
                <div className="space-y-4 pt-2 border-t border-zinc-200 dark:border-zinc-700">
                    <div className="space-y-2 pt-4">
                        <Label htmlFor="project-name">
                            Nombre de la obra{mode === 'direct' ? ' *' : ''}
                        </Label>
                        <Input
                            id="project-name"
                            placeholder={selectedBudget
                                ? `Obra - ${selectedBudget.clientSnapshot?.name || ''}`
                                : 'Nombre del proyecto'}
                            value={name}
                            onChange={e => setName(e.target.value)}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="project-address">Dirección de la obra</Label>
                        <Input
                            id="project-address"
                            placeholder="Calle, número, ciudad"
                            value={address}
                            onChange={e => setAddress(e.target.value)}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="project-description">Descripción (opcional)</Label>
                        <Textarea
                            id="project-description"
                            placeholder="Breve descripción de la obra..."
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            rows={2}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="start-date">Fecha de inicio</Label>
                            <Input
                                id="start-date"
                                type="date"
                                value={startDate}
                                onChange={e => setStartDate(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="end-date">Fecha estimada fin</Label>
                            <Input
                                id="end-date"
                                type="date"
                                value={estimatedEndDate}
                                onChange={e => setEstimatedEndDate(e.target.value)}
                            />
                        </div>
                    </div>

                    {error && (
                        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800">
                            {error}
                        </div>
                    )}
                </div>

                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
                        Cancelar
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={submitDisabled}
                        className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white shadow-lg shadow-indigo-500/25"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Creando...
                            </>
                        ) : (
                            <>
                                <HardHat className="w-4 h-4 mr-2" />
                                Crear Obra
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
