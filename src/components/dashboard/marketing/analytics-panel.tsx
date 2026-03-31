'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Target, Users, Zap, PauseCircle, PlayCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export function AnalyticsPanel() {
    const [stats, setStats] = useState({ 
        totalInSequences: 412,
        conversionVariantA: '18.5%', 
        conversionVariantB: '12.1%' 
    });
    const [sequences, setSequences] = useState<any[]>([]);

    useEffect(() => {
        // Fetch sequences from our backend API route
        fetch('/api/marketing/sequences')
            .then(res => res.json())
            .then(data => {
                if (data.sequences) setSequences(data.sequences);
            })
            .catch(err => console.error("Error fetching sequences", err));
    }, []);

    const handleToggleSequence = (id: string) => {
        // Stub implementation
        setSequences(prev => prev.map(s => s.id === id ? { ...s, active: !s.active } : s));
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Analytics Column */}
            <div className="col-span-1 lg:col-span-2 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Card className="bg-slate-900 border-slate-800">
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium text-slate-300">Leads en Secuencia</CardTitle>
                            <Users className="h-4 w-4 text-slate-400" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-bold text-white">{stats.totalInSequences}</div>
                            <p className="text-xs text-slate-500 mt-1">Actualmente recibiendo nutrición</p>
                        </CardContent>
                    </Card>

                    <Card className="bg-slate-900 border-indigo-900 shadow-indigo-900/20">
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium text-indigo-300">Test A (Flash)</CardTitle>
                            <Zap className="h-4 w-4 text-indigo-400" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-bold text-indigo-100">{stats.conversionVariantA}</div>
                            <p className="text-xs text-indigo-400/70 mt-1">Conversión a Call Scheduled</p>
                        </CardContent>
                    </Card>

                    <Card className="bg-slate-900 border-slate-800">
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium text-slate-300">Test B (Soft)</CardTitle>
                            <Target className="h-4 w-4 text-slate-400" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-bold text-slate-100">{stats.conversionVariantB}</div>
                            <p className="text-xs text-slate-500 mt-1">Conversión a Call Scheduled</p>
                        </CardContent>
                    </Card>
                </div>

                <Card className="bg-slate-900/50 border-slate-800 p-6">
                    <h3 className="text-lg font-semibold text-white mb-4">Rendimiento de Variantes (Simulado)</h3>
                    <div className="h-48 rounded-xl border border-slate-800 bg-slate-800/20 flex items-center justify-center p-4">
                        <p className="text-slate-500 text-sm">El gráfico de barras detallado renderizará aquí los resultados del test A/B.</p>
                    </div>
                </Card>
            </div>

            {/* Sequence Control Panel */}
            <div className="col-span-1 space-y-6">
                <h3 className="text-lg font-semibold text-white flex items-center">
                    <Zap className="w-5 h-5 mr-2 text-purple-400" />
                    Control de Secuencias
                </h3>
                
                <div className="space-y-4">
                    {sequences.length === 0 ? (
                        <div className="p-4 rounded-lg border border-slate-800 bg-slate-900/50 text-slate-400 text-sm">
                            No hay secuencias activas devueltas por el API. (Si la base de datos está vacía, aquí se mostrarán los flujos VSL).
                        </div>
                    ) : (
                        sequences.map(seq => (
                            <Card key={seq.id} className="bg-slate-900 border-slate-800 relative overflow-hidden">
                                {seq.active && <div className="absolute top-0 left-0 w-1 h-full bg-green-500" />}
                                {!seq.active && <div className="absolute top-0 left-0 w-1 h-full bg-slate-700" />}
                                <CardHeader className="pb-2">
                                    <div className="flex justify-between items-start">
                                        <CardTitle className="text-base text-white">{seq.name}</CardTitle>
                                        <Badge variant={seq.active ? "default" : "secondary"} className={seq.active ? "bg-green-500/10 text-green-400 hover:bg-green-500/20 border-green-500/20" : ""}>
                                            {seq.active ? 'Activa' : 'Pausada'}
                                        </Badge>
                                    </div>
                                    <CardDescription className="text-xs text-slate-400 mt-1">
                                        {seq.steps?.length || 0} pasos configurados
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <Button 
                                        variant="outline" 
                                        size="sm" 
                                        className="w-full mt-2 border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800 hover:text-white"
                                        onClick={() => handleToggleSequence(seq.id)}
                                    >
                                        {seq.active ? (
                                            <><PauseCircle className="w-4 h-4 mr-2" /> Pausar Globalmente</>
                                        ) : (
                                            <><PlayCircle className="w-4 h-4 mr-2" /> Reanudar Globalmente</>
                                        )}
                                    </Button>
                                </CardContent>
                            </Card>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
