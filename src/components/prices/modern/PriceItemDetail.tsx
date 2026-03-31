'use client';

import { useState, useEffect } from 'react';
import { PriceBookItem, PriceBookComponent } from "@/backend/price-book/domain/price-book-item";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Replace, Loader2, CheckCircle2, TrendingUp, Send, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { searchPriceBookAction } from '@/actions/search-price-book.action';

interface BreakdownItem extends PriceBookComponent {
    price: number;
}

export function PriceItemDetail({ item }: { item: PriceBookItem }) {
    const [selectedVariableItem, setSelectedVariableItem] = useState<BreakdownItem | null>(null);
    const [semanticAlternatives, setSemanticAlternatives] = useState<PriceBookItem[]>([]);
    const [isSearching, setIsSearching] = useState(false);

    useEffect(() => {
        if (!selectedVariableItem?.description) return;

        const fetchAlternatives = async () => {
            setIsSearching(true);
            try {
                // Pass the current year context if available, defaulting to 2025 since it has vectors
                const results = await searchPriceBookAction(selectedVariableItem.description!, item.year || 2025);
                // Filter out the exact same item just in case, and limit to top 3 for UI
                setSemanticAlternatives(results.filter(r => r.code !== selectedVariableItem.code).slice(0, 3));
            } catch (e) {
                console.error("Failed to find semantic alternatives", e);
            } finally {
                setIsSearching(false);
            }
        };

        fetchAlternatives();
    }, [selectedVariableItem, item.year]);

    // Helper to calculate totals
    const calculateTotal = (comp: any) => {
        const cPrice = comp.price_unit ?? comp.unitPrice ?? comp.price ?? 0;
        const cQuantity = comp.quantity ?? comp.yield ?? 1;
        if (comp.unit === '%') {
            return cPrice * (cQuantity / 100);
        }
        return cQuantity * cPrice;
    };

    return (
        <div className="space-y-6">
            <div className="space-y-4">
                <div className="flex items-start justify-between">
                    <div className="space-y-1">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider">
                            <span>{item.code}</span>
                            <span>•</span>
                            <span>{item.chapter} / {item.section}</span>
                        </div>

                        <h2 className="text-4xl font-light tracking-tight text-foreground flex items-baseline">
                            {new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(item.priceTotal)}
                            <span className="text-lg text-muted-foreground ml-2 font-normal">/ {item.unit}</span>
                        </h2>
                    </div>

                    {/* Cost Optimization Thermometer */}
                    {(item.priceLabor !== undefined && item.priceMaterial !== undefined) && (
                        <div className="flex flex-col items-end gap-1">
                            <span className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider flex items-center gap-1">
                                <TrendingUp className="w-3 h-3" /> Cost Distribution
                            </span>
                            <div className="flex h-2 w-32 rounded-full overflow-hidden bg-muted">
                                <div
                                    className="bg-blue-500 hover:bg-blue-400 transition-all hover:scale-y-150 origin-left"
                                    style={{ width: `${(item.priceLabor / item.priceTotal) * 100}%` }}
                                    title={`Labor: ${(item.priceLabor / item.priceTotal * 100).toFixed(0)}%`}
                                />
                                <div
                                    className="bg-amber-500 hover:bg-amber-400 transition-all hover:scale-y-150 origin-right"
                                    style={{ width: `${(item.priceMaterial / item.priceTotal) * 100}%` }}
                                    title={`Material: ${(item.priceMaterial / item.priceTotal * 100).toFixed(0)}%`}
                                />
                                <div
                                    className="bg-emerald-500 flex-1 hover:bg-emerald-400 transition-all hover:scale-y-150"
                                    title="Machinery/Other"
                                />
                            </div>
                            <div className="flex justify-between w-32 text-[9px] text-muted-foreground mt-0.5 px-0.5">
                                <span>Mano Obra</span>
                                <span>Material</span>
                            </div>
                        </div>
                    )}
                </div>

                <p className="text-foreground/80 leading-relaxed pt-2 text-sm">
                    {item.description}
                </p>
            </div>

            <Separator className="bg-border" />

            <div className="space-y-4">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase">Cost Breakdown</h3>

                <div className="space-y-1">
                    <div className="grid grid-cols-12 text-[10px] text-muted-foreground uppercase tracking-wider pb-2 border-b border-border px-2 font-medium">
                        <div className="col-span-2">Code</div>
                        <div className="col-span-6">Description</div>
                        <div className="col-span-2 text-right">Qty</div>
                        <div className="col-span-1 text-right">Price</div>
                        <div className="col-span-1 text-right">Total</div>
                    </div>

                    {item.breakdown && item.breakdown.length > 0 ? (
                        item.breakdown.map((comp: any, idx: number) => {
                            const bItem = comp as BreakdownItem;
                            const total = calculateTotal(bItem);
                            const isVariable = bItem.is_variable === true;

                            const cQuantity = bItem.quantity ?? comp.yield ?? 1;
                            const cPrice = comp.price_unit ?? comp.unitPrice ?? comp.price ?? 0;

                            return (
                                <div key={idx} className={`grid grid-cols-12 text-sm pt-2 pb-2 px-2 rounded-lg transition-all items-center border mb-1 ${isVariable ? 'bg-amber-500/5 hover:bg-amber-500/10 border-amber-500/30' : 'bg-transparent hover:bg-muted/50 border-transparent hover:border-border'}`}>
                                    <div className="col-span-2 font-mono text-primary text-xs">
                                        {bItem.code}
                                        {isVariable && (
                                            <Badge variant="outline" className="ml-2 text-[9px] h-4 px-1 py-0 bg-amber-500/10 text-amber-600 border-amber-500/40">
                                                VARIABLE
                                            </Badge>
                                        )}
                                    </div>
                                    <div className="col-span-6 text-foreground/80 text-xs truncate pr-4 flex items-center justify-between" title={bItem.description}>
                                        <span className={isVariable ? 'font-medium text-amber-900 dark:text-amber-100' : ''}>
                                            {bItem.description}
                                        </span>
                                        {isVariable && (
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                className="h-6 text-[10px] px-2 gap-1 bg-amber-100 hover:bg-amber-200 text-amber-700 dark:bg-amber-900/30 dark:hover:bg-amber-900/50 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
                                                onClick={() => setSelectedVariableItem(bItem)}
                                            >
                                                <Sparkles className="w-3 h-3" />
                                                Sustituir con IA
                                            </Button>
                                        )}
                                    </div>
                                    <div className="col-span-2 text-right text-muted-foreground font-mono text-xs">
                                        {cQuantity.toFixed(3)} {comp.unit}
                                    </div>
                                    <div className="col-span-1 text-right text-muted-foreground font-mono text-xs">
                                        {cPrice.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}
                                    </div>
                                    <div className="col-span-1 text-right text-foreground font-mono text-xs font-medium">
                                        {total.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}
                                    </div>
                                </div>
                            );
                        })
                    ) : (
                        <div className="text-muted-foreground text-xs italic py-4 text-center">No detailed breakdown available.</div>
                    )}
                </div>
            </div>

            {/* Substitution Panel (Active Semantic RAG) */}
            {selectedVariableItem && (
                <div className="mt-6 p-4 border border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20 rounded-xl animate-in fade-in slide-in-from-bottom-4">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <div className="p-1.5 bg-amber-500/20 rounded-lg">
                                <Replace className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                            </div>
                            <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                                {isSearching ? 'Buscando Sustitutos Semánticos...' : 'Alternativas Recomendadas por IA'}
                            </h4>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => setSelectedVariableItem(null)} className="h-6 px-2 text-xs">
                            Cerrar
                        </Button>
                    </div>

                    <div className="text-sm text-foreground/80 mb-4">
                        <p>Buscando en catálogo: <strong>&quot;{selectedVariableItem.description}&quot;</strong></p>
                    </div>

                    <div className="flex gap-3 overflow-x-auto pb-2">
                        {isSearching ? (
                            <>
                                <div className="h-24 w-64 shrink-0 bg-background/50 border border-border rounded-lg animate-pulse flex items-center justify-center">
                                    <Loader2 className="w-5 h-5 text-amber-500 animate-spin" />
                                </div>
                                <div className="h-24 w-64 shrink-0 bg-background/50 border border-border rounded-lg animate-pulse" />
                            </>
                        ) : semanticAlternatives.length > 0 ? (
                            semanticAlternatives.map((alt) => (
                                <div key={alt.id || alt.code} className="w-72 shrink-0 bg-background border border-amber-200 dark:border-amber-800 rounded-lg p-3 shadow-sm hover:border-amber-400 transition-colors flex flex-col justify-between">
                                    <div>
                                        <div className="flex items-start justify-between gap-2 mb-1">
                                            <span className="font-mono text-xs text-primary font-medium">{alt.code}</span>
                                            <span className="font-mono text-xs font-semibold">{new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(alt.priceTotal || 0)}</span>
                                        </div>
                                        <p className="text-xs text-muted-foreground line-clamp-2" title={alt.description}>
                                            {alt.description}
                                        </p>
                                    </div>
                                    <Button size="sm" className="w-full mt-3 h-7 text-xs bg-amber-600 hover:bg-amber-700 text-white">
                                        <CheckCircle2 className="w-3 h-3 mr-1" /> Elegir Alternativa
                                    </Button>
                                </div>
                            ))
                        ) : (
                            <div className="w-full p-4 text-center border border-dashed border-amber-200 rounded-lg text-amber-700/70 text-sm">
                                No se encontraron alternativas semánticas directas.
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* AI Co-Pilot Command Interface */}
            <Separator className="bg-border mt-6 mb-4" />

            <div className="bg-muted/30 rounded-xl p-3 border border-border flex items-start gap-3">
                <div className="p-2 bg-purple-500/10 rounded-lg shrink-0 mt-0.5">
                    <Bot className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                </div>
                <div className="flex-1">
                    <div className="mb-2">
                        <span className="text-xs font-semibold text-purple-900 dark:text-purple-300">Aparejador Copilot</span>
                        <p className="text-xs text-muted-foreground mt-0.5">&quot;Pide cambios en la partida: cambia calidades, altera tiempos, o ajusta mediciones.&quot;</p>
                    </div>
                    <div className="relative">
                        <input
                            type="text"
                            placeholder="Ej. 'Cambia el suelo por un AC6 resistente al agua y añade un 10% más de tiempo...'"
                            className="w-full bg-background border border-border/60 hover:border-border rounded-lg py-2 pl-3 pr-10 text-xs focus:ring-1 focus:ring-purple-500 outline-none text-foreground placeholder:text-muted-foreground/60 transition-all"
                        />
                        <button className="absolute right-2 top-1/2 -translate-y-1/2 text-purple-600 hover:text-purple-700 p-1 rounded-md hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors">
                            <Send className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
