import { services } from '@/lib/services';
import { notFound } from 'next/navigation';
import { getDictionary } from '@/lib/dictionaries';
import { InterlinkingCloud } from '@/components/seo/interlinking-cloud';
import { ProcessTimeline } from '@/components/services/process-timeline';
import { FAQSection } from '@/components/services/faq-section';
import Image from 'next/image';
import { ChevronRight, CheckCircle2, ArrowRight } from 'lucide-react';
import type { Metadata } from 'next';
import { constructMetadata } from '@/i18n/seo-utils';
import { ServiceJsonLd, BreadcrumbJsonLd } from '@/components/seo/json-ld';
import { ServiceCTA } from '@/components/services/service-cta';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import i18nConfig from '@/../i18nConfig';
import { getOriginalCategoryId, getOriginalSubcategoryId, getTranslatedCategorySlug, getTranslatedSubcategorySlug } from '@/lib/service-slugs';

export async function generateStaticParams() {
    const params: { locale: string; category: string; subcategory: string }[] = [];

    // Iterate through all locales defined in config
    const locales = i18nConfig.locales;

    services.forEach((service) => {
        if (service.subservices) {
            service.subservices.forEach((sub) => {
                locales.forEach(locale => {
                    params.push({
                        locale,
                        category: getTranslatedCategorySlug(service.id, locale),
                        subcategory: getTranslatedSubcategorySlug(sub.id, locale)
                    });
                });
            });
        }
    });

    return params;
}

export async function generateMetadata({ params }: { params: Promise<{ category: string, subcategory: string, locale: string }> }): Promise<Metadata> {
    const { category, subcategory, locale } = await params;
    
    // Reverse translate slugs to original IDs
    const categoryId = getOriginalCategoryId(category, locale);
    const subcategoryId = getOriginalSubcategoryId(subcategory, locale);

    const service = services.find((s) => s.id === categoryId);
    const dict = await getDictionary(locale as any);

    if (!service) return {};

    const categoryTranslation = dict.services?.[categoryId];
    const subserviceTranslation = categoryTranslation?.subservices?.[subcategoryId];

    if (!subserviceTranslation) return {};

    return constructMetadata({
        title: `${subserviceTranslation.title} en Mallorca | ${categoryTranslation.title} - Grupo RG`,
        description: subserviceTranslation.description,
        image: service.image,
        path: '/services/[category]/[subcategory]',
        locale,
        params: { category, subcategory }
    });
}

