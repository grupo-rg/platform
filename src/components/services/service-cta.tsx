'use client';

import { useWidgetContext } from '@/context/budget-widget-context';
import { Button } from '@/components/ui/button';
import { ArrowRight, Phone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CONTACT_PHONE_DISPLAY, CONTACT_PHONE_HREF } from '@/lib/contact';

interface ServiceCTAProps {
    title?: string;
    description?: string;
    ctaText: string;
    category?: string;
    variant?: 'card' | 'inline';
    className?: string;
}

export function ServiceCTA({
    title,
    description,
    ctaText,
    category,
    variant = 'card',
    className
}: ServiceCTAProps) {
    const { openWidget } = useWidgetContext();

    if (variant === 'inline') {
        return (
            <Button
                onClick={() => openWidget('general')}
                size="lg"
                className={cn(
                    "font-bold text-base px-8 py-6 h-auto shadow-lg hover:shadow-primary/20 transition-all duration-300 bg-primary hover:bg-primary/90 text-primary-foreground group",
                    className
                )}
            >
                {ctaText}
                <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
            </Button>
        );
    }

    return (
        <div className={cn(
            "rounded-2xl border border-border/50 bg-background/80 backdrop-blur-xl p-8 shadow-2xl shadow-black/5 sticky top-24 space-y-6",
            className
        )}>
            {title && (
                <div className="space-y-2">
                    <h3 className="font-headline text-2xl font-bold tracking-tight">
                        {title}
                    </h3>
                    <div className="h-1 w-12 bg-primary rounded-full" />
                </div>
            )}

            {description && (
                <p className="text-muted-foreground text-base leading-relaxed">
                    {description}
                </p>
            )}

            <Button
                onClick={() => openWidget('general')}
                className="w-full font-bold text-base py-6 h-auto shadow-md hover:shadow-xl hover:shadow-primary/20 transition-all duration-300 group"
            >
                {ctaText}
                <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
            </Button>

            <div className="pt-6 border-t border-border/50 text-center">
                <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium mb-2">
                    Llámanos directamente
                </p>
                <a
                    href={CONTACT_PHONE_HREF}
                    className="inline-flex items-center justify-center gap-2 font-headline font-bold text-xl hover:text-primary transition-colors text-foreground"
                >
                    <Phone className="h-4 w-4 text-primary" />
                    {CONTACT_PHONE_DISPLAY}
                </a>
            </div>
        </div>
    );
}
