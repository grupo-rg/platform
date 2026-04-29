import { getDictionary } from '@/lib/dictionaries';
import { Building2, Hammer, Wrench, Palette, Zap, FileCheck } from 'lucide-react';
import { constructMetadata } from '@/i18n/seo-utils';
import { OrganizationJsonLd, FAQJsonLd } from '@/components/seo/json-ld';
import { companyConfigService } from '@/backend/platform/application/company-config-service';

// New Modular Components
import { HeroHybrid as Hero } from '@/components/home/sections/hero-hybrid'; // Using HeroHybrid V3
import { PhilosophySection } from '@/components/home/sections/philosophy';
import { ExpertiseSection } from '@/components/home/sections/expertise';
import { NumbersSection } from '@/components/home/sections/numbers';
import { TerritoriesSection } from '@/components/home/sections/territories';
import { ContactStrip } from '@/components/home/sections/contact-strip';

// Keeping legacy components for now if needed, but primarily using new ones
import { FaqSection } from '@/components/home/faq-section';
import { ProcessSteps } from '@/components/home/process-steps';

// Service icons mapping
const serviceIcons: Record<string, React.ReactNode> = {
  'Obra Nueva': <Building2 className="w-8 h-8" />,
  'New Construction': <Building2 className="w-8 h-8" />,
  'Reformas Integrales': <Hammer className="w-8 h-8" />,
  'Complete Renovations': <Hammer className="w-8 h-8" />,
  'Mantenimiento': <Wrench className="w-8 h-8" />,
  'Maintenance': <Wrench className="w-8 h-8" />,
  'Interiorismo': <Palette className="w-8 h-8" />,
  'Interior Design': <Palette className="w-8 h-8" />,
  'Trabajos Especializados': <Zap className="w-8 h-8" />,
  'Specialized Works': <Zap className="w-8 h-8" />,
  'Gestión de Permisos': <FileCheck className="w-8 h-8" />,
  'Permit Management': <FileCheck className="w-8 h-8" />,
};

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const dict = await getDictionary(locale as any);
  const company = await companyConfigService.get();

  return constructMetadata({
    title: `${company.name} - Construcción y Reformas en Mallorca`,
    description: dict.home.hero.description || 'Reformas integrales de alta gama en Mallorca.',
    path: '/',
    locale
  });
}

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const dict = await getDictionary(locale as any);
  const t = dict.home;
  const company = await companyConfigService.get();

  // Clean data for props (remove HTML from strings if possible manually here or use raw strings)
  // For V2, we assume the translations are clean strings. If they have HTML, we strip it or handle it.
  // The new components assume plain text strings.

  // Expertise Items Transformation
  const expertiseItems = t.expertise?.items?.map((item: any, index: number) => ({
    ...item,
    icon: serviceIcons[item.title] || <Building2 className="w-8 h-8" />,
    href: item.link || '/services',
    featured: index === 0 // Force first item as featured
  })) || [];

  return (
    <>
      <OrganizationJsonLd />
      {t.faq?.items && <FAQJsonLd items={t.faq.items} />}
      <main className="flex-1 overflow-x-hidden">
        <Hero
          title={t.hero.title.replace(/<[^>]*>?/gm, ' ')} // Strip HTML tags for safety
          subtitle={t.hero.subtitle}
          description={t.hero.description}
          ctaText={t.hero.cta}
          ctaLink="/budget-request"
          secondaryCtaText={t.hero.ctaSecondary}
          secondaryCtaLink="/services"
          floatingCards={t.hero.floating}
        />

        <PhilosophySection
          quote={t.philosophy?.quote || "Construimos sueños, no solo paredes."}
          author={company.name}
          description={t.philosophy?.description}
          label={t.philosophy?.label}
        />

        <ExpertiseSection
          title={t.expertise?.title || "Nuestros Servicios"}
          subtitle={t.expertise?.subtitle || "Especialidades"}
          items={expertiseItems}
          viewProjectLabel={t.expertise?.viewProject}
        />

        <NumbersSection
          items={t.numbers?.items}
        />

        <ProcessSteps t={t.processSteps} />

        <TerritoriesSection
          title={t.territories?.title}
          description={t.territories?.description}
          locations={t.territories?.locations}
          label={t.territories?.label}
        />

        <FaqSection t={t.faq} />

        <ContactStrip t={t.contactStrip} />
      </main>
    </>
  );
}
