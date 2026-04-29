'use client';

import { useState, useEffect, useTransition } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DayPicker } from 'react-day-picker';
import ReactMarkdown from 'react-markdown';
import {
    Loader2, Sparkles, FileText, CalendarDays, CheckCircle2, Trash2, Eye,
    Clock, ExternalLink, Send,
} from 'lucide-react';
import {
    generateAndSaveBlogPostAction,
    listBlogPostsAction,
    deleteBlogPostAction,
    scheduleBlogPostAction,
    publishBlogPostNowAction,
} from '@/actions/marketing/blog-post.action';
import type { BlogPost, BlogLocale } from '@/backend/marketing/domain/blog-post';

export default function SeoGeneratorPage() {
    return (
        <div className="max-w-6xl mx-auto space-y-6">
            <div>
                <h1 className="text-2xl font-bold font-headline tracking-tight">Generador SEO</h1>
                <p className="text-sm text-muted-foreground">
                    Genera artículos optimizados con IA, prográmalos y publícalos automáticamente en tu blog.
                </p>
            </div>

            <Tabs defaultValue="new">
                <TabsList className="grid w-full max-w-md grid-cols-4">
                    <TabsTrigger value="new"><Sparkles className="w-4 h-4 mr-1.5" />Nuevo</TabsTrigger>
                    <TabsTrigger value="drafts"><FileText className="w-4 h-4 mr-1.5" />Borradores</TabsTrigger>
                    <TabsTrigger value="calendar"><CalendarDays className="w-4 h-4 mr-1.5" />Calendario</TabsTrigger>
                    <TabsTrigger value="published"><CheckCircle2 className="w-4 h-4 mr-1.5" />Publicados</TabsTrigger>
                </TabsList>
                <TabsContent value="new" className="mt-6"><NewTab /></TabsContent>
                <TabsContent value="drafts" className="mt-6"><PostListTab status="draft" emptyLabel="No hay borradores." showActions /></TabsContent>
                <TabsContent value="calendar" className="mt-6"><CalendarTab /></TabsContent>
                <TabsContent value="published" className="mt-6"><PostListTab status="published" locale="es" emptyLabel="Aún no has publicado ningún artículo." /></TabsContent>
            </Tabs>
        </div>
    );
}

