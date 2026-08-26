'use client';

import * as React from 'react';
import { motion, useScroll, useTransform, useMotionValue, useSpring } from 'framer-motion';
import { ArrowRight, Star, ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useWidgetContext } from '@/context/budget-widget-context';
import { VideoModalButton } from '@/components/home/video-modal-button';

interface HeroHybridProps {
    title: string;
    subtitle: string;
    description: string;
    ctaText: string;
    ctaLink: string;
    secondaryCtaText?: string;
    secondaryCtaLink?: string;
    videoCtaText?: string;
    floatingCards?: {
        featured: string;
        clients: string;
        renovate: string;
        estimate: string;
        scroll: string;
    };
}

export function HeroHybrid({
    title,
    subtitle,
    description,
    ctaText,
    ctaLink,
    secondaryCtaText,
    secondaryCtaLink,
    videoCtaText,
    floatingCards = {
        featured: "Featured",
        clients: "+500 Clients",
        renovate: "Thinking of renovating?",
        estimate: "Get your free estimate in seconds.",
        scroll: "Scroll to explore"
    }
}: HeroHybridProps) {
    const { openWidget } = useWidgetContext();

    // Scroll animations
    const { scrollY } = useScroll();
    const yOutput = useTransform(scrollY, [0, 500], [0, 200]);
    const opacityOutput = useTransform(scrollY, [0, 500], [1, 0]);
    const scaleOutput = useTransform(scrollY, [0, 500], [1, 1.1]);

    // Mouse movement effect for floating cards
    const mouseX = useMotionValue(0);
    const mouseY = useMotionValue(0);

    const handleMouseMove = (e: React.MouseEvent) => {
        const { clientX, clientY } = e;
        const { innerWidth, innerHeight } = window;
        // Limit the effect range to avoid extreme rotation
        mouseX.set((clientX / innerWidth - 0.5) * 0.5);
        mouseY.set((clientY / innerHeight - 0.5) * 0.5);
    };

    const floatingX = useSpring(useTransform(mouseX, [-0.5, 0.5], [-20, 20]), { stiffness: 150, damping: 20 });
    const floatingY = useSpring(useTransform(mouseY, [-0.5, 0.5], [-20, 20]), { stiffness: 150, damping: 20 });
    const floatingXReverse = useSpring(useTransform(mouseX, [-0.5, 0.5], [15, -15]), { stiffness: 150, damping: 20 });
    const floatingYReverse = useSpring(useTransform(mouseY, [-0.5, 0.5], [15, -15]), { stiffness: 150, damping: 20 });

    return (
        <section
            className="relative h-[110vh] w-full overflow-hidden flex items-center justify-center bg-black"
            onMouseMove={handleMouseMove}
        >

            {/* Background Image with Parallax & Scale */}
            <motion.div
                style={{ y: yOutput, opacity: opacityOutput, scale: scaleOutput }}
                className="absolute inset-0 z-0"
            >
                <div
                    className="absolute inset-0 bg-cover bg-center bg-no-repeat transition-transform duration-1000 ease-out"
                    style={{
                        backgroundImage: 'url(https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?q=80&w=2666&auto=format&fit=crop)',
                    }}
                />
                <div className="absolute inset-0 bg-black/40" />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/20" />
            </motion.div>

            {/* Main Content & Floating Bento Grid */}
            {/* Added max-w-[80vw] constraint directly here as requested */}
            <div className="container-limited max-w-[80vw] mx-auto relative z-10 w-full h-full flex flex-col md:flex-row items-center md:items-end pb-32 md:pb-40 gap-10 md:gap-20">

                {/* Left Side: Typography & Main Actions */}
                <motion.div
                    className="flex-1 text-center md:text-left pt-32 md:pt-0"
                    initial={{ opacity: 0, x: -50 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                >
                    <div className="inline-flex items-center gap-2 py-1 px-3 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-xs font-medium tracking-widest uppercase mb-6 text-white/90">
                        <Star className="w-3 h-3 text-primary fill-primary" />
                        {subtitle}
                    </div>

                    <h1 className="heading-display text-5xl md:text-7xl lg:text-8xl font-bold leading-[0.9] mb-8 text-white mix-blend-overlay">
                        {title}
                    </h1>

                    <p className="text-lg md:text-xl text-white/90 max-w-xl mb-10 leading-relaxed font-light backdrop-blur-sm p-4 rounded-xl bg-black/20 inline-block border border-white/10 shadow-lg">
                        {description}
                    </p>

                    <div className="flex flex-col sm:flex-row gap-4 justify-center md:justify-start">
                        {/* Primary Button opens Modal */}
                        <Button
                            onClick={() => openWidget('general')}
                            size="xl"
                            className="group bg-primary hover:bg-primary/90 text-primary-foreground border-0 rounded-full px-8 h-14 text-lg shadow-[0_0_20px_rgba(232,196,47,0.3)] hover:shadow-[0_0_30px_rgba(232,196,47,0.5)] transition-all cursor-pointer"
                        >
                            {ctaText}
                            <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
                        </Button>

                        {/* Secundario: lleva al catalogo de servicios */}
                        {secondaryCtaText && secondaryCtaLink && (
                            <Link href={secondaryCtaLink}>
                                <Button
                                    variant="outline"
                                    size="xl"
                                    className="group border-white/40 bg-black/20 text-white hover:bg-white/20 hover:text-white rounded-full px-8 h-14 text-lg backdrop-blur-md transition-all font-medium"
                                >
                                    {secondaryCtaText}
                                    <ArrowUpRight className="ml-2 w-5 h-5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                                </Button>
                            </Link>
                        )}

                        {/* Terciario: abre el video corporativo en un modal */}
                        {videoCtaText && <VideoModalButton label={videoCtaText} />}
                    </div>
                </motion.div>

                {/* Right Side: Floating Bento Cards (Asymmetrical) */}
                <div className="relative w-full md:w-1/3 h-[400px] hidden md:block perspective-1000">

                    {/* Floating Card 1: Featured Project Preview */}
                    <motion.div
                        style={{ x: floatingX, y: floatingY }}
                        className="absolute top-0 right-0 w-64 h-80 rounded-2xl overflow-hidden glass shadow-2xl z-20"
                        initial={{ opacity: 0, y: 50, rotate: -5 }}
                        animate={{ opacity: 1, y: 0, rotate: -5 }}
                        transition={{ delay: 0.2, duration: 0.8 }}
                    >
                        <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: 'url(https://images.unsplash.com/photo-1600585154340-be6161a56a0c?q=80&w=500&auto=format&fit=crop)' }} />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
                        <div className="absolute bottom-0 left-0 p-5 w-full">
                            <span className="text-primary text-xs font-bold uppercase tracking-wider mb-1 block">{floatingCards.featured}</span>
                            <div className="text-white font-display text-lg leading-tight flex justify-between items-end">
                                Villa Son Vida
                                <div className="w-8 h-8 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center">
                                    <ArrowUpRight className="w-4 h-4 text-white" />
                                </div>
                            </div>
                        </div>
                    </motion.div>

                    {/* Floating Card 2: Quick Stat/Trust - CLICKABLE */}
                    <motion.div
                        style={{ x: floatingXReverse, y: floatingYReverse }}
                        className="absolute bottom-10 left-0 w-64 p-5 rounded-2xl glass-subtle shadow-xl z-30 border-l-4 border-l-primary bg-black/80 cursor-pointer hover:scale-105 transition-transform"
                        initial={{ opacity: 0, y: 50, x: -20 }}
                        animate={{ opacity: 1, y: 0, x: 0 }}
                        transition={{ delay: 0.4, duration: 0.8 }}
                        onClick={() => openWidget('general')}
                    >
                        <div className="flex items-center gap-3 mb-3">
                            <div className="flex -space-x-2">
                                {[1, 2, 3].map(i => (
                                    <div key={i} className="w-8 h-8 rounded-full border-2 border-black bg-gray-300 overflow-hidden">
                                        <img src={`https://i.pravatar.cc/100?img=${i + 10}`} alt="User" className="w-full h-full object-cover" />
                                    </div>
                                ))}
                            </div>
                            <span className="text-white text-xs font-medium">{floatingCards.clients}</span>
                        </div>
                        <p className="text-white text-sm font-bold mb-1">
                            {floatingCards.renovate}
                        </p>
                        <p className="text-white/60 text-xs italic">
                            {floatingCards.estimate}
                        </p>
                    </motion.div>

                </div>
            </div>

            {/* Scroll Indicator */}
            <motion.div
                animate={{ y: [0, 10, 0] }}
                transition={{ repeat: Infinity, duration: 2 }}
                className="absolute bottom-8 left-1/2 -translate-x-1/2 text-white/30 backdrop-blur-sm py-2 px-4 rounded-full border border-white/5 flex items-center gap-2 cursor-pointer hover:text-white hover:border-white/20 transition-all"
            >
                <div className="w-1 h-1 rounded-full bg-primary" />
                <span className="text-xs tracking-widest uppercase">{floatingCards.scroll}</span>
            </motion.div>
        </section>
    );
}
