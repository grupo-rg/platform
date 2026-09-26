'use client';

import * as React from 'react';
import { m, MotionProvider } from '@/components/home/lazy-motion';

interface PhilosophySectionProps {
    quote: string;
    author?: string;
    description?: string;
}

export function PhilosophySection({
    quote,
    author,
    description,
    label = "Filosofía" // Fallback
}: PhilosophySectionProps & { label?: string }) {
    return (
        <MotionProvider>
            <section className="py-32 bg-secondary text-secondary-foreground overflow-hidden relative">
                {/* Decorative background element */}
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />

                <div className="container-limited relative z-10">
                    <m.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        whileInView={{ opacity: 1, scale: 1 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.8, ease: "easeOut" }}
                        className="max-w-5xl mx-auto text-center"
                    >
                        <div className="inline-block mb-10">
                            <span className="w-px h-16 bg-primary block mx-auto mb-6" />
                            <span className="text-primary font-medium uppercase tracking-widest text-sm">
                                {label}
                            </span>
                        </div>

                        <blockquote className="heading-display text-3xl md:text-5xl lg:text-6xl leading-tight mb-12 font-medium">
                            &quot;{quote}&quot;
                        </blockquote>

                        {description && (
                            <p className="text-lg md:text-xl text-secondary-foreground/70 max-w-2xl mx-auto leading-relaxed mb-10">
                                {description}
                            </p>
                        )}

                        {author && (
                            <cite className="not-italic font-medium text-primary text-lg tracking-wide">
                                — {author}
                            </cite>
                        )}
                    </m.div>
                </div>
            </section>
        </MotionProvider>
    );
}
