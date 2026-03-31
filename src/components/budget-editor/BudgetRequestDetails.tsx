import { DetailedFormValues } from '@/components/budget-request/schema';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Check, Cpu, Hammer, Search, Scale, Sparkles } from 'lucide-react';
import { BudgetTelemetry } from '@/backend/budget/domain/budget';
import { ScrollArea } from '@/components/ui/scroll-area';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

const BooleanItem = ({ label, value, detail }: { label: string, value: boolean, detail?: string }) => (
    <div className="flex justify-between py-1.5 border-b border-slate-50 dark:border-white/5 last:border-0">
        <span className="text-slate-500 dark:text-white/60">{label}</span>
        <div className="flex items-center gap-2">
            {detail && value && <span className="text-slate-700 dark:text-white/80 font-mono text-xs">{detail}</span>}
            {value ? (
                <span className="flex items-center text-green-600 dark:text-green-400 font-medium text-xs bg-green-50 dark:bg-green-500/10 px-2 py-0.5 rounded-full border border-green-100 dark:border-green-500/20">
                    <Check className="w-3 h-3 mr-1" /> Sí
                </span>
            ) : (
                <span className="text-slate-300 dark:text-white/20 font-medium text-xs">No</span>
            )}
        </div>
    </div>
);

const TextItem = ({ label, value }: { label: string, value?: string | number }) => {
    if (value === undefined || value === null) return null;
    return (
        <div className="flex justify-between py-1.5 border-b border-slate-50 dark:border-white/5 last:border-0">
            <span className="text-slate-500 dark:text-white/60">{label}</span>
            <span className="font-medium text-slate-900 dark:text-white">{value}</span>
        </div>
    );
};

const AgentIcon = ({ agent }: { agent: string }) => {
    switch (agent) {
        case 'Architect': return <Hammer className="w-4 h-4 text-amber-500" />;
        case 'Surveyor': return <Search className="w-4 h-4 text-blue-500" />;
        case 'Judge': return <Scale className="w-4 h-4 text-purple-500" />;
        default: return <Cpu className="w-4 h-4 text-slate-500" />;
    }
}

const parseTimestamp = (ts: any) => {
    if (!ts) return new Date();
    if (typeof ts === 'string' || typeof ts === 'number') return new Date(ts);
    if (ts instanceof Date) return ts;
    if (typeof ts._seconds === 'number') return new Date(ts._seconds * 1000);
    if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000);
    return new Date();
};

