import { getDictionary } from '@/lib/dictionaries';
import { services } from '@/lib/services';
import { constructMetadata } from '@/i18n/seo-utils';
import { WebPageJsonLd, BreadcrumbJsonLd } from '@/components/seo/json-ld';
import Image from 'next/image';
import { Link } from '@/i18n/navigation';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ServiceCTA } from '@/components/services/service-cta';
import { companyConfigService } from '@/backend/platform/application/company-config-service';

import i18nConfig from '@/../i18nConfig';

export async function generateStaticParams() {
    return i18nConfig.locales.map(locale => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;
    const company = await companyConfigService.get();

    return constructMetadata({
        title: `Servicios de Construcción y Reformas en Mallorca - ${company.name}`,
        description: 'Descubre nuestros servicios: reformas integrales, piscinas, electricidad, fontanería, pintura, carpintería e impermeabilización en Mallorca.',
        path: '/services',
        locale
    });
}

export default async function ServicesPage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;
    const dict = await getDictionary(locale as any);
    const company = await companyConfigService.get();

    const navServices = dict.header?.nav?.services || 'Servicios';

    return (
        <>
            <WebPageJsonLd
                name="Servicios de Construcción y Reformas"
                description="Soluciones integrales de construcción, reformas e instalaciones en Mallorca y las Islas Baleares."
                url={`${company.web}/${locale}/services`}
                type="CollectionPage"
            />
            <BreadcrumbJsonLd items={[
                { name: 'Inicio', href: `/${locale}` },
                { name: navServices, href: `/${locale}/services` }
            ]} />

            <main className="flex-1 bg-background">
                {/* Modern Editorial Hero */}
                <section className="relative pt-40 pb-20 md:pt-48 md:pb-32 bg-[hsl(0,0%,3%)] text-white overflow-hidden">
                    {/* Abstract Background */}
                    <div className="absolute inset-0 overflow-hidden pointer-events-none">
                        <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-primary/5 rounded-full blur-[120px] -translate-y-1/2 translate-x-1/3" />
                        <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-indigo-500/5 rounded-full blur-[100px] translate-y-1/3 -translate-x-1/4" />
                        <div className="absolute inset-0 bg-[url('/noise.png')] opacity-[0.03] mix-blend-overlay" />
                    </div>

                    <div className="container-limited relative z-10">
                        <div className="max-w-4xl">
                            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-medium text-white/70 mb-8 backdrop-blur-sm">
                                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                                {company.name} Experience
                            </div>

                            <h1 className="font-headline text-5xl md:text-7xl lg:text-8xl font-bold tracking-tight mb-8 leading-[1.1]">
                                Excelencia en <br />
                                <span className="text-transparent bg-clip-text bg-gradient-to-r from-white via-white to-white/50">
                                    cada detalle
                                </span>
                            </h1>

                            <p className="text-white/60 text-lg md:text-xl leading-relaxed max-w-2xl border-l-2 border-primary/30 pl-6">
                                Soluciones integrales de construcción y reformas en Mallorca.
                                Combinamos artesanía tradicional con innovación técnica para crear
                                espacios que perduran.
                            </p>
                        </div>
                    </div>
                </section>

                {/* Staggered Bento Grid */}
                <section className="py-20 md:py-32">
                    <div className="container-limited">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 auto-rows-[350px]">
                            {services.map((service, index) => {
                                const categoryTranslation = dict.services?.[service.id];
                                // Layout logic:
                                // Index 0 (New Build) -> Large (2x2 or 2x1)
                                // Index 3 (Interiors) -> Wide
                                const isFeatured = index === 0;
                                const isWide = index === 3;

                                return (
                                    <Link
                                        key={service.id}
                                        href={{
                                            pathname: '/services/[category]/[subcategory]',
                                            params: {
                                                category: service.id,
                                                subcategory: service.subservices?.[0]?.id || 'general'
                                            }
                                        }}
                                        className={cn(
                                            "group relative overflow-hidden rounded-3xl bg-muted transition-all duration-500 hover:shadow-2xl hover:shadow-black/20",
                                            isFeatured ? "md:col-span-2 md:row-span-2 min-h-[500px]" : "",
                                            isWide ? "md:col-span-2" : ""
                                        )}
                                    >
                                        {/* Image Background */}
                                        <Image
                                            src={service.image}
                                            alt={categoryTranslation?.title || service.id}
                                            fill
                                            className="object-cover transition-transform duration-700 group-hover:scale-105 will-change-transform"
                                        />

                                        {/* Gradient Overlays */}
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent opacity-80 transition-opacity duration-300 group-hover:opacity-90" />
                                        <div className="absolute inset-0 bg-black/20 group-hover:bg-transparent transition-colors duration-300" />

                                        {/* Hover Border Effect */}
                                        <div className="absolute inset-0 border-2 border-white/0 group-hover:border-white/10 rounded-3xl transition-colors duration-300" />

                                        {/* Content */}
                                        <div className="absolute inset-0 p-8 md:p-10 flex flex-col justify-between">
                                            {/* Top: Icon + Count */}
                                            <div className="flex justify-between items-start opacity-100 transform translate-y-0 transition-all duration-300">
                                                <div className="p-3 rounded-xl bg-white/10 backdrop-blur-md border border-white/10 text-white group-hover:bg-primary group-hover:text-primary-foreground group-hover:border-primary transition-colors">
                                                    {service.icon}
                                                </div>
                                                <div className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-white/10 backdrop-blur-sm border border-white/10 text-xs font-bold text-white">
                                                    {service.subservices?.length || 0}
                                                </div>
                                            </div>

                                            {/* Bottom: Text + CTA */}
                                            <div className="transform translate-y-2 group-hover:translate-y-0 transition-transform duration-300">
                                                <h2 className={cn(
                                                    "font-headline font-bold text-white mb-3 text-shadow-sm",
                                                    isFeatured ? "text-4xl md:text-5xl" : "text-2xl md:text-3xl"
                                                )}>
                                                    {categoryTranslation?.title || service.id}
                                                </h2>

                                                {categoryTranslation?.shortDescription && (
                                                    <p className="text-white/70 text-base md:text-lg line-clamp-2 max-w-md mb-6 opacity-0 group-hover:opacity-100 transition-opacity duration-300 delay-75">
                                                        {categoryTranslation.shortDescription}
                                                    </p>
                                                )}

                                                <div className="inline-flex items-center gap-2 text-white font-medium group-hover:text-primary transition-colors">
                                                    <span className="uppercase tracking-widest text-xs">Explorar</span>
                                                    <ArrowRight className="h-4 w-4" />
                                                </div>
                                            </div>
                                        </div>
                                    </Link>
                                );
                            })}
                        </div>
                    </div>
                </section>

                {/* Bottom CTA Strip */}
                <section className="py-24 bg-foreground text-background relative overflow-hidden">
                    <div className="absolute inset-0 bg-[url('/noise.png')] opacity-[0.05]" />

                    <div className="container-limited relative z-10">
                        <div className="flex flex-col md:flex-row items-center justify-between gap-10 md:gap-20">
                            <div className="space-y-4 max-w-2xl">
                                <h2 className="font-headline text-4xl md:text-5xl font-bold tracking-tight text-background">
                                    ¿Tu proyecto no encaja en ninguna categoría?
                                </h2>
                                <p className="text-background/70 text-lg leading-relaxed">
                                    Cada espacio es un mundo. Cuéntanos tu idea a través de nuestro
                                    sistema inteligente y encontraremos la solución perfecta.
                                </p>
                            </div>

                            <div className="shrink-0">
                                <ServiceCTA
                                    ctaText="Consultar con IA"
                                    variant="inline"
                                    className="bg-background text-foreground hover:bg-background/90"
                                />
                            </div>
                        </div>
                    </div>
                </section>
            </main>
        </>
    );
}
