'use client';

import { m, MotionProvider } from '@/components/home/lazy-motion';
import {
    Sparkles,
    UserCheck,
    MapPin,
    FileCheck,
    ArrowRight
} from 'lucide-react';
import { useWidgetContext } from '@/context/budget-widget-context';

export function ProcessSteps({ t }: { t: any }) {
    const { openWidget } = useWidgetContext();

    if (!t) return null;

    const icons = [
        <Sparkles className="h-8 w-8" key="0" />,
        <UserCheck className="h-8 w-8" key="1" />,
        <MapPin className="h-8 w-8" key="2" />,
        <FileCheck className="h-8 w-8" key="3" />
    ];

    return (
        <MotionProvider>
            <section className="py-32 bg-[hsl(0,0%,6%)] text-white relative overflow-hidden">
                {/* Architectural Grid Background */}
                <div className="absolute inset-0 pointer-events-none opacity-[0.05]"
                    style={{
                        backgroundImage: `linear-gradient(to right, #ffffff 1px, transparent 1px),
                                        linear-gradient(to bottom, #ffffff 1px, transparent 1px)`,
                        backgroundSize: '4rem 4rem'
                    }}
                />

                {/* Ambient gradients */}
                <div className="absolute top-0 left-1/4 w-1/2 h-1/2 bg-primary/5 rounded-full blur-[120px] -z-10" />
                <div className="absolute bottom-0 right-1/4 w-1/3 h-1/3 bg-blue-500/5 rounded-full blur-[100px] -z-10" />

                <div className="container-limited relative z-10">
                    <div className="flex flex-col md:flex-row justify-between items-end mb-16 gap-6">
                        <div className="space-y-4 max-w-2xl">
                            <m.span
                                initial={{ opacity: 0, x: -20 }}
                                whileInView={{ opacity: 1, x: 0 }}
                                className="text-primary font-bold tracking-widest uppercase text-sm flex items-center gap-2"
                            >
                                <span className="w-8 h-[1px] bg-primary"></span>
                                {t.label}
                            </m.span>
                            <m.h2
                                initial={{ opacity: 0, y: 20 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.1 }}
                                className="font-headline text-4xl md:text-6xl font-bold leading-tight"
                            >
                                {t.title}
                            </m.h2>
                            <m.p
                                initial={{ opacity: 0, y: 20 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.2 }}
                                className="text-white/60 text-lg md:text-xl font-light"
                            >
                                {t.subtitle}
                            </m.p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-auto md:h-[600px]">
                        {/* Step 1: AI Budget — Vertical Tall Card */}
                        <m.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            whileInView={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.5 }}
                            onClick={() => openWidget('general')}
                            className="md:col-span-1 md:row-span-2 group relative p-8 md:p-10 bg-white/5 border border-white/10 rounded-3xl hover:bg-white/10 transition-all duration-500 flex flex-col justify-between overflow-hidden cursor-pointer"
                        >
                            <div className="absolute top-0 right-0 p-6 opacity-20 group-hover:opacity-100 transition-opacity duration-500">
                                <span className="text-8xl font-bold font-headline text-transparent stroke-text">01</span>
                            </div>

                            <div className="relative z-10">
                                <div className="flex items-center gap-3 mb-8">
                                    <div className="h-16 w-16 rounded-2xl bg-primary/20 flex items-center justify-center text-primary group-hover:scale-110 transition-transform duration-500">
                                        {icons[0]}
                                    </div>
                                    {t.steps[0].badge && (
                                        <span className="px-3 py-1 rounded-full bg-primary/20 text-primary text-xs font-bold uppercase tracking-wider border border-primary/30">
                                            {t.steps[0].badge}
                                        </span>
                                    )}
                                </div>
                                <h3 className="text-3xl font-bold mb-4">{t.steps[0].title}</h3>
                                <p className="text-white/60 leading-relaxed text-lg">
                                    {t.steps[0].description}
                                </p>
                            </div>

                            <div className="mt-8 pt-8 border-t border-white/10 flex items-center text-primary font-medium group-hover:translate-x-2 transition-transform">
                                <span className="mr-2">Comenzar Ahora</span>
                                <ArrowRight className="h-4 w-4" />
                            </div>
                        </m.div>

                        {/* Step 2: Expert Review — Wide Horizontal Card */}
                        <m.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            whileInView={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.5, delay: 0.1 }}
                            className="md:col-span-2 md:row-span-1 group relative p-8 md:p-10 bg-gradient-to-br from-white/10 to-white/5 border border-white/10 rounded-3xl hover:border-primary/50 transition-all duration-500 overflow-hidden flex flex-col md:flex-row items-start md:items-center gap-6"
                        >
                            <div className="absolute -bottom-10 -right-10 w-64 h-64 bg-primary/20 rounded-full blur-3xl group-hover:bg-primary/30 transition-colors duration-500" />

                            <div className="h-20 w-20 rounded-2xl bg-white/10 flex items-center justify-center text-white mb-4 md:mb-0 shrink-0">
                                {icons[1]}
                            </div>

                            <div className="flex-1 relative z-10">
                                <div className="flex justify-between items-start mb-2">
                                    <h3 className="text-3xl font-bold">{t.steps[1].title}</h3>
                                    <span className="text-5xl font-bold font-headline text-white/10 group-hover:text-white/30 transition-colors">02</span>
                                </div>
                                <p className="text-white/70 text-lg max-w-xl">
                                    {t.steps[1].description}
                                </p>
                            </div>
                        </m.div>

                        {/* Step 3: Technical Visit — Square Card */}
                        <m.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            whileInView={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.5, delay: 0.2 }}
                            className="md:col-span-1 md:row-span-1 group relative p-8 bg-stone-800/50 border border-white/10 rounded-3xl hover:bg-stone-800 transition-all duration-500"
                        >
                            <div className="flex justify-between items-start mb-6">
                                <div className="h-14 w-14 rounded-xl bg-orange-500/20 flex items-center justify-center text-orange-500">
                                    {icons[2]}
                                </div>
                                <span className="text-4xl font-bold font-headline text-white/10">03</span>
                            </div>
                            <h3 className="text-2xl font-bold mb-3">{t.steps[2].title}</h3>
                            <p className="text-white/60">
                                {t.steps[2].description}
                            </p>
                        </m.div>

                        {/* Step 4: Final Budget — Square Card with Highlight */}
                        <m.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            whileInView={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.5, delay: 0.3 }}
                            onClick={() => openWidget('chat')}
                            className="md:col-span-1 md:row-span-1 group relative p-8 bg-primary/20 border border-primary/30 rounded-3xl hover:bg-primary/30 transition-all duration-500 cursor-pointer"
                        >
                            <div className="flex justify-between items-start mb-6">
                                <div className="flex items-center gap-2">
                                    <div className="h-14 w-14 rounded-xl bg-white/20 flex items-center justify-center text-white">
                                        {icons[3]}
                                    </div>
                                    {t.steps[3].badge && (
                                        <span className="px-2.5 py-1 rounded-full bg-white/20 text-white text-xs font-bold uppercase tracking-wider">
                                            {t.steps[3].badge}
                                        </span>
                                    )}
                                </div>
                                <span className="text-4xl font-bold font-headline text-white/20">04</span>
                            </div>
                            <h3 className="text-2xl font-bold mb-3 text-white">{t.steps[3].title}</h3>
                            <p className="text-white/80">
                                {t.steps[3].description}
                            </p>
                        </m.div>
                    </div>
                </div>

                <style jsx global>{`
                    .stroke-text {
                        -webkit-text-stroke: 1px rgba(255, 255, 255, 0.1);
                        color: transparent;
                    }
                `}</style>
            </section>
        </MotionProvider>
    );
}
