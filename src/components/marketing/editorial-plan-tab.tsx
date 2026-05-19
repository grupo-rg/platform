'use client';

/**
 * Tab "Plan editorial" del SEO generator. Muestra dos paneles:
 *
 *   1. Generador de plan — form con seed keywords + cadencia. Al ejecutar,
 *      el `EditorialPlannerAgent` produce N briefs propuestos.
 *   2. Lista de briefs `proposed` — el admin aprueba (genera post +
 *      programa) o rechaza en bloque.
 *
 * El admin nunca aprueba "a ciegas" — ve título, ángulo, keywords, fecha
 * sugerida, rationale y si el post enlaza a algún servicio del catálogo.
 */

import { useEffect, useState, useTransition } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
    Sparkles, Check, X, Loader2, Calendar, Target, FileText, RefreshCw, Link as LinkIcon,
} from 'lucide-react';
import {
    generateEditorialPlanAction,
    listProposedBriefsAction,
    approveBriefAction,
    rejectBriefAction,
    deleteBriefAction,
} from '@/actions/marketing/editorial-plan.action';
import type { ContentBrief } from '@/backend/marketing/domain/content-brief';
import type { BlogLocale } from '@/backend/marketing/domain/blog-post';

const INTENT_LABEL: Record<string, string> = {
    informational: 'Informativo',
    commercial: 'Comercial',
    transactional: 'Transaccional',
    navigational: 'Navegacional',
};

const INTENT_COLOR: Record<string, string> = {
    informational: 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
    commercial: 'bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300',
    transactional: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
    navigational: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800/40 dark:text-zinc-300',
};

