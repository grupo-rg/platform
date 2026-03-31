'use client';

import { useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { getLeadByIdAction } from '@/actions/lead/dashboard.action';
import { User, Mail, Phone, Calendar, Loader2, Sparkles, Building, Briefcase, Clock, CheckCircle2, AlertCircle, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

interface LeadDetailsSheetProps {
    leadId: string | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDeleted?: (leadId: string) => void;
}

export function LeadDetailsSheet({ leadId, open, onOpenChange, onDeleted }: LeadDetailsSheetProps) {
    const [lead, setLead] = useState<any | null>(null);
    const [loading, setLoading] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const { toast } = useToast();

    useEffect(() => {
        if (!open || !leadId) return;
        async function load() {
            setLoading(true);
            const data = await getLeadByIdAction(leadId!);
            setLead(data);
            setLoading(false);
        }
        load();
    }, [leadId, open]);

    const PAIN_LABELS: Record<string, string> = {
        'budgeting': 'Presupuestos',
        'cost-control': 'Control de Costes',
        'certifications': 'Certificaciones'
    };

    const ROLE_LABELS: Record<string, string> = {
        'owner': 'Gerente',
        'project-manager': 'Director de Obra',
        'admin': 'Administrativo',
        'surveyor': 'Aparejador / Medidor'
    };

    const handleDelete = async () => {
        if (!leadId) return;
        if (!confirm('¿Estás seguro de que deseas eliminar este lead de forma permanente?')) return;

        setIsDeleting(true);
        try {
            const { deleteLeadAction } = await import('@/actions/lead/delete-lead.action');
            const res = await deleteLeadAction(leadId);
            if (res.success) {
                toast({ title: 'Lead eliminado correctamente' });
                onOpenChange(false);
                if (onDeleted) onDeleted(leadId);
            } else {
                toast({ title: 'Error', description: res.error, variant: 'destructive' });
            }
        } catch (error) {
            toast({ title: 'Error', description: 'Error de conexión', variant: 'destructive' });
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="w-full sm:max-w-xl md:max-w-2xl overflow-y-auto outline-none" side="right">
                <SheetHeader className="mb-6 flex flex-row items-start justify-between mr-8">
                    <div>
                        <SheetTitle className="text-2xl font-display flex items-center gap-2">
                            <User className="w-6 h-6 text-primary" /> Detalles del Lead
                        </SheetTitle>
                        <SheetDescription>
                            Visualiza toda la información de contacto y perfilado de este cliente potencial.
                        </SheetDescription>
                    </div>
                    {lead && (
                        <Button
                            variant="destructive"
                            size="sm"
                            onClick={handleDelete}
                            disabled={isDeleting}
                            className="shrink-0 gap-2"
                        >
                            <Trash2 className="w-4 h-4" />
                            {isDeleting ? 'Eliminando...' : 'Eliminar'}
                        </Button>
                    )}
                </SheetHeader>

                {loading ? (
                    <div className="flex flex-col items-center justify-center py-20">
                        <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
                        <p className="text-muted-foreground text-sm">Cargando datos del lead...</p>
                    </div>
                ) : lead ? (
                    <div className="space-y-8">
                        {/* Status Bar */}
                        <div className="flex items-center gap-3 p-4 bg-secondary/20 rounded-xl border border-border">
                            {lead.profile?.completedAt ? (
                                <Badge variant="default" className="bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 shadow-none border-emerald-500/20 text-sm py-1 px-3 flex items-center gap-1.5 font-medium">
                                    <Sparkles className="w-4 h-4" /> Perfil Completo
                                </Badge>
                            ) : lead.verification.isVerified ? (
                                <Badge variant="secondary" className="bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 shadow-none border-blue-500/20 text-sm py-1 px-3 flex items-center gap-1.5 font-medium">
                                    <CheckCircle2 className="w-4 h-4" /> Verificado OTP
                                </Badge>
                            ) : (
                                <Badge variant="outline" className="bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 shadow-none border-amber-500/20 text-sm py-1 px-3 flex items-center gap-1.5 font-medium">
                                    <AlertCircle className="w-4 h-4" /> Pendiente de Verificación
                                </Badge>
                            )}
                            <span className="text-xs text-muted-foreground ml-auto flex items-center gap-1">
                                <Calendar className="w-3.5 h-3.5" /> Registrado: {new Date(lead.createdAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}
                            </span>
                        </div>

                        {/* Contact Info */}
                        <div>
                            <h3 className="text-lg font-bold mb-4 font-display flex items-center gap-2">
                                <User className="w-5 h-5 text-muted-foreground" />
                                Información de Contacto
                            </h3>
                            <div className="grid sm:grid-cols-2 gap-4">
                                <div className="p-4 rounded-xl border border-border bg-card">
                                    <p className="text-sm font-semibold text-muted-foreground mb-1">Nombre</p>
                                    <p className="font-medium">{lead.personalInfo.name}</p>
                                </div>
                                <div className="p-4 rounded-xl border border-border bg-card">
                                    <p className="text-sm font-semibold text-muted-foreground mb-1">Email</p>
                                    <p className="font-medium flex items-center gap-2"><Mail className="w-4 h-4 text-muted-foreground" /> {lead.personalInfo.email}</p>
                                </div>
                                <div className="p-4 rounded-xl border border-border bg-card">
                                    <p className="text-sm font-semibold text-muted-foreground mb-1">Teléfono</p>
                                    <p className="font-medium flex items-center gap-2">
                                        <Phone className="w-4 h-4 text-muted-foreground" />
                                        {lead.personalInfo.phone || <span className="text-muted-foreground/50 italic">No proporcionado</span>}
                                    </p>
                                </div>
                                <div className="p-4 rounded-xl border border-border bg-card">
                                    <p className="text-sm font-semibold text-muted-foreground mb-1">Idioma / Vía Contacto</p>
                                    <div className="font-medium uppercase text-sm mt-1">
                                        <Badge variant="outline" className="mr-2">{lead.preferences.language}</Badge>
                                        <Badge variant="secondary">{lead.preferences.contactMethod}</Badge>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Client Profile */}
                        {lead.profile && (
                            <div>
                                <h3 className="text-lg font-bold mb-4 font-display flex items-center gap-2">
                                    <Briefcase className="w-5 h-5 text-muted-foreground" />
                                    Perfil del Cliente
                                </h3>

                                <div className="space-y-4">
                                    {/* Company Line */}
                                    <div className="grid sm:grid-cols-2 gap-4">
                                        <div className="p-4 rounded-xl border border-border bg-card">
                                            <p className="text-sm font-semibold text-muted-foreground mb-1">Empresa</p>
                                            <p className="font-medium flex items-center gap-2"><Building className="w-4 h-4 text-muted-foreground" /> {lead.profile.companyName}</p>
                                        </div>
                                        <div className="p-4 rounded-xl border border-border bg-card">
                                            <p className="text-sm font-semibold text-muted-foreground mb-1">Tamaño (Empleados)</p>
                                            <p className="font-medium">{lead.profile.companySize}</p>
                                        </div>
                                    </div>

                                    {/* Deep Profiling */}
                                    <div className="p-5 rounded-xl border border-border bg-card space-y-5">
                                        <div className="grid sm:grid-cols-3 gap-5">
                                            <div>
                                                <p className="text-sm font-semibold text-muted-foreground mb-1">Rol</p>
                                                <p className="font-medium">{ROLE_LABELS[lead.profile.role] || lead.profile.role}</p>
                                            </div>
                                            <div>
                                                <p className="text-sm font-semibold text-muted-foreground mb-1">Gasto Anual Mediciones</p>
                                                <p className="font-medium">{lead.profile.annualSurveyorSpend}</p>
                                            </div>
                                            <div>
                                                <p className="text-sm font-semibold text-muted-foreground mb-1">Horas Manuales (Semana)</p>
                                                <p className="font-medium flex items-center gap-2"><Clock className="w-4 h-4 text-muted-foreground" /> {lead.profile.weeklyManualHours}</p>
                                            </div>
                                        </div>

                                        <div className="h-px w-full bg-border" />

                                        <div className="grid sm:grid-cols-2 gap-5">
                                            <div>
                                                <p className="text-sm font-semibold text-muted-foreground mb-2">Dolores Principales</p>
                                                <div className="flex flex-wrap gap-2">
                                                    {Array.isArray(lead.profile.biggestPain) ? (
                                                        lead.profile.biggestPain.map((p: string) => (
                                                            <Badge key={p} variant="outline" className="bg-violet-500/5 text-violet-500 border-violet-500/20">{PAIN_LABELS[p] || p}</Badge>
                                                        ))
                                                    ) : typeof lead.profile.biggestPain === 'string' ? (
                                                        <Badge variant="outline" className="bg-violet-500/5 text-violet-500 border-violet-500/20">{PAIN_LABELS[lead.profile.biggestPain as string] || lead.profile.biggestPain}</Badge>
                                                    ) : <span className="text-muted-foreground/50 italic text-sm">Ninguno</span>}
                                                </div>
                                            </div>
                                            <div>
                                                <p className="text-sm font-semibold text-muted-foreground mb-2">Stack Actual de Software</p>
                                                <div className="flex flex-wrap gap-2">
                                                    {Array.isArray(lead.profile.currentStack) ? (
                                                        lead.profile.currentStack.map((s: string) => (
                                                            <Badge key={s} variant="secondary">{s}</Badge>
                                                        ))
                                                    ) : typeof lead.profile.currentStack === 'string' ? (
                                                        <Badge variant="secondary">{lead.profile.currentStack}</Badge>
                                                    ) : <span className="text-muted-foreground/50 italic text-sm">No especificado</span>}
                                                </div>
                                            </div>
                                        </div>

                                        <div>
                                            <p className="text-sm font-semibold text-muted-foreground mb-1">Volumen de Proyectos Simultáneos</p>
                                            <p className="font-medium">{lead.profile.simultaneousProjects}</p>
                                        </div>

                                    </div>
                                </div>
                            </div>
                        )}

                    </div>
                ) : (
                    <div className="text-center py-10 text-muted-foreground">Lead no encontrado.</div>
                )}
            </SheetContent>
        </Sheet>
    );
}
