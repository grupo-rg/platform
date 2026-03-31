'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Download, BrainCircuit, CheckCircle2, Copy, FileJson2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export function AiTrainingClient({ initialData }: { initialData: any[] }) {
    const { toast } = useToast();
    const [traces] = useState(initialData);

    const handleExportJsonl = () => {
        // Vertex AI Fine-Tuning Format for Text generation (or general chat)
        // {"messages": [{"role": "user", "content": "prompt"}, {"role": "model", "content": "output"}]}

        const validTraces = traces.filter(t => t.resolution === 'human_edited' || t.resolution === 'accepted_as_is');

        if (validTraces.length === 0) {
            toast({
                title: "No hay datos válidos",
                description: "Necesitas trazas con resolución 'human_edited' o 'accepted_as_is'.",
                variant: 'destructive'
            });
            return;
        }

        let jsonlString = "";
        validTraces.forEach(t => {
            // The AI was trained to output JSON. The human edited JSON is the ground truth.
            const groundTruthJson = t.resolution === 'human_edited' && t.finalHumanJson
                ? t.finalHumanJson
                : t.baselineJson;

            const entry = {
                messages: [
                    { role: "user", content: t.originalPrompt },
                    { role: "model", content: JSON.stringify(groundTruthJson) }
                ] // Add system prompt here if needed by your specific Vertex schema
            };
            jsonlString += JSON.stringify(entry) + "\n";
        });

        const blob = new Blob([jsonlString], { type: 'application/jsonl' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `vertex-ai-training-${new Date().toISOString().split('T')[0]}.jsonl`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        toast({
            title: "Dataset Exportado",
            description: `Se han exportado ${validTraces.length} ejemplos válidos.`
        });
    };

    const getResolutionBadge = (res: string) => {
        switch (res) {
            case 'accepted_as_is':
                return <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 border-emerald-200">Aceptado sin cambios</Badge>;
            case 'human_edited':
                return <Badge className="bg-blue-500/15 text-blue-700 hover:bg-blue-500/25 border-blue-200">Editado por humano</Badge>;
            case 'rejected':
            default:
                return <Badge className="bg-zinc-100 text-zinc-600 hover:bg-zinc-200 border-zinc-200">Rechazado / Indeciso</Badge>;
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">AI Training (RLHF)</h2>
                    <p className="text-muted-foreground">Trazas cognitivas y aprendizaje por esfuerzo humano</p>
                </div>
                <Button onClick={handleExportJsonl} className="gap-2">
                    <Download className="w-4 h-4" />
                    Exportar JSONL (Vertex AI)
                </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Trazas Totales</CardTitle>
                        <BrainCircuit className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{traces.length}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Data Válida (RLHF)</CardTitle>
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {traces.filter(t => t.resolution !== 'rejected').length}
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Precisión Inicial (%)</CardTitle>
                        <FileJson2 className="h-4 w-4 text-blue-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {traces.length > 0 ? Math.round((traces.filter(t => t.resolution === 'accepted_as_is').length / traces.length) * 100) : 0}%
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Registro de Trazas (Cognitive Trace)</CardTitle>
                    <CardDescription>
                        Interacciones de usuarios que generan datos de entrenamiento para el LLM.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Fecha</TableHead>
                                    <TableHead className="w-[30%]">Prompt Original</TableHead>
                                    <TableHead>Métricas IA</TableHead>
                                    <TableHead>Edición Humana</TableHead>
                                    <TableHead>Resolución</TableHead>
                                    <TableHead className="text-right">Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {traces.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="h-24 text-center">
                                            No hay trazas registradas todavía.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    traces.map((trace) => (
                                        <TableRow key={trace.id}>
                                            <TableCell className="font-medium whitespace-nowrap">
                                                {new Date(trace.createdAt).toLocaleDateString()}
                                            </TableCell>
                                            <TableCell className="text-xs truncate max-w-[200px]" title={trace.originalPrompt}>
                                                {trace.originalPrompt}
                                            </TableCell>
                                            <TableCell className="text-xs text-muted-foreground">
                                                <div className="flex flex-col gap-1">
                                                    <span>{(trace.metrics?.baselineTimeMs / 1000).toFixed(1)}s gener.</span>
                                                    <span>{trace.metrics?.baselineTokens} tokens</span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-xs text-muted-foreground">
                                                {trace.metrics?.humanEditTimeMs
                                                    ? `${(trace.metrics?.humanEditTimeMs / 1000 / 60).toFixed(1)} min`
                                                    : '-'}
                                            </TableCell>
                                            <TableCell>
                                                {getResolutionBadge(trace.resolution)}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Button variant="ghost" size="sm" onClick={() => {
                                                    navigator.clipboard.writeText(JSON.stringify(trace.baselineJson, null, 2));
                                                    toast({ description: 'JSON Original Copiado' });
                                                }}>
                                                    <Copy className="w-4 h-4" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
