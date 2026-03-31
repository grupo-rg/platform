import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Home, Layers, Ruler, Wallet, Clock,
    CheckCircle2, CircleDashed, Sparkles, AlertCircle, ChevronRight
} from 'lucide-react';
import { BudgetRequirement } from '@/backend/budget/domain/budget-requirements';
import { cn } from '@/lib/utils';

interface RequirementCardProps {
    requirements: Partial<BudgetRequirement>;
    className?: string;
}

// COAATMCA simplified chapter structure for visualization (Enriched with conversational synonyms)
const STANDARD_CHAPTERS = [
    { id: '01', name: 'DEMOLICIONES', keys: ['demoliciones', 'desescombro', 'tirar', 'levantar', 'retirar', 'demoler'] },
    { id: '02', name: 'MOVIMIENTO DE TIERRAS', keys: ['tierras', 'excavación', 'zanjas', 'pozos', 'roca', 'terreno', 'acceso', 'desmonte'] },
    { id: '03', name: 'HORMIGONES', keys: ['hormigón', 'cimentación', 'muro contención', 'solera', 'zapata', 'losa'] },
    { id: '04', name: 'FORJADOS', keys: ['forjado', 'vigueta', 'bovedilla', 'losa', 'estructura horizontal'] },
    { id: '05', name: 'ESTRUCTURAS METALICAS', keys: ['acero', 'metálica', 'perfiles', 'vigas', 'pilar'] },
    { id: '06', name: 'CUBIERTAS', keys: ['cubierta', 'tejado', 'azotea', 'impermeabilización', 'teja'] },
    { id: '07', name: 'FABRICAS Y TABIQUES', keys: ['tabique', 'ladrillo', 'pladur', 'bloque', 'cerramiento', 'fachada', 'muro'] },
    { id: '08', name: 'RED DE SANEAMIENTO', keys: ['saneamiento', 'desagüe', 'arquetas', 'bajantes', 'fosa'] },
    { id: '09', name: 'REVOCOS Y ENLUCIDOS', keys: ['enfoscado', 'yeso', 'lucido', 'guarnecido', 'mortero'] },
    { id: '10', name: 'SOLADOS Y ALICATADOS', keys: ['suelo', 'pavimento', 'alicatado', 'azulejo', 'tarima', 'parquet', 'microcemento'] },
    { id: '11', name: 'CARPINTERIA DE MADERA', keys: ['puerta', 'armario', 'madera', 'rodapié', 'mueble'] },
    { id: '12', name: 'CERRAJERIA', keys: ['aluminio', 'pvc', 'ventana', 'reja', 'vidrio', 'cristal'] },
    { id: '13', name: 'FONTANERIA Y GAS', keys: ['fontanería', 'agua', 'tubería', 'sanitario', 'grifo', 'gas', 'calentador'] },
    { id: '14', name: 'ELECTRICIDAD Y TELECOM', keys: ['electricidad', 'cable', 'enchufe', 'cuadro', 'iluminación', 'foco', 'telecomunicaciones'] },
    { id: '15', name: 'CLIMATIZACION E AISLAMIENTO', keys: ['aire', 'calefacción', 'radiador', 'suelo radiante', 'aerotermia', 'aislamiento', 'sate', 'clima', 'térmico'] },
    { id: '16', name: 'PINTURA', keys: ['pintura', 'esmalte', 'plástica', 'decoración', 'pintar'] },
    { id: '17', name: 'ACABADOS Y OTROS', keys: ['lujo', 'premium', 'calidad', 'acabado', 'detalle', 'piscina', 'exterior'] },
];

