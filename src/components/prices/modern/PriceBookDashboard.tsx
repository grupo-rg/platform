'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChapterSidebar } from './ChapterSidebar';
import { PriceBookItem } from '@/backend/price-book/domain/price-book-item';
import { usePriceBook } from '@/hooks/use-price-book';
import { searchPriceBookAction } from '@/actions/search-price-book.action';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, SlidersHorizontal, User, RefreshCw, Loader2, Sparkles, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { PriceList } from './PriceList';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';

export function PriceBookDashboard() {
    // UI State
    const [year, setYear] = useState<number>(2025);
    const [selectedChapter, setSelectedChapter] = useState<string>('All');
    const [searchQuery, setSearchQuery] = useState('');

    // React Query for Caching
    const { data: items = [], isLoading, refetch, isRefetching } = usePriceBook(year);

    // Semantic Search State (AI)
    const [semanticResults, setSemanticResults] = useState<PriceBookItem[] | null>(null);
    const [isAiSearching, setIsAiSearching] = useState(false);

    // Hybrid Search Handler (AI)
    const handleAiSearch = async () => {
        if (!searchQuery.trim()) return;
        setIsAiSearching(true);
        try {
            const results = await searchPriceBookAction(searchQuery, year);
            setSemanticResults(results);
        } catch (error) {
            console.error("AI Search failed", error);
        } finally {
            setIsAiSearching(false);
        }
    };

    // Standard Local Filter (Instant)
    const filteredItems = useMemo(() => {
        // 1. If we have AI results, SHOW THEM (they override everything)
        if (semanticResults !== null) return semanticResults;

        // 2. Otherwise, Local Filter on Cached Data
        let filtered = items;

        // 2a. Text Filter (Local)
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            filtered = filtered.filter((item: PriceBookItem) =>
                item.code.toLowerCase().includes(q) ||
                item.description.toLowerCase().includes(q) ||
                (item.chapter && item.chapter.toLowerCase().includes(q))
            );
        }

        // 2b. Chapter Filter
        if (selectedChapter !== 'All') {
            filtered = filtered.filter((item: PriceBookItem) => item.chapter === selectedChapter);
        }

        return filtered;
    }, [items, selectedChapter, searchQuery, semanticResults]);

    // Clear AI results when user clears search, types new local search, or changes year
    useEffect(() => {
        if (searchQuery === '') setSemanticResults(null);
    }, [searchQuery]);

    useEffect(() => {
        setSemanticResults(null);
    }, [year]);

    const chapters = useMemo(() => {
        const counts: Record<string, number> = {};
        items.forEach((item: PriceBookItem) => {
            const ch = item.chapter || 'Uncategorized';
            counts[ch] = (counts[ch] || 0) + 1;
        });
        return counts;
    }, [items]);

    return (
        <div className="h-[calc(100vh-6rem)] bg-background text-foreground flex flex-col rounded-3xl border border-border overflow-hidden shadow-2xl">

            {/* Header */}
            <header className="shrink-0 h-20 border-b border-border/50 bg-background/95 backdrop-blur-xl flex items-center justify-between px-8 shadow-sm z-40 relative">
                <div className="flex items-center gap-6 flex-1">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-gradient-to-br from-amber-500/10 to-orange-600/10 rounded-xl border border-amber-500/20">
                            <SlidersHorizontal className="w-5 h-5 text-amber-600 dark:text-amber-500" />
                        </div>
                        <div>
                            <div className="text-xl font-bold tracking-tight font-headline text-foreground">
                                Basis
                            </div>
                            <p className="text-xs text-muted-foreground font-medium">Base de Datos</p>
                        </div>
                    </div>

                    <div className="h-8 w-px bg-border/60 mx-2 hidden md:block" />

                    {/* Breadcrumbs / Title */}
                    <div className="hidden md:flex flex-col">
                        <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Capítulo Actual</span>
                        <span className="font-semibold text-sm text-foreground flex items-center gap-2">
                            {selectedChapter === 'All' ? 'Biblioteca Completa' : selectedChapter}
                            <Badge variant="secondary" className="text-[10px] h-4 px-1">{filteredItems.length}</Badge>
                        </span>
                    </div>

                    <div className="h-8 w-px bg-border/60 mx-2 hidden md:block" />

                    {/* Active Year */}
                    <div className="flex bg-muted p-1 rounded-xl">
                        <div className="px-3 py-1 text-xs font-semibold rounded-lg transition-all flex items-center gap-1 bg-background shadow text-foreground">
                            <Sparkles className="w-3 h-3 text-purple-500" />
                            Catálogo 2025
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    {/* Search Bar & AI Control */}
                    <div className="relative max-w-lg w-full group hidden md:flex items-center gap-2">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                            <input
                                type="text"
                                placeholder="Buscar partidas, códigos..."
                                className="w-full bg-muted/30 hover:bg-muted/50 focus:bg-background border border-border/50 rounded-xl py-2 pl-10 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-foreground placeholder:text-muted-foreground"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleAiSearch()}
                            />
                            {searchQuery && (
                                <button
                                    onClick={() => { setSearchQuery(''); setSemanticResults(null); }}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            )}
                        </div>

                        {/* AI Trigger - Visible when typing */}
                        <AnimatePresence>
                            {(searchQuery.trim().length > 2 && !semanticResults) && (
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.9 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.9 }}
                                >
                                    <Button
                                        size="sm"
                                        onClick={handleAiSearch}
                                        disabled={isAiSearching}
                                        className="gap-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white border-0 shadow-lg shadow-purple-500/20 rounded-xl h-9"
                                    >
                                        {isAiSearching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                                        <span className="text-xs font-medium">Preguntar a IA</span>
                                    </Button>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Clear AI Mode Indicator */}
                        {semanticResults && (
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setSemanticResults(null)}
                                className="gap-2 bg-purple-100 text-purple-700 hover:bg-purple-200 dark:bg-purple-900/30 dark:text-purple-300 border border-purple-200 dark:border-purple-800 rounded-xl h-9"
                            >
                                <Sparkles className="w-3 h-3" />
                                <span className="text-xs font-medium">Resultados IA</span>
                                <X className="w-3 h-3 ml-1 opacity-50" />
                            </Button>
                        )}
                    </div>

                    <div className="h-8 w-px bg-border/60 mx-2 hidden md:block" />

                    {/* Mobile Chapter Toggle */}
                    <div className="md:hidden">
                        <Sheet>
                            <SheetTrigger asChild>
                                <Button variant="outline" size="icon" className="h-10 w-10 rounded-xl">
                                    <SlidersHorizontal className="h-5 w-5" />
                                </Button>
                            </SheetTrigger>
                            <SheetContent side="left" className="p-0 w-80">
                                <SheetTitle className="sr-only">Capítulos</SheetTitle>
                                <ChapterSidebar
                                    chapters={chapters}
                                    selectedChapter={selectedChapter}
                                    onSelect={(ch) => {
                                        setSelectedChapter(ch);
                                    }}
                                    totalItems={items.length}
                                />
                            </SheetContent>
                        </Sheet>
                    </div>

                    <Button
                        variant="outline"
                        size="icon"
                        className="h-10 w-10 text-muted-foreground hover:text-foreground rounded-xl border-border/50"
                        onClick={() => refetch()}
                        title="Actualizar datos"
                        disabled={isLoading || isRefetching}
                    >
                        {isLoading || isRefetching || isAiSearching ? <Loader2 className="h-5 w-5 animate-spin" /> : <RefreshCw className="h-5 w-5" />}
                    </Button>
                </div>
            </header>

            <main className="flex-1 flex overflow-hidden">
                {/* Fixed/Sticky Sidebar */}
                <aside className="hidden md:block w-80 shrink-0 border-r border-border/50 h-full overflow-y-auto bg-muted/5">
                    <ChapterSidebar
                        chapters={chapters}
                        selectedChapter={selectedChapter}
                        onSelect={setSelectedChapter}
                        totalItems={items.length}
                    />
                </aside>

                {/* Main Content Flow */}
                <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-background">
                    {/* Mobile Search - Visible only on small screens */}
                    <div className="md:hidden p-4 border-b border-border/50">
                        <div className="relative w-full">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <input
                                type="text"
                                placeholder="Buscar..."
                                className="w-full bg-muted/50 border border-border rounded-lg py-2 pl-10 pr-4 text-sm"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-0 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
                        <div className="p-6 md:p-8">
                            <PriceList items={filteredItems} loading={isLoading} />
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