export const BudgetRequestDetails = ({ data, telemetry }: { data: DetailedFormValues, telemetry?: BudgetTelemetry }) => {
    if (!data) return <div className="p-4 text-sm text-muted-foreground">No hay detalles disponibles.</div>;

    const hasTelemetry = telemetry && telemetry.blueprint && telemetry.blueprint.decomposedTasks;

    return (
        <div className="flex flex-col xl:flex-row gap-6">
            <Card className="border-0 shadow-none bg-transparent flex-1">
                {/* Removed redundant header since wrapper already has title */}

                <CardContent className="px-0 space-y-6">

                    {/* Contact Info Card */}
                    <div className="bg-white dark:bg-white/5 p-5 rounded-xl border border-slate-200 dark:border-white/10 shadow-sm">
                        <h4 className="text-xs font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-4 border-b border-slate-100 dark:border-white/10 pb-2">Cliente y Proyecto</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
                            <div className="space-y-1">
                                <div className="font-semibold text-base text-slate-900 dark:text-white">{data.name}</div>
                                <div className="text-slate-500 dark:text-white/60">{data.email}</div>
                                <div className="text-slate-500 dark:text-white/60">{data.phone}</div>
                            </div>
                            <div className="text-right space-y-1">
                                <div className="font-medium text-slate-900 dark:text-white">{data.address}</div>
                                <div className="text-slate-500 dark:text-white/60 capitalize">
                                    {data.propertyType === 'residential' ? 'Vivienda' : data.propertyType === 'commercial' ? 'Local Comercial' : 'Oficina'}
                                    {data.projectScope === 'integral' ? ' • Reforma Integral' : ' • Reforma Parcial'}
                                </div>
                                <div className="font-mono text-slate-600 dark:text-white/80 bg-slate-100 dark:bg-white/10 px-2 py-0.5 rounded inline-block mt-1">
                                    {data.totalAreaM2} m²
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                        {/* Column 1 */}
                        <div className="space-y-6">

                            {/* Estancias */}
                            <div className="bg-white dark:bg-white/5 p-5 rounded-xl border border-slate-200 dark:border-white/10 shadow-sm space-y-3">
                                <h4 className="text-xs font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-2">Distribución</h4>
                                <div className="space-y-1 text-sm">
                                    <TextItem label="Habitaciones" value={data.numberOfRooms} />
                                    <TextItem label="Baños" value={data.numberOfBathrooms} />
                                    <TextItem label="Puestos de Trabajo" value={data.workstations} />
                                    <TextItem label="Salas de Reuniones" value={data.meetingRooms} />
                                </div>
                            </div>

                            {/* Demoliciones */}
                            <div className="bg-white dark:bg-white/5 p-5 rounded-xl border border-slate-200 dark:border-white/10 shadow-sm space-y-3">
                                <h4 className="text-xs font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-2">Demoliciones Previas</h4>
                                <div className="space-y-1 text-sm">
                                    <BooleanItem label="Demolición Tabiquería" value={data.demolishPartitions} detail={`${data.demolishPartitionsM2} m² (${data.wallThickness === 'thick' ? 'Grueso' : 'Fino'})`} />
                                    <BooleanItem label="Levantado de Suelos" value={!!data.demolishFloorsM2} detail={`${data.demolishFloorsM2} m²`} />
                                    <BooleanItem label="Picado de Alicatados" value={!!data.demolishWallTilesM2} detail={`${data.demolishWallTilesM2} m²`} />
                                    <BooleanItem label="Retirada Puertas Existentes" value={data.removeDoors} detail={`${data.removeDoorsAmount} uds`} />
                                    <BooleanItem label="Retirada Gotelé" value={data.removeGotele} detail={`${data.removeGoteleM2} m²`} />
                                    <Separator className="my-2 dark:bg-white/10" />
                                    <BooleanItem label="Retirada Mobiliario" value={data.furnitureRemoval} />
                                    <BooleanItem label="Edificio con Ascensor" value={data.hasElevator} />
                                </div>
                            </div>

                            {/* Albañilería y Falsos Techos */}
                            <div className="bg-white dark:bg-white/5 p-5 rounded-xl border border-slate-200 dark:border-white/10 shadow-sm space-y-3">
                                <h4 className="text-xs font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-2">Albañilería y Techos</h4>
                                <div className="space-y-1 text-sm">
                                    <BooleanItem label="Falso Techo" value={data.installFalseCeiling} detail={`${data.falseCeilingM2} m²`} />
                                    <BooleanItem label="Insonorización" value={data.soundproofRoom} detail={`${data.soundproofRoomM2} m²`} />
                                </div>
                            </div>

                        </div>

                        {/* Column 2 */}
                        <div className="space-y-6">

                            {/* Carpintería */}
                            <div className="bg-white dark:bg-white/5 p-5 rounded-xl border border-slate-200 dark:border-white/10 shadow-sm space-y-3">
                                <h4 className="text-xs font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-2">Carpintería</h4>
                                <div className="space-y-1 text-sm">
                                    <BooleanItem label="Puertas Interiores" value={data.renovateInteriorDoors} detail={`${data.interiorDoorsAmount} uds (${data.doorsMaterial})`} />
                                    <BooleanItem label="Puertas Correderas" value={data.installSlidingDoor} detail={`${data.slidingDoorAmount} uds`} />
                                    <BooleanItem label="Ventanas Exteriores" value={data.renovateExteriorCarpentry} detail={`${data.externalWindowsCount} uds`} />
                                </div>
                            </div>

                            {/* Instalaciones */}
                            <div className="bg-white dark:bg-white/5 p-5 rounded-xl border border-slate-200 dark:border-white/10 shadow-sm space-y-3">
                                <h4 className="text-xs font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-2">Instalaciones</h4>
                                <div className="space-y-1 text-sm">
                                    <TextItem label="Alcance Eléctrico" value={data.elecScope === 'total' ? 'Instalación Completa' : data.elecScope === 'partial' ? 'Solo Mecanismos' : 'No solicitada'} />
                                    <TextItem label="Alcance Fontanería" value={data.plumbingScope === 'total' ? 'Completa (Baños/Cocina)' : data.plumbingScope === 'partial' ? 'Parcial' : 'No solicitada'} />
                                    <BooleanItem label="Cuadro Eléctrico Nuevo" value={data.renovateElectricalPanel} />
                                    <BooleanItem label="Aire Acondicionado" value={data.installAirConditioning} detail={`${data.hvacCount} equipos (${data.hvacType === 'ducts' ? 'Conductos' : 'Split'})`} />
                                </div>
                            </div>

                            {/* Acabados */}
                            <div className="bg-white dark:bg-white/5 p-5 rounded-xl border border-slate-200 dark:border-white/10 shadow-sm space-y-3">
                                <h4 className="text-xs font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-2">Acabados</h4>
                                <div className="space-y-1 text-sm">
                                    <TextItem label="Tipo de Suelo" value={data.floorType && (data.floorType === 'parquet' ? 'Parquet / Laminado' : data.floorType === 'tile' ? 'Cerámico / Gres' : data.floorType === 'microcement' ? 'Microcemento' : 'Otro')} />
                                    <TextItem label="Rodapie" value={data.skirtingBoardLinearMeters ? `${data.skirtingBoardLinearMeters} ml` : undefined} />
                                    <BooleanItem label="Pintura Paredes" value={data.paintWalls} detail={`${data.paintWallsM2} m²`} />
                                    <BooleanItem label="Pintura Techos" value={data.paintCeilings} detail={`${data.paintCeilingsM2} m²`} />
                                    <TextItem label="Tipo Pintura" value={data.paintType === 'color' ? 'Color' : data.paintType === 'white' ? 'Blanco' : undefined} />
                                </div>
                            </div>
                        </div>

                    </div>

                    {/* Cocina Específica */}
                    {data.kitchen?.renovate && (
                        <div className="bg-white dark:bg-white/5 p-5 rounded-xl border border-l-4 border-slate-200 dark:border-white/10 border-l-amber-400 shadow-sm space-y-3">
                            <div className="flex justify-between items-center mb-2">
                                <h4 className="text-xs font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">Reforma de Cocina</h4>
                                <span className="text-xs font-bold bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded uppercase">{data.kitchen.quality || 'Estándar'}</span>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                                <BooleanItem label="Demolición" value={data.kitchen.demolition} />
                                <BooleanItem label="Fontanería" value={data.kitchen.plumbing} />
                                <TextItem label="Alicatado Paredes" value={`${data.kitchen.wallTilesM2 || 0} m²`} />
                                <TextItem label="Suelo" value={`${data.kitchen.floorM2 || 0} m²`} />
                            </div>
                        </div>
                    )}

                    {/* Archivos Adjuntos (Placeholder logic if added in future) */}
                    {data.files && data.files.length > 0 && (
                        <div className="bg-slate-50 dark:bg-white/5 p-4 rounded-lg border border-slate-100 dark:border-white/10 text-sm">
                            <span className="text-xs font-bold text-slate-500 dark:text-white/50 uppercase tracking-wider block mb-2">Archivos Adjuntos</span>
                            <div className="flex gap-2">
                                {data.files.map((file, i) => (
                                    <a key={i} href={file} target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline text-xs truncate max-w-[200px] block">
                                        Archivo {i + 1}
                                    </a>
                                ))}
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Telemetry Panel */}
            {hasTelemetry && (
                <div className="w-full xl:w-[450px] space-y-6 flex flex-col">
                    <div className="bg-gradient-to-br from-indigo-50/50 to-purple-50/50 dark:from-indigo-950/20 dark:to-purple-950/20 rounded-2xl border border-indigo-100 dark:border-indigo-900/50 overflow-hidden flex-1 shadow-sm h-full max-h-[1000px] flex flex-col">
                        <div className="p-5 border-b border-indigo-100 dark:border-indigo-900/50 bg-white/50 dark:bg-white/5 backdrop-blur-sm">
                            <h3 className="font-bold flex items-center gap-2 text-indigo-900 dark:text-indigo-300">
                                <Sparkles className="w-4 h-4 text-purple-500" />
                                Traza Cognitiva IA
                            </h3>
                            <p className="text-sm text-indigo-600/70 dark:text-indigo-400/70 mt-1">
                                Blueprint del Arquitecto y Decisiones
                            </p>
                        </div>

                        <ScrollArea className="flex-1 p-5">
                            <div className="space-y-8">

                                {/* Metrics Section */}
                                {telemetry.metrics && (
                                    <div className="space-y-4">
                                        <h4 className="text-xs font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-4 border-b border-slate-100 dark:border-white/10 pb-2">Rendimiento y Coste IA</h4>
                                        <div className="grid grid-cols-3 gap-2">
                                            <div className="bg-white/50 dark:bg-black/20 p-3 rounded-xl border border-indigo-100 dark:border-indigo-900/30 flex flex-col items-center justify-center text-center shadow-sm">
                                                <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-bold mb-1">Tiempo</span>
                                                <span className="text-sm font-mono font-bold text-indigo-700 dark:text-indigo-400">
                                                    {(telemetry.metrics.generationTimeMs / 1000).toFixed(1)}s
                                                </span>
                                            </div>
                                            <div className="bg-white/50 dark:bg-black/20 p-3 rounded-xl border border-indigo-100 dark:border-indigo-900/30 flex flex-col items-center justify-center text-center shadow-sm">
                                                <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-bold mb-1">Tokens</span>
                                                <span className="text-sm font-mono font-bold text-indigo-700 dark:text-indigo-400">
                                                    {(telemetry.metrics.tokens.totalTokens / 1000).toFixed(1)}k
                                                </span>
                                            </div>
                                            <div className="bg-white/50 dark:bg-black/20 p-3 rounded-xl border border-indigo-100 dark:border-indigo-900/30 flex flex-col items-center justify-center text-center shadow-sm">
                                                <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-bold mb-1">Coste API</span>
                                                <span className="text-sm font-mono font-bold text-indigo-700 dark:text-indigo-400">
                                                    {telemetry.metrics.costs.fiatAmount}€
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Blueprint Section */}
                                <div className="space-y-4">
                                    <h4 className="text-xs font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-4 border-b border-slate-100 dark:border-white/10 pb-2">Plan Descompuesto</h4>
                                    <div className="space-y-4 pl-2 border-l-2 border-indigo-100 dark:border-indigo-900/50">
                                        {telemetry.blueprint!.decomposedTasks.map((task, i) => (
                                            <div key={i} className="relative pl-6">
                                                <div className="absolute w-3 h-3 bg-amber-100 border-2 border-amber-400 rounded-full -left-[1.35rem] top-1"></div>
                                                <p className="font-semibold text-sm text-slate-800 dark:text-slate-200">{task.task}</p>
                                                <p className="text-xs text-slate-500 mt-1"><span className="font-mono bg-slate-100 dark:bg-slate-800 px-1 rounded">{task.chapter}</span> • {task.estimatedParametricQuantity} {task.estimatedParametricUnit}</p>
                                                {task.reasoning && (
                                                    <div className="mt-2 bg-white/60 dark:bg-black/20 p-2 rounded-md text-[11px] text-slate-600 dark:text-slate-400 italic font-serif">
                                                        " {task.reasoning} "
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Execution Log */}
                                <div className="space-y-4">
                                    <h4 className="text-xs font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-4 border-b border-slate-100 dark:border-white/10 pb-2">Log de Ejecución</h4>
                                    <div className="space-y-3 pl-2 border-l-2 border-indigo-100 dark:border-indigo-900/50">
                                        {telemetry.executionLog?.map((log, i) => (
                                            <div key={i} className="relative pl-6">
                                                <div className="absolute w-6 h-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm rounded-full -left-[1.8rem] top-0 flex items-center justify-center">
                                                    <AgentIcon agent={log.agent} />
                                                </div>
                                                <div className="flex justify-between items-start">
                                                    <p className="text-xs font-bold text-slate-700 dark:text-slate-300">{log.agent}</p>
                                                    <span className="text-[10px] text-slate-400 tabular-nums">
                                                        {format(parseTimestamp(log.timestamp), 'HH:mm:ss.SSS')}
                                                    </span>
                                                </div>
                                                <p className="text-[11px] text-indigo-600 dark:text-indigo-400 font-medium mt-0.5">{log.action}</p>
                                                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                                                    {log.details}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </ScrollArea>
                    </div>
                </div>
            )}
        </div>
    )
}
