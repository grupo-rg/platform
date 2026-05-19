'use client';

/**
 * Vista mes del calendario editorial. Reemplaza el `DayPicker` previo por
 * una grilla 7 × N con casillas que muestran los posts del día y permiten:
 *
 *  - Arrastrar un post de un día a otro para reprogramar (HTML5 DnD nativo,
 *    sin dependencia extra).
 *  - Ver de un vistazo: scheduled (azul), published (verde), failed (rojo).
 *  - Detectar "huecos" en próximos 4 semanas y sugerir generar un post ahí
 *    (chip ghost clickable que abre el formulario de Nuevo).
 *  - Reintentar un post failed sin salir de la vista.
 */

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    listBlogPostsAction,
    rescheduleBlogPostAction,
    retryFailedBlogPostAction,
} from '@/actions/marketing/blog-post.action';
import type { BlogPost } from '@/backend/marketing/domain/blog-post';
import { ChevronLeft, ChevronRight, AlertTriangle, RotateCw, Plus, Loader2 } from 'lucide-react';

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const STATUS_COLOR: Record<string, string> = {
    scheduled: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800',
    published: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
    failed: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800',
    draft: 'bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800/40 dark:text-zinc-300 dark:border-zinc-700',
};

interface EditorialCalendarProps {
    /** Callback opcional cuando el usuario pulsa el "+" de un día para
     * generar un post nuevo con esa fecha pre-cargada. */
    onGenerateForDate?: (date: Date) => void;
}