// -----------------------
// Tab 1 — Nuevo
// -----------------------
function NewTab() {
    const { toast } = useToast();
    const [isPending, startTransition] = useTransition();
    const [keywords, setKeywords] = useState('');
    const [locale, setLocale] = useState<BlogLocale>('es');
    const [tone, setTone] = useState<'profesional' | 'conversacional' | 'técnico' | 'inspirador'>('profesional');
    const [competitors, setCompetitors] = useState('');
    const [targetWords, setTargetWords] = useState(900);
    const [generated, setGenerated] = useState<BlogPost | null>(null);

    const onGenerate = () => {
        const kw = keywords.split(',').map(s => s.trim()).filter(Boolean);
        if (kw.length === 0) {
            toast({ variant: 'destructive', title: 'Introduce al menos una keyword' });
            return;
        }
        const urls = competitors.split(',').map(s => s.trim()).filter(Boolean);
        startTransition(async () => {
            const result = await generateAndSaveBlogPostAction({
                keywords: kw,
                targetLocale: locale,
                tone,
                competitorUrls: urls.length > 0 ? urls : undefined,
                targetWordCount: targetWords,
            });
            if (result.success) {
                setGenerated(result.post);
                toast({ title: 'Artículo generado', description: 'Se ha guardado como borrador.' });
            } else {
                toast({ variant: 'destructive', title: 'Error', description: result.error });
            }
        });
    };

    return (
        <div className="grid gap-6 lg:grid-cols-2">
            <Card>
                <CardHeader>
                    <CardTitle>Parámetros</CardTitle>
                    <CardDescription>Define keywords, idioma y tono; la IA genera un borrador SEO.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label>Keywords (separadas por coma)</Label>
                        <Input
                            value={keywords}
                            onChange={e => setKeywords(e.target.value)}
                            placeholder="reformas en Mallorca, baños modernos"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Idioma</Label>
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
                        <div className="space-y-2">
                            <Label>Tono</Label>
                            <Select value={tone} onValueChange={(v: any) => setTone(v)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="profesional">Profesional</SelectItem>
                                    <SelectItem value="conversacional">Conversacional</SelectItem>
                                    <SelectItem value="técnico">Técnico</SelectItem>
                                    <SelectItem value="inspirador">Inspirador</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label>URLs de competencia (opcional)</Label>
                        <Textarea
                            rows={2}
                            value={competitors}
                            onChange={e => setCompetitors(e.target.value)}
                            placeholder="https://ejemplo1.com, https://ejemplo2.com"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Extensión (palabras): {targetWords}</Label>
                        <input
                            type="range"
                            min={400}
                            max={2000}
                            step={100}
                            value={targetWords}
                            onChange={e => setTargetWords(Number(e.target.value))}
                            className="w-full accent-primary"
                        />
                    </div>
                    <Button onClick={onGenerate} disabled={isPending} className="w-full">
                        {isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                        {isPending ? 'Generando…' : 'Generar artículo'}
                    </Button>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Vista previa</CardTitle>
                    <CardDescription>
                        {generated ? 'El artículo se ha guardado como borrador.' : 'Aquí aparecerá el artículo generado.'}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {generated ? (
                        <PostActions post={generated} compact />
                    ) : (
                        <p className="text-sm text-muted-foreground text-center py-12">
                            Rellena los parámetros y pulsa "Generar".
                        </p>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

// -----------------------
// Tabs 2 & 4 — Listado
// -----------------------
function PostListTab({
    status, locale, emptyLabel, showActions,
}: {
    status: 'draft' | 'published';
    locale?: BlogLocale;
    emptyLabel: string;
    showActions?: boolean;
}) {
    const [posts, setPosts] = useState<BlogPost[] | null>(null);
    const { toast } = useToast();

    const load = async () => {
        setPosts(null);
        const list = await listBlogPostsAction(status, locale);
        setPosts(list);
    };

    useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

    if (!posts) return <div className="py-12 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
    if (posts.length === 0) return <p className="text-sm text-muted-foreground text-center py-12">{emptyLabel}</p>;

    return (
        <div className="space-y-3">
            {posts.map(p => (
                <PostActions key={p.id} post={p} showActions={showActions} onChanged={load} />
            ))}
        </div>
    );
}

// -----------------------
// Tab 3 — Calendario
// -----------------------
function CalendarTab() {
    const [posts, setPosts] = useState<BlogPost[] | null>(null);
    const [selectedDay, setSelectedDay] = useState<Date | undefined>(new Date());

    const load = async () => {
        const list = await listBlogPostsAction('scheduled');
        setPosts(list);
    };
    useEffect(() => { load(); }, []);

    if (!posts) return <div className="py-12 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

    const daysWithPosts = posts
        .map(p => p.publishAt ? new Date(p.publishAt) : null)
        .filter(Boolean) as Date[];
    const sameDay = (a: Date, b: Date) =>
        a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    const postsForSelected = selectedDay
        ? posts.filter(p => p.publishAt && sameDay(new Date(p.publishAt), selectedDay))
        : [];

    return (
        <div className="grid gap-6 lg:grid-cols-2">
            <Card>
                <CardHeader>
                    <CardTitle>Calendario editorial</CardTitle>
                    <CardDescription>
                        {posts.length === 0
                            ? 'No hay posts programados.'
                            : `${posts.length} posts programados para publicación automática.`}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <DayPicker
                        mode="single"
                        selected={selectedDay}
                        onSelect={setSelectedDay}
                        modifiers={{ scheduled: daysWithPosts }}
                        modifiersClassNames={{
                            scheduled: 'bg-primary/20 font-bold text-primary rounded-full',
                        }}
                        className="mx-auto"
                    />
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>
                        {selectedDay ? selectedDay.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }) : 'Selecciona un día'}
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    {postsForSelected.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No hay publicaciones programadas para este día.</p>
                    ) : (
                        postsForSelected.map(p => <PostActions key={p.id} post={p} compact />)
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

// -----------------------
// Card reutilizable del post
// -----------------------
function PostActions({ post, showActions = true, compact = false, onChanged }: { post: BlogPost; showActions?: boolean; compact?: boolean; onChanged?: () => void }) {
    const { toast } = useToast();
    const [isPending, startTransition] = useTransition();
    const [viewOpen, setViewOpen] = useState(false);
    const [scheduleOpen, setScheduleOpen] = useState(false);
    const [scheduleDate, setScheduleDate] = useState<string>(() => {
        const d = new Date(Date.now() + 60 * 60 * 1000);
        return d.toISOString().slice(0, 16); // yyyy-mm-ddTHH:mm
    });

    const doSchedule = () => {
        const when = new Date(scheduleDate);
        if (when.getTime() <= Date.now()) {
            toast({ variant: 'destructive', title: 'La fecha debe estar en el futuro' });
            return;
        }
        startTransition(async () => {
            const r = await scheduleBlogPostAction(post.id, when);
            if (r.success) {
                toast({ title: 'Programado', description: when.toLocaleString('es-ES') });
                setScheduleOpen(false);
                onChanged?.();
            } else {
                toast({ variant: 'destructive', title: 'Error', description: r.error });
            }
        });
    };

    const doPublishNow = () => {
        startTransition(async () => {
            const r = await publishBlogPostNowAction(post.id);
            if (r.success) {
                toast({ title: 'Publicado' });
                onChanged?.();
            } else {
                toast({ variant: 'destructive', title: 'Error', description: r.error });
            }
        });
    };

    const doDelete = () => {
        if (!confirm('¿Eliminar este artículo?')) return;
        startTransition(async () => {
            const r = await deleteBlogPostAction(post.id);
            if (r.success) {
                toast({ title: 'Eliminado' });
                onChanged?.();
            } else {
                toast({ variant: 'destructive', title: 'Error', description: r.error });
            }
        });
    };

    return (
        <div className="rounded-lg border p-4 hover:border-primary/40 transition-colors">
            <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider font-semibold ${
                            post.status === 'published' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' :
                            post.status === 'scheduled' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' :
                            post.status === 'failed' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' :
                            'bg-slate-100 text-slate-700 dark:bg-white/5 dark:text-slate-300'
                        }`}>
                            {post.status}
                        </span>
                        <span className="text-[11px] text-muted-foreground">{post.locale}</span>
                        {post.seoScore !== undefined && (
                            <span className="text-[11px] text-muted-foreground">· SEO {post.seoScore}</span>
                        )}
                    </div>
                    <h3 className="font-semibold text-sm truncate">{post.title}</h3>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{post.metaDescription}</p>
                    <p className="text-[11px] text-muted-foreground mt-2">
                        {post.status === 'scheduled' && post.publishAt && <>Programado: {new Date(post.publishAt).toLocaleString('es-ES')}</>}
                        {post.status === 'published' && post.publishedAt && <>Publicado: {new Date(post.publishedAt).toLocaleString('es-ES')}</>}
                        {post.status === 'draft' && <>Actualizado: {new Date(post.updatedAt).toLocaleString('es-ES')}</>}
                        {post.status === 'failed' && post.failureReason && <>Error: {post.failureReason}</>}
                    </p>
                </div>
                {!compact && (
                    <div className="flex items-center gap-1 shrink-0">
                        <Button size="icon" variant="ghost" onClick={() => setViewOpen(true)} title="Ver">
                            <Eye className="w-4 h-4" />
                        </Button>
                        {post.status === 'published' && (
                            <a
                                href={`/es/blog/${post.slug}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center justify-center h-9 w-9 rounded-md hover:bg-muted"
                                title="Abrir"
                            >
                                <ExternalLink className="w-4 h-4" />
                            </a>
                        )}
                        {showActions && post.status === 'draft' && (
                            <>
                                <Button size="icon" variant="ghost" onClick={() => setScheduleOpen(true)} title="Programar">
                                    <Clock className="w-4 h-4" />
                                </Button>
                                <Button size="icon" variant="ghost" onClick={doPublishNow} disabled={isPending} title="Publicar ahora">
                                    <Send className="w-4 h-4" />
                                </Button>
                            </>
                        )}
                        {showActions && (
                            <Button size="icon" variant="ghost" onClick={doDelete} disabled={isPending} title="Eliminar">
                                <Trash2 className="w-4 h-4 text-red-500" />
                            </Button>
                        )}
                    </div>
                )}
            </div>

            {compact && (
                <div className="flex items-center gap-2 mt-3">
                    <Button size="sm" variant="outline" onClick={() => setViewOpen(true)}>
                        <Eye className="w-3.5 h-3.5 mr-1" /> Ver
                    </Button>
                    {post.status === 'draft' && (
                        <>
                            <Button size="sm" variant="outline" onClick={() => setScheduleOpen(true)}>
                                <Clock className="w-3.5 h-3.5 mr-1" /> Programar
                            </Button>
                            <Button size="sm" onClick={doPublishNow} disabled={isPending}>
                                <Send className="w-3.5 h-3.5 mr-1" /> Publicar
                            </Button>
                        </>
                    )}
                </div>
            )}

            <Dialog open={viewOpen} onOpenChange={setViewOpen}>
                <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{post.title}</DialogTitle>
                    </DialogHeader>
                    <div className="prose dark:prose-invert max-w-none text-sm">
                        <ReactMarkdown>{post.contentMarkdown}</ReactMarkdown>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Programar publicación</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>Fecha y hora</Label>
                            <Input
                                type="datetime-local"
                                value={scheduleDate}
                                onChange={e => setScheduleDate(e.target.value)}
                            />
                            <p className="text-xs text-muted-foreground">Se publicará automáticamente a la hora seleccionada.</p>
                        </div>
                        <div className="flex justify-end gap-2">
                            <Button variant="ghost" onClick={() => setScheduleOpen(false)}>Cancelar</Button>
                            <Button onClick={doSchedule} disabled={isPending}>
                                {isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                                Programar
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
