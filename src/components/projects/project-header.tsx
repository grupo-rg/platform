'use client';

import { Project, ProjectStatus, PROJECT_STATUS_TRANSITIONS } from '@/backend/project/domain/project';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Calendar, ChevronDown, MapPin, Building2, Clock, CheckCircle2, AlertCircle, Edit2 } from 'lucide-react';
import { updateProjectStatusAction } from '@/actions/project/update-project-status.action';
import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import { Label } from '@/components/ui/label';
import { updateProjectAction } from '@/actions/project/update-project.action';

interface ProjectHeaderProps {
    project: Project;
    locale: string;
}

const STATUS_LABELS: Record<ProjectStatus, string> = {
    preparacion: 'Preparación',
    ejecucion: 'En Ejecución',
    pausada: 'Pausada',
    finalizada: 'Finalizada',
    cerrada: 'Cerrada',
};

const STATUS_COLORS: Record<ProjectStatus, string> = {
    preparacion: 'bg-indigo-500',
    ejecucion: 'bg-emerald-500',
    pausada: 'bg-amber-500',
    finalizada: 'bg-blue-500',
    cerrada: 'bg-slate-500',
};

export function ProjectHeader({ project, locale }: ProjectHeaderProps) {
    const [status, setStatus] = useState<ProjectStatus>(project.status);
    const [loading, setLoading] = useState(false);
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [editStartDate, setEditStartDate] = useState(project.startDate ? new Date(project.startDate).toISOString().split('T')[0] : '');
    const [editEndDate, setEditEndDate] = useState(project.estimatedEndDate ? new Date(project.estimatedEndDate).toISOString().split('T')[0] : '');

    const router = useRouter();
    const { toast } = useToast();

    const formatDate = (date?: Date) => {
        if (!date) return 'Sin fecha';
        return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(date));
    };

    const handleStatusChange = async (newStatus: ProjectStatus) => {
        setLoading(true);
        try {
            const result = await updateProjectStatusAction(project.id, newStatus);
            if (result.success) {
                setStatus(newStatus);
                toast({
                    title: `Estado actualizado a ${STATUS_LABELS[newStatus]}`,
                });
                router.refresh();
            } else {
                toast({
                    title: 'Error al actualizar estado',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            toast({
                title: 'Error de conexión',
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
        }
    };

    const handleDateSave = async () => {
        setLoading(true);
        try {
            const result = await updateProjectAction(project.id, {
                startDate: editStartDate || undefined,
                estimatedEndDate: editEndDate || undefined,
            });
            if (result.success) {
                toast({ title: 'Fechas actualizadas' });
                setIsEditOpen(false);
                router.refresh();
            } else {
                toast({ title: 'Error al actualizar', variant: 'destructive' });
            }
        } catch (error) {
            toast({ title: 'Error de conexión', variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    };

    // Calculate progress based on phases completion or cost (simple version: average phase progress)
    const phaseProgress = project.phases.length > 0
        ? project.phases.reduce((acc, p) => acc + (p.progress || 0), 0) / project.phases.length
        : 0;

    const allowedTransitions = PROJECT_STATUS_TRANSITIONS[status] || [];

    return (
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-sm space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-muted-foreground text-sm">
                        <Building2 className="w-4 h-4" />
                        <span>{project.clientSnapshot?.name || 'Cliente desconocido'}</span>
                    </div>
                    <h1 className="text-2xl font-bold tracking-tight text-foreground">{project.name}</h1>
                    {project.address && (
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <MapPin className="w-3.5 h-3.5" />
                            {project.address}
                        </div>
                    )}
                </div>

                <div className="flex flex-col items-end gap-3">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" className="gap-2 min-w-[140px] justify-between" disabled={loading}>
                                <div className="flex items-center gap-2">
                                    <div className={`w-2 h-2 rounded-full ${STATUS_COLORS[status]}`} />
                                    {STATUS_LABELS[status]}
                                </div>
                                <ChevronDown className="w-4 h-4 opacity-50" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            {allowedTransitions.map((s) => (
                                <DropdownMenuItem key={s} onClick={() => handleStatusChange(s)}>
                                    <div className={`w-2 h-2 rounded-full ${STATUS_COLORS[s]} mr-2`} />
                                    Mark as {STATUS_LABELS[s]}
                                </DropdownMenuItem>
                            ))}
                            {allowedTransitions.length === 0 && (
                                <div className="p-2 text-xs text-muted-foreground">No hay transiciones disponibles</div>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>

                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5 group cursor-pointer" onClick={() => setIsEditOpen(true)}>
                            <Calendar className="w-3.5 h-3.5" />
                            <span className="group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                                {formatDate(project.startDate)} - {formatDate(project.estimatedEndDate)}
                            </span>
                            <Edit2 className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity ml-1" />
                        </div>
                    </div>
                </div>
            </div>

            <div className="space-y-2">
                <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground font-medium">Progreso General</span>
                    <span className="font-bold">{Math.round(phaseProgress)}%</span>
                </div>
                <Progress value={phaseProgress} className="h-2.5" />
            </div>

            <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Editar Fechas del Proyecto</DialogTitle>
                        <DialogDescription>
                            Ajusta las fechas de inicio y finalización estimada.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="startDate">Fecha de Inicio</Label>
                            <input
                                id="startDate"
                                type="date"
                                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                value={editStartDate}
                                onChange={(e) => setEditStartDate(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="endDate">Fecha Estimada de Fin</Label>
                            <input
                                id="endDate"
                                type="date"
                                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                value={editEndDate}
                                onChange={(e) => setEditEndDate(e.target.value)}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsEditOpen(false)}>Cancelar</Button>
                        <Button onClick={handleDateSave} disabled={loading}>{loading ? 'Guardando...' : 'Guardar'}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
