'use client';

import * as React from 'react';
import { Link } from '@/i18n/navigation';
import { useLocale } from 'next-intl';
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from '@/components/ui/accordion';
import { services } from '@/lib/services';
import { locations } from '@/lib/locations';
import { getTranslatedCategorySlug, getTranslatedSubcategorySlug } from '@/lib/service-slugs';
import { SheetClose } from '@/components/ui/sheet';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/button';

// El wizard de presupuesto (BudgetRequestWizard + createBudgetAction + backend)
// es pesado y va tras un click. Se difiere con next/dynamic para no arrastrarlo
// al compile/bundle de TODAS las rutas públicas (el MobileMenu vive en el Header).
const BudgetWidget = dynamic(
    () => import('@/components/budget-widget').then((m) => m.BudgetWidget),
    {
        ssr: false,
        loading: () => <div className="h-12 w-full animate-pulse rounded-md bg-primary/20" />,
    }
);
import { CONTACT_PHONE_DISPLAY, CONTACT_PHONE_HREF, CONTACT_WHATSAPP_URL } from '@/lib/contact';
import { Phone, MessageCircle, ArrowRight } from 'lucide-react';

interface MobileMenuProps {
    t: any;
    onLinkClick: () => void;
    user: any;
}

/** Rótulo de sección: pequeño, en mayúsculas y sin peso visual. */
function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <p className="px-6 pt-6 pb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground/60">
            {children}
        </p>
    );
}

/** Enlace de primer nivel del menú. */
function NavRow({
    href,
    children,
    onLinkClick,
}: {
    href: any;
    children: React.ReactNode;
    onLinkClick: () => void;
}) {
    return (
        <SheetClose asChild>
            <Link
                href={href}
                onClick={onLinkClick}
                className="flex items-center justify-between px-6 py-3.5 text-[15px] text-foreground transition-colors hover:text-primary"
            >
                {children}
            </Link>
        </SheetClose>
    );
}

export function MobileMenu({ t, onLinkClick, user }: MobileMenuProps) {
    const locale = useLocale();
    const nav = t?.header?.nav ?? {};

    // Slugs traducidos: en en/ca/de/nl la URL correcta no es el id en español.
    const serviceSilos = React.useMemo(
        () =>
            services.map((service) => {
                const translation = t?.services?.[service.id];
                return {
                    id: service.id,
                    slug: getTranslatedCategorySlug(service.id, locale),
                    title: translation?.title || service.id,
                    subservices: (service.subservices ?? []).map((sub) => ({
                        id: sub.id,
                        slug: getTranslatedSubcategorySlug(sub.id, locale),
                        title: translation?.subservices?.[sub.id]?.title || sub.id,
                    })),
                };
            }),
        [t, locale]
    );

    const zones = React.useMemo(
        () =>
            locations.map((location) => ({
                name: location,
                slug: location.toLowerCase().replace(/\s+/g, '-'),
            })),
        []
    );

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4">
                <SectionLabel>{nav.services || 'Servicios'}</SectionLabel>

                <Accordion type="single" collapsible className="w-full">
                    {serviceSilos.map((silo) => (
                        <AccordionItem
                            key={silo.id}
                            value={silo.id}
                            className="border-b border-border/40"
                        >
                            <AccordionTrigger className="px-6 py-3.5 text-[15px] font-normal text-foreground hover:no-underline hover:text-primary [&>svg]:text-muted-foreground/50">
                                {silo.title}
                            </AccordionTrigger>
                            <AccordionContent className="px-6 pb-3 pt-0">
                                <div className="ml-1 flex flex-col border-l border-border/60 pl-4">
                                    {silo.subservices.map((sub) => (
                                        <SheetClose asChild key={sub.id}>
                                            <Link
                                                href={{
                                                    pathname: '/services/[category]/[subcategory]',
                                                    params: { category: silo.slug, subcategory: sub.slug },
                                                }}
                                                onClick={onLinkClick}
                                                className="py-2 text-sm leading-snug text-muted-foreground transition-colors hover:text-primary"
                                            >
                                                {sub.title}
                                            </Link>
                                        </SheetClose>
                                    ))}
                                </div>
                            </AccordionContent>
                        </AccordionItem>
                    ))}
                </Accordion>

                <SheetClose asChild>
                    <Link
                        href="/services"
                        onClick={onLinkClick}
                        className="group flex items-center gap-2 px-6 py-3.5 text-sm font-medium text-primary"
                    >
                        {t?.header?.megaMenu?.viewAll || 'Ver todos los servicios'}
                        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                    </Link>
                </SheetClose>

                <SectionLabel>Navegación</SectionLabel>
                <div className="flex flex-col">
                    <NavRow href="/" onLinkClick={onLinkClick}>
                        Inicio
                    </NavRow>
                    <NavRow href="/budget-request" onLinkClick={onLinkClick}>
                        {nav.budgetRequest || 'Presupuesto al instante'}
                    </NavRow>
                    <NavRow href="/blog" onLinkClick={onLinkClick}>
                        {nav.blog || 'Blog'}
                    </NavRow>
                    <NavRow href="/contact" onLinkClick={onLinkClick}>
                        {nav.contact || 'Contacto'}
                    </NavRow>
                    {user ? (
                        <NavRow href="/dashboard" onLinkClick={onLinkClick}>
                            {t?.header?.userNav?.dashboard || 'Panel'}
                        </NavRow>
                    ) : (
                        <NavRow href="/login" onLinkClick={onLinkClick}>
                            {nav.login || 'Iniciar Sesión'}
                        </NavRow>
                    )}
                </div>

                <SectionLabel>Zonas</SectionLabel>
                <div className="flex flex-wrap gap-x-2 gap-y-1 px-6 pb-2">
                    {zones.map((zone) => (
                        <SheetClose asChild key={zone.slug}>
                            <Link
                                href={{ pathname: '/zonas/[zone]', params: { zone: zone.slug } }}
                                onClick={onLinkClick}
                                className="rounded-full border border-border/50 px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                            >
                                {zone.name}
                            </Link>
                        </SheetClose>
                    ))}
                </div>
            </div>

            {/* Pie fijo: acción principal y contacto directo */}
            <div className="shrink-0 border-t border-border/40 bg-background/80 px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur">
                <BudgetWidget
                    t={t}
                    trigger={
                        <Button className="h-12 w-full gap-2 text-base font-semibold" size="lg">
                            {nav.budgetRequest || 'Presupuesto al instante'}
                        </Button>
                    }
                />
                <div className="mt-3 flex items-center justify-between text-sm">
                    <a
                        href={CONTACT_PHONE_HREF}
                        className="flex items-center gap-2 text-muted-foreground transition-colors hover:text-primary"
                    >
                        <Phone className="h-4 w-4 text-primary" />
                        {CONTACT_PHONE_DISPLAY}
                    </a>
                    <a
                        href={CONTACT_WHATSAPP_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="WhatsApp"
                        className="flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-primary"
                    >
                        <MessageCircle className="h-4 w-4 text-primary" />
                        WhatsApp
                    </a>
                </div>
            </div>
        </div>
    );
}