export function RequirementCard({ requirements, className }: RequirementCardProps) {
    const hasData = Object.keys(requirements).length > 0;

    // Map detected needs to standard chapters
    const mappedChapters = useMemo(() => {
        const needs = requirements.detectedNeeds || [];

        return STANDARD_CHAPTERS.map(chapter => {
            const matchedNeeds = needs.filter(need =>
                chapter.keys.some(key =>
                    need.category.toLowerCase().includes(key) ||
                    need.description.toLowerCase().includes(key)
                )
            );
            return {
                ...chapter,
                matchedNeeds,
                isActive: matchedNeeds.length > 0
            };
        });
    }, [requirements.detectedNeeds]);

    const activeChaptersCount = mappedChapters.filter(c => c.isActive).length;

    if (!hasData) {
        return (
            <div className={cn("relative overflow-hidden rounded-2xl border border-white/5 bg-zinc-950 p-8 text-center", className)}>
                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent pointer-events-none" />
                <div className="absolute top-0 right-0 p-4 opacity-10">
                    <Layers className="w-24 h-24" />
                </div>
                <div className="relative z-10 flex flex-col items-center justify-center space-y-4">
                    <div className="p-3 rounded-full bg-white/5 border border-white/10">
                        <Sparkles className="w-6 h-6 text-primary animate-pulse" />
                    </div>
                    <div>
                        <h4 className="text-white font-medium mb-1">Visión Rayos-X</h4>
                        <p className="text-xs text-white/40 max-w-[200px] mx-auto leading-relaxed">
                            Describe el proyecto en el chat. La IA estructurará la obra en tiempo real.
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={cn("flex flex-col h-full bg-zinc-950 rounded-2xl border border-white/10 overflow-hidden relative shadow-2xl", className)}>
            {/* Ambient Background */}
            <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent pointer-events-none" />

            {/* Header: Core Specs (Minimalist Technical Look) */}
            <div className="relative z-10 p-5 border-b border-white/5 bg-white/5 backdrop-blur-xl">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xs font-mono text-white/50 uppercase tracking-widest flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                        Variables del Entorno
                    </h3>
                    {requirements.specs?.qualityLevel && (
                        <span className="text-[10px] hidden md:inline-flex font-mono font-bold text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/20 uppercase">
                            Calidad {requirements.specs.qualityLevel}
                        </span>
                    )}
                </div>

                <div className="grid grid-cols-4 gap-2">
                    <SpecChip icon={Home} label="Tipología" value={requirements.specs?.propertyType} />
                    <SpecChip icon={Layers} label="Intervención" value={requirements.specs?.interventionType} />
                    <SpecChip icon={Ruler} label="Superficie" value={requirements.specs?.totalArea ? `${requirements.specs.totalArea}m²` : undefined} />
                    <SpecChip icon={Wallet} label="Target" value={requirements.targetBudget} />
                </div>
            </div>

            {/* Tree View: Live Context Mapping */}
            <div className="relative z-10 p-5 overflow-hidden">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-[11px] font-medium text-white/60 uppercase tracking-widest flex items-center gap-2">
                        <Layers className="w-3.5 h-3.5" />
                        Mapa Estructural COAATMCA
                    </h3>
                    <span className="text-[10px] font-mono text-white/40">
                        {activeChaptersCount > 0 ? `${activeChaptersCount} CAPÍTULOS ACTIVOS` : 'ESPERANDO CONTEXTO'}
                    </span>
                </div>

                <div className="space-y-1.5 relative before:absolute before:inset-y-0 before:left-[11px] before:w-px before:bg-white/5">
                    {mappedChapters.map((chapter) => (
                        <ChapterNode key={chapter.id} chapter={chapter} />
                    ))}
                </div>
            </div>

            {/* Proactive Feedback Bar */}
            <div className="relative z-10 p-4 border-t border-white/5">
                <div className="flex items-start gap-3 p-3 rounded-xl bg-orange-500/5 border border-orange-500/10">
                    <AlertCircle className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-orange-200/80 leading-relaxed font-medium">
                        {activeChaptersCount < 3
                            ? "El proyecto carece de definición. Menciona estancias específicas o acabados para mayor precisión."
                            : "Estructura base detectada. Puedes afinar materiales pidiendo marcas o calidades concretas en el chat."}
                    </p>
                </div>
            </div>
        </div>
    );
}

function SpecChip({ icon: Icon, label, value }: { icon: any, label: string, value?: string | number }) {
    if (!value) return null;
    return (
        <div className="flex flex-col gap-1 p-2 rounded-lg bg-black/40 border border-white/5">
            <span className="text-[9px] text-white/40 uppercase tracking-wider font-mono flex items-center gap-1.5">
                <Icon className="w-3 h-3" />
                {label}
            </span>
            <span className="text-xs font-medium text-white/90 truncate capitalize">
                {value}
            </span>
        </div>
    );
}

function ChapterNode({ chapter }: { chapter: any }) {
    const isActive = chapter.isActive;

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
                "relative pl-6 py-2 transition-all duration-500 group",
                isActive ? "opacity-100" : "opacity-40 grayscale"
            )}
        >
            {/* Timeline dot */}
            <div className={cn(
                "absolute left-[8px] top-[14px] w-1.5 h-1.5 rounded-full transform -translate-x-1/2 transition-colors duration-500 ring-2 ring-zinc-950",
                isActive ? "bg-primary shadow-[0_0_10px_rgba(var(--primary),0.5)]" : "bg-white/20"
            )} />

            <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-white/30 w-4">{chapter.id}.</span>
                <span className={cn(
                    "text-sm font-medium transition-colors",
                    isActive ? "text-white" : "text-white/40"
                )}>
                    {chapter.name}
                </span>
                {isActive && (
                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}>
                        <CheckCircle2 className="w-3.5 h-3.5 text-primary ml-1" />
                    </motion.div>
                )}
            </div>

            {/* Sub-items (Detected Needs) */}
            <AnimatePresence>
                {isActive && chapter.matchedNeeds.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="mt-2 space-y-1 origin-top"
                    >
                        {chapter.matchedNeeds.map((need: any, idx: number) => (
                            <div key={idx} className="flex items-start gap-2 pl-6 py-1">
                                <ChevronRight className="w-3 h-3 text-white/20 shrink-0 mt-0.5" />
                                <div className="flex flex-col">
                                    <span className="text-xs text-white/70">{need.description}</span>
                                    {(need.estimatedQuantity || need.unit) && (
                                        <span className="text-[10px] font-mono text-primary/80 mt-0.5">
                                            {need.estimatedQuantity} {need.unit}
                                        </span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}
