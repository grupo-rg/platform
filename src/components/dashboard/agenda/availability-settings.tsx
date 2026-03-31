'use client';

import { useState, useEffect } from 'react';
import { getAvailabilityConfigAction, updateAvailabilityConfigAction } from '@/actions/agenda/config.action';
import { AvailabilityConfig, DaySchedule, TimeRange } from '@/backend/agenda/domain/availability-config';
import { Loader2, Plus, Trash2, Save, Clock, Info } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const DAYS_OF_WEEK = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export function AvailabilitySettings() {
    const [config, setConfig] = useState<Omit<AvailabilityConfig, 'id' | 'updatedAt'> | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadConfig();
    }, []);

    const loadConfig = async () => {
        try {
            const data = await getAvailabilityConfigAction();
            setConfig({
                weekSchedule: data.weekSchedule,
                slotDurationMinutes: data.slotDurationMinutes,
                bufferMinutes: data.bufferMinutes
            });
        } catch (err: any) {
            setError('Error al cargar la configuración: ' + err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!config) return;
        setSaving(true);
        setError(null);
        try {
            const result = await updateAvailabilityConfigAction(config);
            if (!result.success) throw new Error(result.error);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const toggleDay = (dayIndex: number) => {
        if (!config) return;
        const newSchedule = { ...config.weekSchedule };
        if (!newSchedule[dayIndex]) {
            newSchedule[dayIndex] = { enabled: false, slots: [] };
        }
        newSchedule[dayIndex].enabled = !newSchedule[dayIndex].enabled;
        if (newSchedule[dayIndex].enabled && newSchedule[dayIndex].slots.length === 0) {
            newSchedule[dayIndex].slots = [{ start: '09:00', end: '13:00' }]; // Default slot when enabled
        }
        setConfig({ ...config, weekSchedule: newSchedule });
    };

    const addTimeRange = (dayIndex: number) => {
        if (!config) return;
        const newSchedule = { ...config.weekSchedule };
        newSchedule[dayIndex].slots.push({ start: '09:00', end: '10:00' });
        setConfig({ ...config, weekSchedule: newSchedule });
    };

    const removeTimeRange = (dayIndex: number, slotIndex: number) => {
        if (!config) return;
        const newSchedule = { ...config.weekSchedule };
        newSchedule[dayIndex].slots.splice(slotIndex, 1);
        setConfig({ ...config, weekSchedule: newSchedule });
    };

    const updateTimeRange = (dayIndex: number, slotIndex: number, field: 'start' | 'end', value: string) => {
        if (!config) return;
        const newSchedule = { ...config.weekSchedule };
        newSchedule[dayIndex].slots[slotIndex][field] = value;
        setConfig({ ...config, weekSchedule: newSchedule });
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    if (!config) return null;

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {error && (
                <div className="p-4 bg-red-50 text-red-600 rounded-lg border border-red-200 text-sm">
                    {error}
                </div>
            )}

            <div className="bg-card border border-border rounded-2xl p-6 md:p-8 shadow-sm">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                    <div>
                        <h2 className="text-xl font-semibold flex items-center gap-2">
                            <Clock className="w-5 h-5 text-primary" />
                            Ajustes Generales
                        </h2>
                        <p className="text-sm text-muted-foreground mt-1">
                            Configura la duración de las reuniones y el tiempo de margen entre ellas.
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-3">
                        <Label>Duración de la sesión (minutos)</Label>
                        <div className="flex items-center gap-3">
                            <Input
                                type="number"
                                min={15} step={15}
                                value={config.slotDurationMinutes}
                                onChange={(e) => setConfig({ ...config, slotDurationMinutes: parseInt(e.target.value) || 30 })}
                                className="w-32"
                            />
                            <span className="text-sm text-muted-foreground">minutos por defecto</span>
                        </div>
                    </div>
                    <div className="space-y-3">
                        <Label>Margen entre reuniones (minutos)</Label>
                        <div className="flex items-center gap-3">
                            <Input
                                type="number"
                                min={0} step={5}
                                value={config.bufferMinutes}
                                onChange={(e) => setConfig({ ...config, bufferMinutes: parseInt(e.target.value) || 0 })}
                                className="w-32"
                            />
                            <span className="text-sm text-muted-foreground">tiempo libre entre sesiones</span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="bg-card border border-border rounded-2xl p-6 md:p-8 shadow-sm">
                <div className="mb-8">
                    <h2 className="text-xl font-semibold mb-1">Horarios Semanales</h2>
                    <p className="text-sm text-muted-foreground">
                        Define los días y franjas horarias en las que estás disponible para agendar reuniones.
                    </p>
                </div>

                <div className="space-y-6">
                    {DAYS_OF_WEEK.map((dayName, index) => {
                        // JavaScript Date uses 0 for Sunday
                        const dayIndex = index;
                        const dayConfig = config.weekSchedule[dayIndex] || { enabled: false, slots: [] };

                        return (
                            <div key={dayIndex} className={`pt-6 first:pt-0 ${index !== 0 ? 'border-t border-border/50' : ''}`}>
                                <div className="flex flex-col md:flex-row md:items-start gap-6">
                                    <div className="flex items-center gap-3 w-40 flex-shrink-0">
                                        <Switch
                                            checked={dayConfig.enabled}
                                            onCheckedChange={() => toggleDay(dayIndex)}
                                        />
                                        <Label className={`font-medium ${dayConfig.enabled ? 'text-foreground' : 'text-muted-foreground'}`}>
                                            {dayName}
                                        </Label>
                                    </div>

                                    <div className="flex-1 space-y-3">
                                        {!dayConfig.enabled ? (
                                            <p className="text-sm text-muted-foreground py-1">No disponible</p>
                                        ) : (
                                            <>
                                                {dayConfig.slots.map((slot, sIdx) => (
                                                    <div key={sIdx} className="flex items-center gap-3">
                                                        <Input
                                                            type="time"
                                                            value={slot.start}
                                                            onChange={(e) => updateTimeRange(dayIndex, sIdx, 'start', e.target.value)}
                                                            className="w-32"
                                                        />
                                                        <span className="text-muted-foreground">-</span>
                                                        <Input
                                                            type="time"
                                                            value={slot.end}
                                                            onChange={(e) => updateTimeRange(dayIndex, sIdx, 'end', e.target.value)}
                                                            className="w-32"
                                                        />
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="text-muted-foreground hover:text-red-500 hover:bg-red-50"
                                                            onClick={() => removeTimeRange(dayIndex, sIdx)}
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </Button>
                                                    </div>
                                                ))}
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="mt-2 text-xs border-dashed"
                                                    onClick={() => addTimeRange(dayIndex)}
                                                >
                                                    <Plus className="w-3 h-3 mr-1" /> Añadir horario
                                                </Button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="flex justify-end pt-4">
                <Button
                    onClick={handleSave}
                    disabled={saving}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 min-w-[150px]"
                >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                    {saving ? 'Guardando...' : 'Guardar Cambios'}
                </Button>
            </div>
        </div>
    );
}
