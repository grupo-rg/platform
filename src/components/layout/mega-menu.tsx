'use client';

import * as React from 'react';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { services } from '@/lib/services';
import { ChevronDown, ArrowRight } from 'lucide-react';
import { useLocale } from 'next-intl';
import { getTranslatedCategorySlug, getTranslatedSubcategorySlug } from '@/lib/service-slugs';

export function MegaMenu({ t }: { t: any }) {
    const locale = useLocale();
    const [isOpen, setIsOpen] = React.useState(false);
    const timeoutRef = React.useRef<NodeJS.Timeout | null>(null);

    const handleMouseEnter = () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setIsOpen(true);
    };

    const handleMouseLeave = () => {
        timeoutRef.current = setTimeout(() => {
            setIsOpen(false);
        }, 200);
    };

    return (
        <nav className="flex items-center gap-6" onMouseLeave={handleMouseLeave}>
            <div className="" onMouseEnter={handleMouseEnter}>
                <button
                    className={cn(
                        "flex items-center gap-1 text-sm font-bold transition-colors hover:text-primary font-headline tracking-wide py-2 outline-none",
                        isOpen ? "text-primary" : "text-foreground/80"
                    )}
                    aria-expanded={isOpen}
                >
                    {t.header?.nav?.services || "Servicios"}
                    <ChevronDown
                        className={cn(
                            "h-4 w-4 transition-transform duration-200",
                            isOpen ? "rotate-180" : ""
                        )}
                    />
                </button>

                <AnimatePresence>
                    {isOpen && (
                        <motion.div
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 8 }}
                            transition={{ duration: 0.18, ease: "easeOut" }}
                            className="fixed left-0 right-0 top-[72px] w-full z-50 flex justify-center pointer-events-none"
                        >
                            <div className="w-full max-w-6xl mx-auto px-4 pointer-events-auto">
                                <div className="w-full rounded-2xl border border-border/40 bg-background shadow-2xl shadow-black/10 p-5 overflow-hidden">
                                    {/* Compact Bento Grid — 5 columns */}
                                    <div className="grid grid-cols-5 gap-3 auto-rows-[100px]">
                                        {services.map((service, index) => {
                                            // First service: featured, spans 2 cols + 2 rows
                                            const isFeatured = index === 0;

                                            return (
                                                <Link
                                                    key={service.id}
                                                    href={{
                                                        pathname: '/services/[category]/[subcategory]',
                                                        params: {
                                                            category: getTranslatedCategorySlug(service.id, locale),
                                                            subcategory: getTranslatedSubcategorySlug(service.subservices?.[0]?.id || 'general', locale)
                                                        }
                                                    }}
                                                    onClick={() => setIsOpen(false)}
                                                    className={cn(
                                                        "group relative rounded-xl border transition-all duration-300 overflow-hidden",
                                                        isFeatured
                                                            ? "col-span-2 row-span-2 border-primary/20 bg-stone-900 hover:border-primary/50"
                                                            : "col-span-1 row-span-1 border-border/30 bg-muted/30 hover:bg-muted/60 hover:border-primary/30"
                                                    )}
                                                >
                                                    {/* Background for featured card */}
                                                    {isFeatured && service.image && (
                                                        <>
                                                            <div
                                                                className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-105"
                                                                style={{ backgroundImage: `url(${service.image})` }}
                                                            />
                                                            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/60 to-black/30" />
                                                        </>
                                                    )}

                                                    <div className={cn(
                                                        "relative z-10 h-full flex flex-col p-4",
                                                        isFeatured ? "justify-end" : "justify-between"
                                                    )}>
                                                        {/* Icon */}
                                                        <div className={cn(
                                                            "flex items-center justify-between",
                                                            isFeatured && "hidden"
                                                        )}>
                                                            <div className={cn(
                                                                "p-2 rounded-lg transition-colors duration-200",
                                                                "text-muted-foreground group-hover:text-primary bg-background/60 group-hover:bg-primary/10"
                                                            )}>
                                                                {service.icon}
                                                            </div>
                                                            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/30 -translate-x-1 opacity-0 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200" />
                                                        </div>

                                                        {/* Title + description */}
                                                        <div className={isFeatured ? "space-y-1.5" : "mt-auto"}>
                                                            {isFeatured && (
                                                                <div className="p-2 rounded-lg bg-white/10 backdrop-blur-sm text-white w-fit mb-3">
                                                                    {service.icon}
                                                                </div>
                                                            )}
                                                            <h4 className={cn(
                                                                "font-bold font-headline leading-tight transition-colors",
                                                                isFeatured
                                                                    ? "text-xl text-white"
                                                                    : "text-[13px] group-hover:text-foreground text-foreground/80"
                                                            )}>
                                                                {t.services?.[service.id]?.title || service.id}
                                                            </h4>
                                                            {isFeatured && (
                                                                <p className="text-white/70 text-sm line-clamp-2">
                                                                    {t.services?.[service.id]?.shortDescription}
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>
                                                </Link>
                                            );
                                        })}
                                    </div>

                                    {/* Bottom bar */}
                                    <div className="mt-4 pt-3 border-t border-border/30 flex justify-between items-center">
                                        <p className="text-xs text-muted-foreground">
                                            {t.header?.megaMenu?.description || "Servicios premium de construcción y reformas en Mallorca."}
                                        </p>
                                        <Link
                                            href="/services"
                                            onClick={() => setIsOpen(false)}
                                            className="inline-flex items-center text-xs font-bold text-foreground hover:text-primary transition-colors gap-1.5"
                                        >
                                            {t.header?.megaMenu?.viewAll || "Ver todos los servicios"}
                                            <ArrowRight className="h-3.5 w-3.5" />
                                        </Link>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            <Link href="/blog" className="text-sm font-bold text-foreground/80 hover:text-primary transition-colors font-headline tracking-wide">
                {t.header?.nav?.blog || "Blog"}
            </Link>

            <Link href="/contact" className="text-sm font-bold text-foreground/80 hover:text-primary transition-colors font-headline tracking-wide">
                {t.header?.nav?.contact || "Contacto"}
            </Link>
        </nav>
    );
}
