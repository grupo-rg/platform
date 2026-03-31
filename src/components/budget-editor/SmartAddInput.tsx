'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Sparkles, ArrowUp, Loader2 } from 'lucide-react';
import { smartAddAction } from '@/actions/budget/smart-add.action';
import { useToast } from '@/hooks/use-toast';
import { EditableBudgetLineItem } from '@/types/budget-editor';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

interface SmartAddInputProps {
    onAddItems: (items: EditableBudgetLineItem[]) => void;
    className?: string;
    leadId?: string;
    isReadOnly?: boolean;
}

export const SmartAddInput = ({ onAddItems, className, leadId, isReadOnly = false }: SmartAddInputProps) => {
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const { toast } = useToast();

    if (isReadOnly) {
        return null; // The user wants to hide them completely when read-only
    }

    const handleSubmit = async () => {
        if (!input.trim() || isReadOnly) return;

        setIsLoading(true);
        try {
            const result = await smartAddAction(input, leadId);

            if (result.success && result.items) {
                onAddItems(result.items);
                setInput('');
                toast({
                    title: "Partidas añadidas",
                    description: `Se han añadido ${result.items.length} partidas nuevas.`,
                });
            } else {
                toast({
                    title: "No se pudo interpretar",
                    description: result.error || "Intenta ser más específico.",
                    variant: "destructive"
                });
            }
        } catch (error) {
            toast({
                title: "Error",
                description: "Ha ocurrido un error al procesar tu solicitud.",
                variant: "destructive"
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    };

    return (
        <div className={cn("relative group", className)}>
            <div className="absolute -inset-0.5 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-xl opacity-20 group-hover:opacity-40 transition duration-500 blur"></div>
            <div className="relative bg-white dark:bg-zinc-900 rounded-xl p-1 border border-indigo-100 dark:border-indigo-500/20 shadow-sm flex items-end gap-2">
                <div className="flex-1 min-w-0">
                    <Textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="✨ Añade partidas con IA. Ej: 'Pintar 50m2 de paredes en blanco' o 'Instalar 3 puertas de roble'"
                        className="border-0 focus-visible:ring-0 shadow-none resize-none min-h-[44px] max-h-[120px] py-3 px-3 bg-transparent text-sm placeholder:text-muted-foreground/60"
                        rows={1}
                        style={{ height: 'auto', minHeight: '44px' }}
                        onInput={(e) => {
                            const target = e.target as HTMLTextAreaElement;
                            target.style.height = 'auto';
                            target.style.height = `${target.scrollHeight}px`;
                        }}
                    />
                </div>
                <Button
                    onClick={handleSubmit}
                    disabled={isLoading || !input.trim()}
                    size="icon"
                    className={cn(
                        "h-8 w-8 mb-1.5 mr-1.5 transition-all duration-300",
                        input.trim() ? "bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-500/20" : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-600"
                    )}
                >
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
                </Button>
            </div>
            <div className="absolute right-0 -bottom-6 text-[10px] text-muted-foreground/50 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Sparkles className="w-3 h-3 text-indigo-400" />
                <span>Powered by Gemini 2.0 Flash</span>
            </div>
        </div>
    );
};
