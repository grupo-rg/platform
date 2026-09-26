import type { Metadata } from 'next';
import { Link } from '@/i18n/navigation';
import { constructMetadata } from '@/i18n/seo-utils';
import { companyConfigService } from '@/backend/platform/application/company-config-service';
import { CONTACT_PHONE_DISPLAY, telHref } from '@/lib/contact';
import { Scale, Info } from 'lucide-react';
import i18nConfig from '@/../i18nConfig';
import { termsContent, TERMS_LAST_UPDATED, type TermsContent } from './terms-content';
import { privacyContent } from '../privacy/privacy-content';

/*
 * ⚠️ CONTENIDO PLANTILLA — pendiente de revisión jurídica.
 * El texto legal vive en ./terms-content.ts (ver aviso en cabecera de ese
 * fichero). Debe ser validado por un profesional antes de considerarse oficial.
 * Página INDEXABLE a propósito (sin noindex): las páginas legales deben indexarse.
 */

export async function generateStaticParams() {
  return i18nConfig.locales.map((locale) => ({ locale }));
}

function getContent(locale: string): TermsContent {
  return termsContent[locale] ?? termsContent.es;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const [company, t] = await Promise.all([
    companyConfigService.get(),
    Promise.resolve(getContent(locale)),
  ]);

  return constructMetadata({
    title: `${t.metaTitle} | ${company.name}`,
    description: t.metaDescription,
    path: '/terms',
    locale,
  });
}

export default async function TermsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = getContent(locale);
  const company = await companyConfigService.get();

  const identityFields: { label: string; value: string; href?: string }[] = [
    { label: t.owner.labels.legalName, value: company.legalName || company.name },
    company.cif ? { label: t.owner.labels.cif, value: company.cif } : null,
    company.address ? { label: t.owner.labels.address, value: company.address } : null,
    company.email
      ? { label: t.owner.labels.email, value: company.email, href: `mailto:${company.email}` }
      : null,
    {
      label: t.owner.labels.phone,
      value: company.phone || CONTACT_PHONE_DISPLAY,
      href: telHref(company.phone || CONTACT_PHONE_DISPLAY),
    },
    company.web ? { label: t.owner.labels.web, value: company.web, href: company.web } : null,
  ].filter(Boolean) as { label: string; value: string; href?: string }[];

  const formattedDate = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(TERMS_LAST_UPDATED));

  return (
    <main className="flex-1 bg-background">
      {/* Cabecera */}
      <section className="relative pt-36 pb-14 md:pt-44 md:pb-20 bg-[hsl(0,0%,3%)] text-white overflow-hidden">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-primary/5 rounded-full blur-[120px] -translate-y-1/3 translate-x-1/4" />
        </div>
        <div className="container mx-auto px-4 md:px-6 relative z-10">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-medium text-white/70 mb-6 backdrop-blur-sm">
              <Scale className="h-3.5 w-3.5 text-primary" />
              LSSI-CE · España
            </div>
            <h1 className="font-headline text-4xl md:text-6xl font-bold tracking-tight mb-6 leading-[1.1]">
              {t.title}
            </h1>
            <p className="text-white/60 text-base md:text-lg leading-relaxed border-l-2 border-primary/30 pl-5">
              {t.intro}
            </p>
            <p className="mt-6 text-xs text-white/40">
              {t.updatedLabel}: {formattedDate}
            </p>
          </div>
        </div>
      </section>

      {/* Contenido */}
      <section className="py-14 md:py-20">
        <div className="container mx-auto px-4 md:px-6">
          <div className="max-w-3xl mx-auto space-y-12">
            {/* Aviso de plantilla (discreto) */}
            <div className="flex items-start gap-3 rounded-2xl border border-border/60 bg-secondary/30 p-4 text-sm text-muted-foreground">
              <Info className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
              <p>{t.templateNotice}</p>
            </div>

            {/* Datos identificativos del titular (NAP desde CompanyConfig) */}
            <section className="space-y-4">
              <h2 className="font-headline text-2xl md:text-3xl font-semibold text-foreground">
                {t.owner.heading}
              </h2>
              <p className="text-muted-foreground leading-relaxed">{t.owner.intro}</p>
              <dl className="grid gap-3 rounded-2xl border border-border/60 bg-card/40 p-6 sm:grid-cols-2">
                {identityFields.map((field) => (
                  <div key={field.label} className="flex flex-col">
                    <dt className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                      {field.label}
                    </dt>
                    <dd className="text-sm font-medium text-foreground break-words">
                      {field.href ? (
                        <a
                          href={field.href}
                          className="hover:text-primary transition-colors"
                          {...(field.href.startsWith('http')
                            ? { target: '_blank', rel: 'noopener noreferrer' }
                            : {})}
                        >
                          {field.value}
                        </a>
                      ) : (
                        field.value
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="text-xs text-muted-foreground">{t.owner.fallbackNote}</p>
            </section>

            {/* Secciones */}
            {t.sections.map((sec) => (
              <section key={sec.heading} className="space-y-4">
                <h2 className="font-headline text-2xl md:text-3xl font-semibold text-foreground">
                  {sec.heading}
                </h2>
                {sec.paragraphs?.map((p, i) => (
                  <p key={i} className="text-muted-foreground leading-relaxed">
                    {p}
                  </p>
                ))}
                {sec.list && (
                  <ul className="list-disc space-y-2 pl-5 text-muted-foreground marker:text-primary">
                    {sec.list.map((item, i) => (
                      <li key={i} className="leading-relaxed">
                        {item}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}

            {/* Enlace cruzado a la política de privacidad */}
            <div className="pt-4 border-t border-border/60">
              <Link
                href="/privacy"
                className="text-sm font-medium text-primary hover:underline underline-offset-4"
              >
                {(privacyContent[locale] ?? privacyContent.es).title}
                {' →'}
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
