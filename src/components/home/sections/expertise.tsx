'use client';

import * as React from 'react';
import { m, MotionProvider } from '@/components/home/lazy-motion';
import { ArrowRight } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { BentoGrid, BentoCard, BentoTitle, BentoDescription } from '@/components/ui/bento-grid';

interface ExpertiseItem {
    title: string;
    description: string;
    icon: React.ReactNode;
    href: string;
    image?: string;
    featured?: boolean;
}

interface ExpertiseSectionProps {
    title: string;
    subtitle: string;
    items: ExpertiseItem[];
}

export function ExpertiseSection({
    title,
    subtitle,
    items,
    viewProjectLabel = "Ver Proyecto"
}: ExpertiseSectionProps & { viewProjectLabel?: string }) {
    if (!items || items.length === 0) {
        return null;
    }

    const featuredItem = items.find(item => item.featured) || items[0];
    const regularItems = items.filter(item => item !== featuredItem);

    return (
        <MotionProvider>
            <section className="py-24 md:py-32 bg-background">
                <div className="container-limited">
                    {/* Header */}
                    <m.div
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        className="mb-16 md:mb-20 text-center max-w-2xl mx-auto"
                    >
                        <span className="text-primary font-medium uppercase tracking-widest text-sm mb-4 block">
                            {subtitle}
                        </span>
                        <h2 className="heading-display text-4xl md:text-5xl lg:text-6xl text-foreground">
                            {title}
                        </h2>
                    </m.div>

                    {/* Grid */}
                    <BentoGrid columns={4} className="auto-rows-[300px]">
                        {/* Featured Item - Large Card */}
                        <BentoCard
                            size="2x2"
                            variant="image"
                            backgroundImage={featuredItem.image || "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?q=70&w=1280&auto=format&fit=crop"}
                            className="group cursor-pointer relative overflow-hidden"
                        >
                            <Link href={featuredItem.href as any} className="absolute inset-0 z-20">
                                <span className="sr-only">{featuredItem.title}</span>
                            </Link>
                            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent transition-opacity duration-500" />

                            <div className="relative z-10 h-full flex flex-col justify-end p-8">
                                <div className="w-12 h-12 rounded-xl bg-white/10 backdrop-blur-md flex items-center justify-center mb-6 border border-white/20 text-white">
                                    {featuredItem.icon}
                                </div>
                                <BentoTitle className="text-white text-3xl mb-3 group-hover:text-primary transition-colors duration-300">
                                    {featuredItem.title}
                                </BentoTitle>
                                <BentoDescription className="text-white/80 text-lg max-w-md line-clamp-3 group-hover:text-white transition-colors duration-300">
                                    {featuredItem.description}
                                </BentoDescription>

                                <div className="mt-6 flex items-center text-primary font-medium opacity-0 translate-y-4 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300">
                                    {viewProjectLabel} <ArrowRight className="ml-2 w-5 h-5" />
                                </div>
                            </div>
                        </BentoCard>

                        {/* Regular Items */}
                        {regularItems.slice(0, 4).map((item, index) => (
                            <BentoCard
                                key={index}
                                size="1x1"
                                variant="default"
                                className="group cursor-pointer hover:border-primary/50 transition-colors"
                            >
                                <Link href={item.href as any} className="flex flex-col h-full justify-between">
                                    <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300">
                                        {item.icon}
                                    </div>
                                    <div>
                                        <BentoTitle className="mb-2 group-hover:text-primary transition-colors">
                                            {item.title}
                                        </BentoTitle>
                                        <BentoDescription className="line-clamp-3">
                                            {item.description}
                                        </BentoDescription>
                                    </div>
                                </Link>
                            </BentoCard>
                        ))}
                    </BentoGrid>
                </div>
            </section>
        </MotionProvider>
    );
}
