import { FirestoreAiTrainingRepository } from '@/backend/ai-training/infrastructure/firestore-ai-training-repository';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { Link } from '@/i18n/navigation';
import { Bot, ChevronRight, CheckCircle2, Edit3, XCircle } from 'lucide-react';

export default async function AiTracesPage() {
    const aiTrainingRepo = new FirestoreAiTrainingRepository();
    // In a real app we would paginate, but for now we list the latest
    const tracesEntities = await aiTrainingRepo.findAll();

    const getResolutionBadge = (resolution: string) => {
        switch (resolution) {
            case 'accepted_as_is':
                return <Badge variant="secondary" className="bg-green-500/10 text-green-500 hover:bg-green-500/20"><CheckCircle2 className="w-3 h-3 mr-1" /> Aceptado directo</Badge>;
            case 'human_edited':
                return <Badge variant="secondary" className="bg-amber-500/10 text-amber-500 hover:bg-amber-500/20"><Edit3 className="w-3 h-3 mr-1" /> Editado</Badge>;
            case 'rejected':
            default:
                return <Badge variant="secondary" className="bg-red-500/10 text-red-500 hover:bg-red-500/20"><XCircle className="w-3 h-3 mr-1" /> Sin guardar</Badge>;
        }
    };

    return (
        <div className="flex-1 space-y-6 max-w-6xl mx-auto p-4 md:p-8">
            <div className="flex flex-col gap-2 mb-8">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-primary/10 rounded-lg">
                        <Bot className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-display font-bold tracking-tight">Trazas IA (RLHF)</h1>
                        <p className="text-muted-foreground">Monitorización de presupuestos generados por los agentes y ediciones humanas.</p>
                    </div>
                </div>
            </div>

            <div className="grid gap-4">
                {tracesEntities.map((entity) => {
                    const trace = entity.toMap();
                    return (
                        <Link key={trace.id} href={`/dashboard/admin/traces/${trace.id}` as any}>
                            <Card className="hover:bg-muted/50 transition-colors border-white/5 bg-[#121212]/50 backdrop-blur-xl">
                                <CardContent className="p-4 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-3">
                                            <h3 className="font-semibold text-lg line-clamp-1">{trace.originalPrompt || 'Sin prompt'}</h3>
                                            {getResolutionBadge(trace.resolution)}
                                        </div>
                                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                            <span>Trace ID: <code className="text-xs bg-white/5 px-1 py-0.5 rounded">{trace.id.substring(0, 8)}...</code></span>
                                            {/* toMap returns a Date or string depending on parsing, handle natively */}
                                            <span>Hace {formatDistanceToNow(new Date(trace.createdAt), { addSuffix: true, locale: es })}</span>
                                            <span>Lead: <code className="text-xs bg-white/5 px-1 py-0.5 rounded">{trace.leadId.substring(0, 8)}</code></span>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-6 text-sm">
                                        <div className="text-right hidden sm:block">
                                            <p className="font-medium">{trace.metrics?.baselineTokens || 0} tokens</p>
                                            <p className="text-muted-foreground">{trace.metrics?.baselineTimeMs ? (trace.metrics.baselineTimeMs / 1000).toFixed(1) + 's' : '-'}</p>
                                        </div>
                                        <ChevronRight className="w-5 h-5 text-muted-foreground" />
                                    </div>
                                </CardContent>
                            </Card>
                        </Link>
                    )
                })}

                {tracesEntities.length === 0 && (
                    <div className="text-center py-12 text-muted-foreground">
                        No hay trazas registradas todavía.
                    </div>
                )}
            </div>
        </div>
    );
}