export function EditorialPlanTab() {
    const { toast } = useToast();
    const [briefs, setBriefs] = useState<ContentBrief[]>([]);
    const [loading, setLoading] = useState(true);
    const [isPending, startTransition] = useTransition();

    // Form state
    const [locale, setLocale] = useState<BlogLocale>('es');
    const [weeks, setWeeks] = useState(4);
    const [postsPerWeek, setPostsPerWeek] = useState(2);
    const [seedInput, setSeedInput] = useState('reformas Mallorca, piscinas, baños, cocinas');

    const load = async () => {
        setLoading(true);
        const list = await listProposedBriefsAction();
        setBriefs(list);
        setLoading(false);
    };
    useEffect(() => { load(); }, []);

    const handleGenerate = () => {
        const seedKeywords = seedInput.split(',').map(s => s.trim()).filter(Boolean);
        if (seedKeywords.length === 0) {
            toast({ title: 'Añade al menos una keyword semilla', variant: 'destructive' });
            return;
        }
        startTransition(async () => {
            const res = await generateEditorialPlanAction({ locale, weeks, postsPerWeek, seedKeywords });
            if (res.success) {
                toast({
                    title: `Plan generado: ${res.briefs.length} briefs propuestos`,
                    description: 'Revísalos abajo y aprueba los que quieras.',
                });
                await load();
            } else {
                toast({ title: 'Error generando plan', description: res.error, variant: 'destructive' });
            }
        });
    };

    const handleApprove = (briefId: string) => {
        startTransition(async () => {
            const res = await approveBriefAction(briefId);
            if (res.success) {
                toast({
                    title: 'Brief aprobado',
                    description: 'Post generado y programado correctamente.',
                });
                await load();
            } else {
                toast({ title: 'Error al aprobar', description: res.error, variant: 'destructive' });
            }
        });
    };

    const handleReject = (briefId: string) => {
        startTransition(async () => {
            const res = await rejectBriefAction(briefId);
            if (res.success) {
                toast({ title: 'Brief rechazado' });
                await load();
            } else {
                toast({ title: 'Error', description: res.error, variant: 'destructive' });
            }
        });
    };

    const handleDelete = (briefId: string) => {
        startTransition(async () => {
            const res = await deleteBriefAction(briefId);
            if (res.success) await load();
            else toast({ title: 'Error al borrar', description: res.error, variant: 'destructive' });
        });
    };

    return (
        <div className="space-y-6">
            {/* Generador de plan */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Sparkles className="w-5 h-5 text-primary" />
                        Generar plan editorial
                    </CardTitle>
                    <CardDescription>
                        El agente analiza huecos del catálogo de servicios, busca tendencias en Google Trends
                        y propone {weeks * postsPerWeek} ideas distribuidas en {weeks} semanas. Tú apruebas
                        las que valen.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid gap-4 md:grid-cols-4">
                        <div className="space-y-1">
                            <Label className="text-xs">Idioma</Label>
                            <Select value={locale} onValueChange={(v) => setLocale(v as BlogLocale)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="es">Español</SelectItem>
                                    <SelectItem value="en">English</SelectItem>
                                    <SelectItem value="ca">Català</SelectItem>
                                    <SelectItem value="de">Deutsch</SelectItem>
                                    <SelectItem value="nl">Nederlands</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs">Semanas</Label>
                            <Input type="number" min={1} max={12} value={weeks} onChange={e => setWeeks(Number(e.target.value) || 4)} />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs">Posts/semana</Label>
                            <Input type="number" min={1} max={7} value={postsPerWeek} onChange={e => setPostsPerWeek(Number(e.target.value) || 2)} />
                        </div>
                        <div className="space-y-1 md:col-span-1 flex items-end">
                            <Button onClick={handleGenerate} disabled={isPending} className="w-full">
                                {isPending ? (
                                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generando…</>
                                ) : (
                                    <><Sparkles className="w-4 h-4 mr-2" />Generar plan</>
                                )}
                            </Button>
                        </div>
                    </div>
                    <div className="mt-4 space-y-1">
                        <Label className="text-xs">Keywords semilla (separadas por coma)</Label>
                        <Input
                            value={seedInput}
                            onChange={e => setSeedInput(e.target.value)}
                            placeholder="reformas Mallorca, piscinas, baños…"
                        />
                        <p className="text-xs text-muted-foreground">
                            El agente expandirá estas semillas con Google Trends + relacionadas.
                        </p>
                    </div>
                </CardContent>
            </Card>

            {/* Lista de briefs propuestos */}
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle>Briefs propuestos</CardTitle>
                            <CardDescription>{briefs.length} ideas pendientes de revisión.</CardDescription>
                        </div>
                        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                            Refrescar
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="py-12 flex justify-center">
                            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                        </div>
                    ) : briefs.length === 0 ? (
                        <div className="py-12 flex flex-col items-center text-muted-foreground">
                            <FileText className="w-10 h-10 mb-3 opacity-30" />
                            <p className="text-sm">No hay briefs propuestos. Genera un plan arriba.</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {briefs.map(brief => (
                                <BriefCard
                                    key={brief.id}
                                    brief={brief}
                                    onApprove={() => handleApprove(brief.id)}
                                    onReject={() => handleReject(brief.id)}
                                    onDelete={() => handleDelete(brief.id)}
                                    isPending={isPending}
                                />
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

function BriefCard({
    brief, onApprove, onReject, onDelete, isPending,
}: {
    brief: ContentBrief;
    onApprove: () => void;
    onReject: () => void;
    onDelete: () => void;
    isPending: boolean;
}) {
    const intentColor = INTENT_COLOR[brief.intent] || INTENT_COLOR.informational;
    return (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 bg-background hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        <Badge className={`text-[10px] ${intentColor} border-0`}>
                            {INTENT_LABEL[brief.intent] || brief.intent}
                        </Badge>
                        {brief.proposedPublishAt && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                {new Date(brief.proposedPublishAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </span>
                        )}
                        <span className="text-xs text-muted-foreground uppercase">{brief.locale}</span>
                    </div>
                    <h4 className="font-semibold text-sm mb-1">{brief.title}</h4>
                    {brief.angle && (
                        <p className="text-xs text-muted-foreground italic mb-2">{brief.angle}</p>
                    )}
                    <div className="flex items-center gap-1.5 flex-wrap mb-2">
                        <Target className="w-3 h-3 text-muted-foreground" />
                        <span className="text-xs font-medium">{brief.primaryKeyword}</span>
                        {brief.secondaryKeywords.slice(0, 4).map(k => (
                            <Badge key={k} variant="outline" className="text-[10px]">{k}</Badge>
                        ))}
                        {brief.secondaryKeywords.length > 4 && (
                            <span className="text-[10px] text-muted-foreground">+{brief.secondaryKeywords.length - 4}</span>
                        )}
                    </div>
                    {brief.relatedServicePath && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1">
                            <LinkIcon className="w-3 h-3" />
                            Servicio: <code className="text-[10px]">{brief.relatedServicePath}</code>
                        </p>
                    )}
                    {brief.rationale && (
                        <p className="text-xs text-muted-foreground mt-1">{brief.rationale}</p>
                    )}
                    {brief.adminNote && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">⚠ {brief.adminNote}</p>
                    )}
                </div>

                <div className="flex flex-col gap-1.5 shrink-0">
                    <Button size="sm" onClick={onApprove} disabled={isPending} className="gap-1.5">
                        <Check className="w-3.5 h-3.5" />
                        Aprobar
                    </Button>
                    <Button size="sm" variant="outline" onClick={onReject} disabled={isPending} className="gap-1.5">
                        <X className="w-3.5 h-3.5" />
                        Rechazar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={onDelete} disabled={isPending} className="text-xs text-muted-foreground hover:text-red-600">
                        Borrar
                    </Button>
                </div>
            </div>
        </div>
    );
}
