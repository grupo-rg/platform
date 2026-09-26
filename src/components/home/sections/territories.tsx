'use client';

import * as React from 'react';
import { m, MotionProvider } from '@/components/home/lazy-motion';
import { MapPin } from 'lucide-react';

interface TerritoriesSectionProps {
    title: string;
    description: string;
    locations: string[];
}

export function TerritoriesSection({
    title,
    description,
    locations = [],
    label = "Cobertura"
}: TerritoriesSectionProps & { label?: string }) {
    return (
        <MotionProvider>
            <section className="py-24 bg-muted/30">
                <div className="container-limited text-center max-w-4xl mx-auto">
                    <m.div
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        className="mb-16"
                    >
                        <span className="text-primary font-medium uppercase tracking-widest text-sm mb-4 block">
                            {label}
                        </span>
                        <h2 className="heading-display text-3xl md:text-5xl mb-6">
                            {title}
                        </h2>
                        <p className="text-muted-foreground text-lg leading-relaxed max-w-2xl mx-auto">
                            {description}
                        </p>
                    </m.div>

                    <div className="flex flex-wrap justify-center gap-4">
                        {locations.map((location, index) => (
                            <m.div
                                key={index}
                                initial={{ opacity: 0, scale: 0.9 }}
                                whileInView={{ opacity: 1, scale: 1 }}
                                viewport={{ once: true }}
                                transition={{ delay: index * 0.05 }}
                                whileHover={{ scale: 1.05 }}
                                className="bg-background rounded-full px-6 py-3 shadow-sm border border-border flex items-center gap-2 hover:border-primary hover:shadow-md transition-all cursor-default"
                            >
                                <MapPin className="w-4 h-4 text-primary" />
                                <span className="font-medium text-foreground">{location}</span>
                            </m.div>
                        ))}
                    </div>
                </div>
            </section>
        </MotionProvider>
    );
}
