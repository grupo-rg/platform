import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, ClipboardList, Send, CheckCircle2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

const LOADING_STAGES = [
    {
        id: 1,
        label: "Recibiendo tu solicitud...",
        icon: <ClipboardList className="w-8 h-8 text-purple-500" />,
        duration: 1100
    },
    {
        id: 2,
        label: "Validando los datos del proyecto...",
        icon: <ShieldCheck className="w-8 h-8 text-blue-500" />,
        duration: 1100
    },
    {
        id: 3,
        label: "Notificando al equipo de Grupo RG...",
        icon: <Send className="w-8 h-8 text-amber-500" />,
        duration: 1100
    },
    {
        id: 4,
        label: "¡Listo! Confirmamos la recepción.",
        icon: <CheckCircle2 className="w-8 h-8 text-green-500" />,
        duration: 800
    }
];

export const BudgetGenerationLoading = () => {
    const [currentStage, setCurrentStage] = useState(0);
    const [progress, setProgress] = useState(0);

    useEffect(() => {
        // Stage rotation logic
        if (currentStage >= LOADING_STAGES.length) return;

        const stage = LOADING_STAGES[currentStage];
        const timer = setTimeout(() => {
            setCurrentStage(prev => prev + 1);
        }, stage.duration);

        return () => clearTimeout(timer);
    }, [currentStage]);

    useEffect(() => {
        // Progress bar simulation (0 to 100 over approx 5-6 seconds)
        const interval = setInterval(() => {
            setProgress(prev => {
                if (prev >= 95) return 95; // Hold at 95 until done
                return prev + 2;
            });
        }, 100);
        return () => clearInterval(interval);
    }, []);

    const currentStageInfo = LOADING_STAGES[Math.min(currentStage, LOADING_STAGES.length - 1)];

    return (
        <div className="flex flex-col items-center justify-center min-h-[400px] text-center p-8 space-y-8 animate-in fade-in duration-500">
            <div className="relative">
                {/* Pulsing ring background */}
                <div className="absolute inset-0 bg-primary/10 rounded-full blur-xl animate-pulse" />

                <AnimatePresence mode='wait'>
                    <motion.div
                        key={currentStageInfo.id}
                        initial={{ opacity: 0, scale: 0.8, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.8, y: -10 }}
                        transition={{ duration: 0.3 }}
                        className="bg-background p-6 rounded-full border-2 border-primary/20 shadow-xl relative z-10"
                    >
                        {currentStageInfo.icon}
                    </motion.div>
                </AnimatePresence>
            </div>

            <div className="space-y-4 max-w-sm w-full mx-auto">
                <h3 className="text-xl font-headline font-semibold text-foreground/80 min-h-[3rem] flex items-center justify-center">
                    {currentStage < LOADING_STAGES.length ? (
                        <span className="animate-pulse">{currentStageInfo.label}</span>
                    ) : (
                        <span>¡Finalizando!</span>
                    )}
                </h3>

                <div className="space-y-2">
                    <Progress value={progress} className="h-2" />
                    <p className="text-xs text-muted-foreground w-full text-right">{progress}%</p>
                </div>
            </div>
        </div>
    );
};