export default async function SubServicePage({ params }: { params: Promise<{ category: string, subcategory: string, locale: string }> }) {
    const { category, subcategory, locale } = await params;
    
    // Reverse translate slugs to original IDs
    const categoryId = getOriginalCategoryId(category, locale);
    const subcategoryId = getOriginalSubcategoryId(subcategory, locale);

    const service = services.find((s) => s.id === categoryId);
    const dict = await getDictionary(locale as any);

    if (!service) notFound();

    const categoryTranslation = dict.services?.[categoryId];
    const subserviceTranslation = categoryTranslation?.subservices?.[subcategoryId];

    if (!subserviceTranslation) {
        notFound();
    }

    const breadcrumbItems = [
        { name: 'Inicio', href: `/${locale}` },
        { name: dict.header?.nav?.services || 'Servicios', href: `/${locale}/services` },
        { name: categoryTranslation.title, href: `/${locale}/services/${category}` }, // This might redirect or 404 if not handled, but good for SEO structure
        { name: subserviceTranslation.title, href: `/${locale}/services/${category}/${subcategory}` }
    ];

    return (
        <>
            <ServiceJsonLd
                name={subserviceTranslation.title}
                description={subserviceTranslation.description}
                category={categoryTranslation.title}
                image={service.image}
                areaServed="Mallorca, Islas Baleares"
            />
            <BreadcrumbJsonLd items={breadcrumbItems} />

            <main className="flex-1 bg-background">
                {/* Cinematic Hero */}
                <section className="relative h-[60vh] min-h-[500px] w-full flex items-end pb-16 overflow-hidden">
                    <Image
                        src={service.image}
                        alt={`${subserviceTranslation.title} en Mallorca - Grupo RG`}
                        fill
                        className="object-cover animate-in fade-in duration-1000"
                        priority
                    />
                    {/* Elaborate Gradient Overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
                    <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-background to-transparent" />

                    <div className="relative container-limited w-full space-y-6 z-10">
                        {/* Breadcrumb */}
                        <nav className="flex items-center flex-wrap text-sm text-muted-foreground/80 gap-2 mb-4 animate-in slide-in-from-bottom-4 duration-700 delay-100" aria-label="Breadcrumb">
                            <Link href="/" className="hover:text-primary transition-colors">Inicio</Link>
                            <ChevronRight className="h-3 w-3" />
                            <Link href="/services" className="hover:text-primary transition-colors">
                                {dict.header?.nav?.services || 'Servicios'}
                            </Link>
                            <ChevronRight className="h-3 w-3" />
                            <span className="text-foreground font-medium">
                                {subserviceTranslation.title}
                            </span>
                        </nav>

                        <div className="max-w-4xl space-y-6">
                            <h1 className="font-headline text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.1] animate-in slide-in-from-bottom-6 duration-700 delay-200">
                                {subserviceTranslation.title}
                            </h1>

                            <p className="text-xl md:text-2xl text-muted-foreground font-light leading-relaxed max-w-2xl animate-in slide-in-from-bottom-8 duration-700 delay-300">
                                {subserviceTranslation.description}
                            </p>

                            <div className="pt-4 animate-in slide-in-from-bottom-10 duration-700 delay-400">
                                <div className="h-1 w-24 bg-primary rounded-full" />
                            </div>
                        </div>
                    </div>
                </section>

                {/* Main Content Layout */}
                <section className="py-16 md:py-24">
                    <div className="container-limited">
                        <div className="grid lg:grid-cols-12 gap-12 lg:gap-20">

                            {/* Left Column: Content */}
                            <div className="lg:col-span-7 space-y-16">
                                {/* Bio / Intro */}
                                <div className="prose prose-lg prose-slate dark:prose-invert max-w-none">
                                    <p className="text-lg leading-relaxed text-muted-foreground">
                                        En <strong className="text-foreground font-medium">Grupo RG</strong>, abordamos cada proyecto de
                                        {' '}<span className="lowercase">{subserviceTranslation.title}</span> como una oportunidad para crear algo excepcional.
                                        Combinamos décadas de experiencia técnica con una gestión eficiente para garantizar resultados que superan las expectativas.
                                    </p>
                                    <p className="text-lg leading-relaxed text-muted-foreground">
                                        Nuestro enfoque integral asegura que cada detalle, desde la planificación inicial hasta los acabados finales,
                                        esté perfectamente coordinado. Sin sorpresas, con plazos garantizados y total transparencia.
                                    </p>
                                </div>

                                {/* Why Choose Us Grid */}
                                <div className="bg-muted/30 rounded-3xl p-8 md:p-10 border border-border/50">
                                    <h2 className="font-headline text-2xl font-bold mb-8 flex items-center gap-3">
                                        <div className="p-2 rounded-lg bg-primary/10 text-primary">
                                            <CheckCircle2 className="h-6 w-6" />
                                        </div>
                                        Por qué elegirnos
                                    </h2>
                                    <div className="grid sm:grid-cols-2 gap-x-8 gap-y-6">
                                        {[
                                            'Presupuesto cerrado sin sorpresas',
                                            'Plazos de entrega garantizados',
                                            'Materiales certificados de primera calidad',
                                            'Equipo técnico propio especializado',
                                            'Gestión integral de permisos',
                                            'Garantía post-obra extendida'
                                        ].map((item, i) => (
                                            <div key={i} className="flex items-start gap-3 group">
                                                <div className="h-2 w-2 rounded-full bg-primary mt-2.5 shrink-0 group-hover:scale-125 transition-transform duration-300 shadow-[0_0_8px_rgba(var(--primary),0.5)]" />
                                                <span className="text-foreground/80 font-medium">{item}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {/* Right Column: Sticky Sidebar */}
                            <aside className="lg:col-span-5 space-y-10">
                                {/* Sticky Wrapper */}
                                <div className="sticky top-24 space-y-10">
                                    {/* Primary CTA */}
                                    <ServiceCTA
                                        title={`¿Empezamos con tu proyecto?`}
                                        description={`Calcula el precio de tu proyecto de ${subserviceTranslation.title.toLowerCase()} en segundos con nuestra IA.`}
                                        ctaText="Calcular Presupuesto"
                                        category={category}
                                    />

                                    {/* Other Services Navigation */}
                                    {service.subservices && service.subservices.filter(s => s.id !== subcategory).length > 0 && (
                                        <div className="rounded-2xl border border-border/50 bg-background p-6 shadow-sm">
                                            <h3 className="font-headline font-bold text-lg mb-4 pb-4 border-b">
                                                Más en {categoryTranslation.title}
                                            </h3>
                                            <nav className="space-y-1">
                                                {service.subservices.filter(s => s.id !== subcategoryId).map(sibling => (
                                                    <Link
                                                        key={sibling.id}
                                                        href={{
                                                            pathname: '/services/[category]/[subcategory]',
                                                            params: { category, subcategory: getTranslatedSubcategorySlug(sibling.id, locale) }
                                                        }}
                                                        className="group flex items-center justify-between p-3 rounded-xl hover:bg-muted/50 transition-colors"
                                                    >
                                                        <span className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                                                            {categoryTranslation.subservices?.[sibling.id]?.title || sibling.id}
                                                        </span>
                                                        <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-all">
                                                            <ChevronRight className="h-4 w-4" />
                                                        </div>
                                                    </Link>
                                                ))}
                                            </nav>
                                        </div>
                                    )}
                                </div>
                            </aside>

                        </div>
                    </div>
                </section>

                {/* Full Width Process Section */}
                {dict.services?.common?.process && (
                    <div className="border-t border-border/50">
                        <ProcessTimeline t={dict.services.common.process} className="bg-muted/10" />
                    </div>
                )}

                {/* FAQ Section */}
                {dict.services?.common?.faq && (
                    <div className="border-t border-border/50">
                        <FAQSection t={dict.services.common.faq} />
                    </div>
                )}

                {/* SEO Cloud (Hidden visually or subtle) */}
                <div className="container-limited py-10 opacity-50 grayscale hover:grayscale-0 transition-all duration-500">
                    <InterlinkingCloud
                        serviceName={subserviceTranslation.title}
                        categorySlug={category}
                    />
                </div>
            </main>
        </>
    );
}