export function EditorialCalendar({ onGenerateForDate }: EditorialCalendarProps) {
    const [posts, setPosts] = useState<BlogPost[] | null>(null);
    const [cursor, setCursor] = useState(() => firstOfMonth(new Date()));
    const [isPending, startTransition] = useTransition();
    const { toast } = useToast();

    const load = async () => {
        // Para visualizar el calendario completo necesitamos scheduled +
        // published + failed (todos los que tienen fecha). Los drafts solos
        // no se pintan en el calendario (no tienen fecha).
        const [scheduled, published, failed] = await Promise.all([
            listBlogPostsAction('scheduled'),
            // 'published' requiere locale para ser específico — usamos 'es'
            // por ahora (sería ideal que la UI dejase elegir locale, pero
            // para v1 priorizamos el caso mayoritario).
            listBlogPostsAction('published', 'es'),
            listBlogPostsAction('failed'),
        ]);
        setPosts([...scheduled, ...published, ...failed]);
    };

    useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

    const calendarCells = useMemo(() => buildCalendarCells(cursor), [cursor]);
    const postsByDay = useMemo(() => groupByDay(posts || []), [posts]);

    // "Huecos" — celdas en próximos 28 días sin posts. Solo sugerimos en días
    // laborables (lun-vie) para no saturar la UI con fines de semana.
    const today = startOfDay(new Date());
    const horizonEnd = new Date(today.getTime() + 28 * 24 * 60 * 60 * 1000);

    const handleDropOnDay = (postId: string, day: Date) => {
        const draggedPost = (posts || []).find(p => p.id === postId);
        if (!draggedPost) return;
        // Reprogramamos a las 10:00 del día destino por defecto. Si la hora
        // anterior estaba seteada, conservamos hh:mm.
        const original = draggedPost.publishAt ? new Date(draggedPost.publishAt) : null;
        const next = new Date(day);
        if (original) {
            next.setHours(original.getHours(), original.getMinutes(), 0, 0);
        } else {
            next.setHours(10, 0, 0, 0);
        }
        if (next.getTime() <= Date.now()) {
            toast({ title: 'No se puede reprogramar al pasado', variant: 'destructive' });
            return;
        }

        startTransition(async () => {
            const res = await rescheduleBlogPostAction(postId, next);
            if (res.success) {
                toast({ title: 'Post reprogramado', description: next.toLocaleString() });
                await load();
            } else {
                toast({ title: 'Error al reprogramar', description: res.error, variant: 'destructive' });
            }
        });
    };

    const handleRetry = (postId: string) => {
        startTransition(async () => {
            const res = await retryFailedBlogPostAction(postId);
            if (res.success) {
                toast({ title: 'Post movido a Borradores', description: 'Vuelve a programarlo cuando quieras.' });
                await load();
            } else {
                toast({ title: 'Error al reintentar', description: res.error, variant: 'destructive' });
            }
        });
    };

    if (!posts) {
        return (
            <div className="py-12 flex justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                <div>
                    <CardTitle className="text-lg capitalize">
                        {cursor.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}
                    </CardTitle>
                    {isPending && <span className="text-xs text-muted-foreground">Guardando...</span>}
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCursor(prevMonth(cursor))}>
                        <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setCursor(firstOfMonth(new Date()))}>
                        Hoy
                    </Button>
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCursor(nextMonth(cursor))}>
                        <ChevronRight className="w-4 h-4" />
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-7 gap-1 mb-1">
                    {WEEKDAYS.map(d => (
                        <div key={d} className="text-xs font-semibold text-muted-foreground text-center py-1">{d}</div>
                    ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                    {calendarCells.map((cell, idx) => {
                        const dayKey = keyOf(cell.date);
                        const dayPosts = postsByDay.get(dayKey) || [];
                        const isToday = sameDay(cell.date, today);
                        const isPast = cell.date < today;
                        const isInHorizon = cell.inMonth && cell.date >= today && cell.date <= horizonEnd;
                        const isWeekday = cell.date.getDay() >= 1 && cell.date.getDay() <= 5;
                        const showGapHint = isInHorizon && isWeekday && dayPosts.length === 0;

                        return (
                            <DayCell
                                key={idx}
                                date={cell.date}
                                inMonth={cell.inMonth}
                                isToday={isToday}
                                isPast={isPast}
                                posts={dayPosts}
                                onDropPost={handleDropOnDay}
                                onRetry={handleRetry}
                                showGapHint={showGapHint}
                                onGenerate={onGenerateForDate}
                            />
                        );
                    })}
                </div>

                {/* Leyenda */}
                <div className="flex flex-wrap items-center gap-3 mt-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                        <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500" />
                        Programado
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500" />
                        Publicado
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" />
                        Fallido
                    </span>
                    <span className="text-muted-foreground/60">·</span>
                    <span>Arrastra un post a otro día para reprogramar.</span>
                </div>
            </CardContent>
        </Card>
    );
}

// ─────────────────────────────────────────────────────────────────
// Celda de día
// ─────────────────────────────────────────────────────────────────

function DayCell({
    date, inMonth, isToday, isPast, posts, showGapHint,
    onDropPost, onRetry, onGenerate,
}: {
    date: Date;
    inMonth: boolean;
    isToday: boolean;
    isPast: boolean;
    posts: BlogPost[];
    showGapHint: boolean;
    onDropPost: (postId: string, day: Date) => void;
    onRetry: (postId: string) => void;
    onGenerate?: (date: Date) => void;
}) {
    const [isOver, setIsOver] = useState(false);

    return (
        <div
            onDragOver={(e) => {
                if (isPast) return;
                e.preventDefault();
                setIsOver(true);
            }}
            onDragLeave={() => setIsOver(false)}
            onDrop={(e) => {
                e.preventDefault();
                setIsOver(false);
                const postId = e.dataTransfer.getData('text/plain');
                if (postId) onDropPost(postId, date);
            }}
            className={[
                'min-h-[88px] rounded-md border p-1.5 transition-all',
                inMonth ? 'bg-background' : 'bg-zinc-50/50 dark:bg-zinc-900/30 opacity-60',
                isToday ? 'ring-2 ring-primary/40' : 'border-zinc-200 dark:border-zinc-800',
                isOver ? 'ring-2 ring-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/20' : '',
                isPast ? 'opacity-60' : '',
            ].join(' ')}
        >
            <div className="flex items-center justify-between mb-1">
                <span className={`text-[11px] font-semibold ${isToday ? 'text-primary' : 'text-muted-foreground'}`}>
                    {date.getDate()}
                </span>
                {posts.length === 0 && showGapHint && onGenerate && (
                    <button
                        type="button"
                        onClick={() => onGenerate(date)}
                        className="text-muted-foreground/50 hover:text-primary transition-colors"
                        title="Generar post para este día"
                    >
                        <Plus className="w-3 h-3" />
                    </button>
                )}
            </div>

            <div className="space-y-1">
                {posts.slice(0, 3).map(p => (
                    <PostChip key={p.id} post={p} onRetry={onRetry} />
                ))}
                {posts.length > 3 && (
                    <div className="text-[10px] text-muted-foreground pl-1">
                        + {posts.length - 3} más
                    </div>
                )}
            </div>
        </div>
    );
}

function PostChip({
    post, onRetry,
}: {
    post: BlogPost;
    onRetry: (postId: string) => void;
}) {
    const isDraggable = post.status === 'scheduled';
    const colorClass = STATUS_COLOR[post.status] || STATUS_COLOR.draft;
    return (
        <div
            draggable={isDraggable}
            onDragStart={(e) => e.dataTransfer.setData('text/plain', post.id)}
            className={`text-[10px] truncate rounded px-1.5 py-0.5 border ${colorClass} ${isDraggable ? 'cursor-move' : 'cursor-default'} group/chip relative`}
            title={post.title}
        >
            <span className="truncate block">{post.title}</span>
            {post.status === 'failed' && (
                <button
                    type="button"
                    onClick={() => onRetry(post.id)}
                    className="absolute right-0 top-1/2 -translate-y-1/2 -mr-1 bg-background rounded-full p-0.5 opacity-0 group-hover/chip:opacity-100 transition-opacity"
                    title={post.failureReason || 'Reintentar'}
                >
                    <RotateCw className="w-2.5 h-2.5 text-red-600" />
                </button>
            )}
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────
// Helpers fecha (sin dependencias)
// ─────────────────────────────────────────────────────────────────

function firstOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function prevMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth() - 1, 1); }
function nextMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth() + 1, 1); }
function startOfDay(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function sameDay(a: Date, b: Date) { return a.toDateString() === b.toDateString(); }
function keyOf(d: Date) { return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }

function buildCalendarCells(monthCursor: Date) {
    // Lun = 0, Dom = 6 (locale ES). JS getDay() devuelve Dom=0...Sáb=6, así
    // que rotamos.
    const first = firstOfMonth(monthCursor);
    const jsDow = first.getDay(); // 0=Dom, 1=Lun, ..., 6=Sáb
    const monStart = jsDow === 0 ? 6 : jsDow - 1; // celdas vacías antes
    const cells: { date: Date; inMonth: boolean }[] = [];
    // 6 filas × 7 cols = 42 celdas siempre (cálculo simple).
    for (let i = 0; i < 42; i++) {
        const offset = i - monStart;
        const date = new Date(first.getFullYear(), first.getMonth(), 1 + offset);
        cells.push({ date, inMonth: date.getMonth() === first.getMonth() });
    }
    return cells;
}

function groupByDay(posts: BlogPost[]): Map<string, BlogPost[]> {
    const m = new Map<string, BlogPost[]>();
    for (const p of posts) {
        const d = p.publishAt ?? p.publishedAt;
        if (!d) continue;
        const date = new Date(d);
        const key = keyOf(date);
        const arr = m.get(key) || [];
        arr.push(p);
        m.set(key, arr);
    }
    return m;
}
