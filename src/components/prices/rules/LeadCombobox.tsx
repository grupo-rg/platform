'use client';

/**
 * Combobox de clientes (leads) para las reglas de scope `client`.
 *
 * Reutiliza `listLeadsForSelectorAction` (la lista ligera pensada justo para
 * este tipo de selector). Como el repo de UI no incluye `command`, se construye
 * un buscador simple con Popover + Input + lista filtrada en cliente.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Check, ChevronsUpDown, Loader2, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    listLeadsForSelectorAction,
    type LeadSelectorItem,
} from '@/actions/lead/list-leads-for-selector.action';

export interface LeadComboboxProps {
    value?: string | null;
    /** Etiqueta a mostrar si el lead seleccionado no está en la lista cargada. */
    valueLabel?: string | null;
    onChange: (leadId: string, label: string) => void;
    placeholder?: string;
    disabled?: boolean;
    className?: string;
}

export function LeadCombobox({
    value,
    valueLabel,
    onChange,
    placeholder = 'Selecciona un cliente…',
    disabled,
    className,
}: LeadComboboxProps) {
    const [open, setOpen] = useState(false);
    const [leads, setLeads] = useState<LeadSelectorItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [query, setQuery] = useState('');
    const loadedRef = useRef(false);

    useEffect(() => {
        if (!open || loadedRef.current) return;
        loadedRef.current = true;
        setLoading(true);
        listLeadsForSelectorAction({ limit: 200 })
            .then((res) => setLeads(res.success && res.leads ? res.leads : []))
            .catch(() => setLeads([]))
            .finally(() => setLoading(false));
    }, [open]);

    const selected = useMemo(() => leads.find((l) => l.id === value) || null, [leads, value]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return leads;
        return leads.filter((l) =>
            [l.name, l.email, l.phone, l.companyName || '', l.nif || '', l.id]
                .join(' ')
                .toLowerCase()
                .includes(q),
        );
    }, [leads, query]);

    const triggerLabel = selected
        ? `${selected.name}${selected.companyName ? ` · ${selected.companyName}` : ''}`
        : valueLabel || (value ? `Cliente ${value}` : placeholder);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    disabled={disabled}
                    className={cn('w-full justify-between font-normal', !value && 'text-muted-foreground', className)}
                >
                    <span className="flex items-center gap-2 truncate">
                        <User className="h-4 w-4 shrink-0 opacity-60" />
                        <span className="truncate">{triggerLabel}</span>
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <div className="p-2 border-b">
                    <Input
                        autoFocus
                        placeholder="Buscar por nombre, email, NIF…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        className="h-9"
                    />
                </div>
                <ScrollArea className="max-h-72">
                    {loading ? (
                        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" /> Cargando clientes…
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="py-8 text-center text-sm text-muted-foreground">
                            {leads.length === 0 ? 'No hay clientes disponibles.' : 'Sin coincidencias.'}
                        </div>
                    ) : (
                        <ul className="py-1">
                            {filtered.map((lead) => {
                                const isActive = lead.id === value;
                                return (
                                    <li key={lead.id}>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                onChange(lead.id, lead.name);
                                                setOpen(false);
                                            }}
                                            className={cn(
                                                'flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-accent',
                                                isActive && 'bg-accent',
                                            )}
                                        >
                                            <Check className={cn('mt-0.5 h-4 w-4 shrink-0', isActive ? 'opacity-100' : 'opacity-0')} />
                                            <span className="flex flex-col">
                                                <span className="font-medium">{lead.name}</span>
                                                <span className="text-xs text-muted-foreground">
                                                    {[lead.companyName, lead.email, lead.phone].filter(Boolean).join(' · ')}
                                                </span>
                                            </span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </ScrollArea>
            </PopoverContent>
        </Popover>
    );
}
