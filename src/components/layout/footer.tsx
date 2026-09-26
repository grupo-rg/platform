import { getLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Logo } from '@/components/logo';
import { companyConfigService } from '@/backend/platform/application/company-config-service';
import { getDictionary } from '@/lib/dictionaries';
import { services } from '@/lib/services';
import { locations } from '@/lib/locations';
import { getTranslatedCategorySlug, getTranslatedSubcategorySlug } from '@/lib/service-slugs';
import {
  CONTACT_PHONE_DISPLAY,
  CONTACT_WHATSAPP_URL,
  telHref,
} from '@/lib/contact';
import { MapPin, Mail, Phone, MessageCircle } from 'lucide-react';

/** Convierte "son-vida" → "Son Vida" cuando no hay traducción disponible. */
function prettify(slug: string) {
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export async function Footer({ t, locale: localeProp }: { t?: any; locale?: string }) {
  const currentYear = new Date().getFullYear();
  // El layout pasa el locale de la ruta; getLocale() es el fallback.
  const locale = localeProp ?? (await getLocale());
  const [company, dict] = await Promise.all([
    companyConfigService.get(),
    getDictionary(locale as any),
  ]);

  const phone = company.phone || CONTACT_PHONE_DISPLAY;
  const email = company.email;
  const navLabels = dict.header?.nav ?? {};

  // Marca unificada: UNA entidad con dos nombres. Mostramos el display combinado
  // para eliminar la ambigüedad "Grupo RG" vs "Constructores en Mallorca".
  const commercialName = company.alternateName ?? 'Constructores en Mallorca';
  const brandDisplay = commercialName ? `${company.name} | ${commercialName}` : company.name;

  // Silos de servicio: categoría → subservicios. La categoría enlaza a su primer
  // subservicio porque /services/[category] redirige a él.
  const serviceSilos = services.map((service) => {
    const translation = dict.services?.[service.id];
    const subservices = (service.subservices ?? []).map((sub) => ({
      id: sub.id,
      slug: getTranslatedSubcategorySlug(sub.id, locale),
      title: translation?.subservices?.[sub.id]?.title || prettify(sub.id),
    }));

    return {
      id: service.id,
      slug: getTranslatedCategorySlug(service.id, locale),
      title: translation?.title || prettify(service.id),
      subservices,
    };
  });

  const zones = locations.map((location) => ({
    name: location,
    slug: location.toLowerCase().replace(/\s+/g, '-'),
  }));

  // Etiquetas del bloque legal, localizadas (auto-contenidas, sin depender del
  // diccionario). Las rutas se resuelven vía pathnames localizados de routing.ts.
  const legalLabelsByLocale: Record<string, { heading: string; privacy: string; terms: string }> = {
    es: { heading: 'Legal', privacy: 'Privacidad', terms: 'Aviso legal' },
    en: { heading: 'Legal', privacy: 'Privacy', terms: 'Legal notice' },
    ca: { heading: 'Legal', privacy: 'Privacitat', terms: 'Avís legal' },
    de: { heading: 'Rechtliches', privacy: 'Datenschutz', terms: 'Impressum' },
    nl: { heading: 'Juridisch', privacy: 'Privacy', terms: 'Juridische kennisgeving' },
  };
  const legal = legalLabelsByLocale[locale] ?? legalLabelsByLocale.es;

  return (
    <footer className="w-full bg-[#0a0a0a] text-foreground border-t border-border">
      <div className="container mx-auto px-4 md:px-6 py-16">
        {/* Marca + contacto */}
        <div className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-4 flex flex-col gap-4">
            <Logo variant="light" className="mb-2" width={120} height={40} company={company} />
            <p className="text-sm font-semibold text-foreground/90">{brandDisplay}</p>
            {company.tagline && (
              <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
                {company.tagline}
              </p>
            )}
            <address className="not-italic text-sm text-muted-foreground space-y-2">
              {company.address && (
                <span className="flex items-start gap-2">
                  <MapPin className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                  <span>{company.address}</span>
                </span>
              )}
              <span className="flex items-center gap-2">
                <Phone className="h-4 w-4 shrink-0 text-primary" />
                <a href={telHref(phone)} className="hover:text-primary transition-colors font-medium">
                  {phone}
                </a>
              </span>
              <span className="flex items-center gap-2">
                <MessageCircle className="h-4 w-4 shrink-0 text-primary" />
                <a
                  href={CONTACT_WHATSAPP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-primary transition-colors"
                >
                  WhatsApp
                </a>
              </span>
              {email && (
                <span className="flex items-center gap-2">
                  <Mail className="h-4 w-4 shrink-0 text-primary" />
                  <a href={`mailto:${email}`} className="hover:text-primary transition-colors">
                    {email}
                  </a>
                </span>
              )}
            </address>
          </div>

          {/* Silos de servicios — interlinking */}
          <nav aria-label="Servicios" className="lg:col-span-8">
            <h2 className="font-headline font-semibold text-primary mb-6">
              {navLabels.services || 'Servicios'}
            </h2>
            <div className="grid gap-8 sm:grid-cols-2 xl:grid-cols-3">
              {serviceSilos.map((silo) => (
                <div key={silo.id} className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground/90">
                    <Link
                      href={{
                        pathname: '/services/[category]/[subcategory]',
                        params: {
                          category: silo.slug,
                          subcategory: silo.subservices[0]?.slug || 'general',
                        },
                      }}
                      className="hover:text-primary transition-colors"
                    >
                      {silo.title}
                    </Link>
                  </h3>
                  <ul className="space-y-1.5">
                    {silo.subservices.map((sub) => (
                      <li key={sub.id}>
                        <Link
                          href={{
                            pathname: '/services/[category]/[subcategory]',
                            params: { category: silo.slug, subcategory: sub.slug },
                          }}
                          className="text-xs text-muted-foreground hover:text-primary transition-colors leading-snug"
                        >
                          {sub.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </nav>
        </div>

        {/* Zonas + navegación + legal */}
        <div className="mt-14 pt-10 border-t border-border/60 grid gap-10 md:grid-cols-2 lg:grid-cols-4">
          <nav aria-label="Zonas de actuación" className="lg:col-span-2">
            <h2 className="font-headline font-semibold text-primary mb-4">Zonas de actuación</h2>
            <ul className="flex flex-wrap gap-x-4 gap-y-2">
              {zones.map((zone) => (
                <li key={zone.slug}>
                  <Link
                    href={{ pathname: '/zonas/[zone]', params: { zone: zone.slug } }}
                    className="text-sm text-muted-foreground hover:text-primary transition-colors"
                  >
                    {zone.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Navegación">
            <h2 className="font-headline font-semibold text-primary mb-4">Navegación</h2>
            <ul className="space-y-2">
              <li>
                <Link href="/" className="text-sm text-muted-foreground hover:text-primary transition-colors">
                  Inicio
                </Link>
              </li>
              <li>
                <Link href="/services" className="text-sm text-muted-foreground hover:text-primary transition-colors">
                  {navLabels.services || 'Servicios'}
                </Link>
              </li>
              <li>
                <Link href="/budget-request" className="text-sm text-muted-foreground hover:text-primary transition-colors">
                  {navLabels.budgetRequest || 'Presupuesto al instante'}
                </Link>
              </li>
              <li>
                <Link href="/blog" className="text-sm text-muted-foreground hover:text-primary transition-colors">
                  {navLabels.blog || 'Blog'}
                </Link>
              </li>
              <li>
                <Link href="/contact" className="text-sm text-muted-foreground hover:text-primary transition-colors">
                  {navLabels.contact || 'Contacto'}
                </Link>
              </li>
            </ul>
          </nav>

          <nav aria-label={legal.heading}>
            <h2 className="font-headline font-semibold text-primary mb-4">{legal.heading}</h2>
            <ul className="space-y-2">
              <li>
                <Link
                  href="/privacy"
                  className="text-sm text-muted-foreground hover:text-primary transition-colors"
                >
                  {legal.privacy}
                </Link>
              </li>
              <li>
                <Link
                  href="/terms"
                  className="text-sm text-muted-foreground hover:text-primary transition-colors"
                >
                  {legal.terms}
                </Link>
              </li>
            </ul>
          </nav>
        </div>

        {/* Pie legal */}
        <div className="mt-10 pt-6 border-t border-border/60 flex flex-col md:flex-row items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            &copy; {currentYear} {company.legalName || company.name}.
          </p>
          {company.cif && <p className="text-xs text-muted-foreground">CIF: {company.cif}</p>}
        </div>
      </div>
    </footer>
  );
}
