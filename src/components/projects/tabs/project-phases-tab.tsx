'use client';

import { Project } from '@/backend/project/domain/project';
import { ProjectPhase, PhaseStatus } from '@/backend/project/domain/project-phase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Edit2, CheckCircle2, Circle, Clock, Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { useState } from 'react';
import { updateProjectPhaseAction } from '@/actions/project/update-project-phase.action';
import { addProjectPhaseAction, removeProjectPhaseAction, reorderProjectPhasesAction } from '@/actions/project/manage-project-phases.action';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';

interface ProjectPhasesTabProps {
    project: Project;
}

export function ProjectPhasesTab({ project }: ProjectPhasesTabProps) {
    const [selectedPhase, setSelectedPhase] = useState<ProjectPhase | null>(null);
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const router = useRouter();
    const { toast } = useToast();

    // Form state
    const [status, setStatus] = useState<PhaseStatus>('pendiente');
    const [progress, setProgress] = useState(0);
    const [notes, setNotes] = useState('');
    const [realCost, setRealCost] = useState(0);
    const [estimatedCost, setEstimatedCost] = useState(0);
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    const handleEditClick = (phase: ProjectPhase) => {
        setSelectedPhase(phase);
        setStatus(phase.status);
        setProgress(phase.progress);
        setNotes(phase.notes || '');
        setRealCost(phase.realCost || 0);
        setEstimatedCost(phase.estimatedCost || 0);
        setStartDate(phase.actualStartDate ? new Date(phase.actualStartDate).toISOString().split('T')[0] : '');
        setEndDate(phase.actualEndDate ? new Date(phase.actualEndDate).toISOString().split('T')[0] : '');
        setOpen(true);
    };

    const handleSave = async () => {
        if (!selectedPhase) return;
        setLoading(true);

        try {
            const result = await updateProjectPhaseAction(project.id, selectedPhase.id, {
                status,
                progress,
                notes,
                realCost,
                estimatedCost,
                actualStartDate: startDate || undefined,
                actualEndDate: endDate || undefined,
            });

            if (result.success) {
                toast({
                    title: 'Fase actualizada correctamente',
                });
                setOpen(false);
                router.refresh();
            } else {
                toast({
                    title: result.error || 'Error al actualizar',
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

    const getStatusIcon = (status: PhaseStatus) => {
        switch (status) {
            case 'completada': return <CheckCircle2 className="w-5 h-5 text-emerald-500" />;
            case 'en_progreso': return <Clock className="w-5 h-5 text-blue-500" />;
            default: return <Circle className="w-5 h-5 text-muted-foreground" />;
        }
    };

    const getStatusLabel = (status: PhaseStatus) => {
        switch (status) {
            case 'completada': return 'Completada';
            case 'en_progreso': return 'En Progreso';
            case 'pendiente': return 'Pendiente';
        }
    };

    // New state for adding phases
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [newPhaseName, setNewPhaseName] = useState('');
    const [newPhaseCost, setNewPhaseCost] = useState(0);

    const handleAddPhase = async () => {
        setLoading(true);
        try {
            const result = await addProjectPhaseAction(project.id, {
                name: newPhaseName,
                estimatedCost: newPhaseCost,
            });

            if (result.success) {
                toast({ title: 'Fase añadida correctamente' });
                setIsAddOpen(false);
                setNewPhaseName('');
                setNewPhaseCost(0);
                router.refresh();
            } else {
                toast({ title: result.error || 'Error al añadir fase', variant: 'destructive' });
            }
        } catch (error) {
            toast({ title: 'Error de conexión', variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    };

    const handleDeletePhase = async (phaseId: string) => {
        if (!confirm('¿Estás seguro de que quieres eliminar esta fase? esta acción no se puede deshacer.')) return;
        setLoading(true);
        try {
            const result = await removeProjectPhaseAction(project.id, phaseId);
            if (result.success) {
                toast({ title: 'Fase eliminada correctamente' });
                router.refresh();
            } else {
                toast({ title: result.error || 'Error al eliminar fase', variant: 'destructive' });
            }
        } catch (error) {
            toast({ title: 'Error de conexión', variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    };

    const handleMovePhase = async (index: number, direction: -1 | 1) => {
        if (loading) return;
        const newPhases = [...project.phases];
        const targetIndex = index + direction;

        if (targetIndex < 0 || targetIndex >= newPhases.length) return;

        // Swap in local array first if we wanted optimistic UI, but here we just get IDs
        const item = newPhases[index];
        newPhases.splice(index, 1);
        newPhases.splice(targetIndex, 0, item);

        const orderedIds = newPhases.map(p => p.id);

        setLoading(true);
        try {
            const result = await reorderProjectPhasesAction(project.id, orderedIds);
            if (result.success) {
                router.refresh();
            } else {
                toast({ title: 'Error al reordenar', variant: 'destructive' });
            }
        } catch (error) {
            toast({ title: 'Error de conexión', variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h2 className="text-xl font-semibold">Fases del Proyecto</h2>
                    <p className="text-sm text-muted-foreground">Gestiona el progreso y los costes de cada fase.</p>
                </div>
                <Button onClick={() => setIsAddOpen(true)} className="gap-2">
                    <Plus className="w-4 h-4" />
                    Nueva Fase
                </Button>
            </div>

            <div className="space-y-4 max-h-[calc(100vh-22rem)] overflow-y-auto pr-2 -mr-2 pb-8">
                {project.phases.map((phase, index) => (
                    <Card key={phase.id} className="relative overflow-hidden transition-all hover:shadow-md group">
                        <div className={`absolute left-0 top-0 bottom-0 w-1 ${phase.status === 'completada' ? 'bg-emerald-500' :
                            phase.status === 'en_progreso' ? 'bg-blue-500' : 'bg-zinc-200 dark:bg-zinc-700'
                            }`} />

                        <CardContent className="p-4 pl-6">
                            <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
                                <div className="flex items-center gap-3 min-w-[200px]">
                                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 font-bold text-sm">
                                        {index + 1}
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-lg">{phase.name}</h3>
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                            {getStatusIcon(phase.status)}
                                            <span>{getStatusLabel(phase.status)}</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex-1 w-full md:max-w-xs space-y-1">
                                    <div className="flex justify-between text-xs mb-1">
                                        <span>Progreso</span>
                                        <span className="font-medium">{phase.progress}%</span>
                                    </div>
                                    <Progress value={phase.progress} className="h-2" />
                                </div>

                                <div className="flex items-center gap-4 w-full md:w-auto justify-end">
                                    <div className="text-right hidden md:block">
                                        <div className="text-xs text-muted-foreground">Ejecutado / Estimado</div>
                                        <div className="font-medium">
                                            {new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(phase.realCost || 0)}
                                            <span className="text-muted-foreground text-xs mx-1">/</span>
                                            {new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(phase.estimatedCost || 0)}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <div className="flex flex-col mr-2">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-6 w-6"
                                                disabled={index === 0 || loading}
                                                onClick={() => handleMovePhase(index, -1)}
                                            >
                                                <ArrowUp className="w-3 h-3" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-6 w-6"
                                                disabled={index === project.phases.length - 1 || loading}
                                                onClick={() => handleMovePhase(index, 1)}
                                            >
                                                <ArrowDown className="w-3 h-3" />
                                            </Button>
                                        </div>
                                        <Button variant="ghost" size="icon" onClick={() => handleEditClick(phase)}>
                                            <Edit2 className="w-4 h-4" />
                                        </Button>
                                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDeletePhase(phase.id)}>
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
                                    </div>
                                </div>
                            </div>
                            {/* Notes display kept same */}
                            {phase.notes && (
                                <div className="mt-4 text-sm text-muted-foreground bg-zinc-50 dark:bg-zinc-900/50 p-3 rounded-md border border-zinc-100 dark:border-zinc-800">
                                    <span className="font-semibold text-xs uppercase tracking-wider block mb-1">Notas:</span>
                                    {phase.notes}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                ))}
            </div>

            <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Añadir Nueva Fase</DialogTitle>
                        <DialogDescription>Define el nombre y el coste estimado para la nueva fase.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Nombre de la Fase</Label>
                            <input
                                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                value={newPhaseName}
                                onChange={(e) => setNewPhaseName(e.target.value)}
                                placeholder="Ej. Instalación Eléctrica"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Coste Estimado (€)</Label>
                            <input
                                type="number"
                                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                value={newPhaseCost}
                                onChange={(e) => setNewPhaseCost(Number(e.target.value))}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsAddOpen(false)}>Cancelar</Button>
                        <Button onClick={handleAddPhase} disabled={!newPhaseName || loading}>
                            {loading ? 'Añadiendo...' : 'Añadir Fase'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={open} onOpenChange={setOpen}>
                {/* ... existing Edit Dialog content ... */}
                <DialogContent className="sm:max-w-[500px] max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Editar Fase: {selectedPhase?.name}</DialogTitle>
                        <DialogDescription>Actualiza estado, progreso, fechas y costes.</DialogDescription>
                    </DialogHeader>

                    <div className="space-y-6 py-4">
                        {/* Status & Progress */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Estado</Label>
                                <Select value={status} onValueChange={(v) => setStatus(v as PhaseStatus)}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="pendiente">Pendiente</SelectItem>
                                        <SelectItem value="en_progreso">En Progreso</SelectItem>
                                        <SelectItem value="completada">Completada</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Progreso: {progress}%</Label>
                                <Slider
                                    value={[progress]}
                                    onValueChange={(vals) => setProgress(vals[0])}
                                    max={100}
                                    step={5}
                                    className="py-2"
                                />
                            </div>
                        </div>

                        {/* Dates */}
                        <div className="space-y-3 border-t pt-4 border-zinc-100 dark:border-zinc-800">
                            <h4 className="text-sm font-medium text-muted-foreground">Fechas Reales</h4>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-xs">Inicio</Label>
                                    <input
                                        type="date"
                                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                        value={startDate}
                                        onChange={(e) => setStartDate(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-xs">Fin</Label>
                                    <input
                                        type="date"
                                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                        value={endDate}
                                        onChange={(e) => setEndDate(e.target.value)}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Financials */}
                        <div className="space-y-3 border-t pt-4 border-zinc-100 dark:border-zinc-800">
                            <h4 className="text-sm font-medium text-muted-foreground">Económico</h4>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-xs">Coste Estimado (€)</Label>
                                    <input
                                        type="number"
                                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                        value={estimatedCost}
                                        onChange={(e) => setEstimatedCost(Number(e.target.value))}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-xs">Coste Real Ejecutado (€)</Label>
                                    <input
                                        type="number"
                                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                        value={realCost}
                                        onChange={(e) => setRealCost(Number(e.target.value))}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2 border-t pt-4 border-zinc-100 dark:border-zinc-800">
                            <Label>Notas</Label>
                            <Textarea
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder="Añadir observaciones..."
                                className="resize-none"
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>Cancelar</Button>
                        <Button onClick={handleSave} disabled={loading}>{loading ? 'Guardando...' : 'Guardar Cambios'}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
