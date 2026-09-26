'use client';

import * as React from 'react';
import { m, MotionProvider } from '@/components/home/lazy-motion';
import { Counter } from '@/components/ui/animated-section';

interface NumberItem {
    value: number;
    suffix?: string;
    label: string;
}

interface NumbersSectionProps {
    items: NumberItem[];
}

export function NumbersSection({ items = [] }: NumbersSectionProps) {
    return (
        <MotionProvider>
            <section className="py-20 md:py-28 text-white relative bg-fixed bg-center bg-cover"
                style={{ backgroundImage: 'url(https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=70&w=1280&auto=format&fit=crop)' }}>

                <div className="absolute inset-0 bg-primary/90 mix-blend-multiply" />
                <div className="absolute inset-0 bg-black/40" />

                <div className="container-limited relative z-10">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-12">
                        {items?.map((item, index) => (
                            <m.div
                                key={index}
                                initial={{ opacity: 0, y: 20 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                transition={{ delay: index * 0.1 }}
                                className="text-center group"
                            >
                                <div className="heading-display text-5xl md:text-6xl lg:text-7xl font-bold mb-3 group-hover:scale-110 transition-transform duration-500">
                                    <Counter to={item.value} suffix={item.suffix} />
                                </div>
                                <div className="h-0.5 w-12 bg-white/50 mx-auto mb-4 group-hover:w-20 transition-all duration-300" />
                                <p className="text-white/90 text-sm md:text-base uppercase tracking-widest font-medium">
                                    {item.label}
                                </p>
                            </m.div>
                        ))}
                    </div>
                </div>
            </section>
        </MotionProvider>
    );
}
