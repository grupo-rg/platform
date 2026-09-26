/**
 * JSON-LD Structured Data Components
 * Reusable across all public pages for SEO
 */
import { companyConfigService } from '@/backend/platform/application/company-config-service';
import { CONTACT_PHONE_E164 } from '@/lib/contact';

/** Schema.org espera URLs absolutas: convierte "/images/x.jpg" en una URL completa. */
function absoluteUrl(src: string | undefined, base: string): string | undefined {
    if (!src) return undefined;
    if (src.startsWith('http') || src.startsWith('data:')) return src;
    const origin = (base || process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/$/, '');
    return origin ? `${origin}${src.startsWith('/') ? '' : '/'}${src}` : src;
}

interface BreadcrumbItem {
    name: string;
    href: string;
}

interface ServiceSchemaProps {
    name: string;
    description: string;
    category: string;
    image?: string;
    areaServed?: string;
}

interface FAQItem {
    question: string;
    answer: string;
}

interface OrganizationSchemaProps {
    name?: string;
    alternateName?: string;
    description?: string;
    url?: string;
    logo?: string;
    areaServed?: string[];
    telephone?: string;
    email?: string;
}

// Organization JSON-LD
export async function OrganizationJsonLd(props: OrganizationSchemaProps = {}) {
    const company = await companyConfigService.get();
    // Marca unificada: UNA entidad con dos nombres.
    // name = razón comercial ("Grupo RG"); alternateName = marca de cara al público
    // ("Constructores en Mallorca"). Evita que Google las trate como negocios distintos.
    const name = props.name ?? company.name;
    const alternateName = props.alternateName ?? company.alternateName ?? 'Constructores en Mallorca';
    const description = props.description ?? company.tagline ?? '';
    const url = props.url ?? company.web;
    const logo = props.logo ?? company.logoUrl ?? '/logo.webp';
    const areaServed = props.areaServed ?? ['Mallorca', 'Menorca', 'Ibiza', 'Formentera', 'Islas Baleares'];
    const telephone = props.telephone || company.phone || CONTACT_PHONE_E164;
    const email = props.email ?? company.email;

    // sameAs solo con redes reales de la config; sin inventarlas.
    const sameAs = company.social
        ? Object.values(company.social).filter((u): u is string => Boolean(u && u.trim()))
        : [];

    // NAP local (LocalBusiness). Oficinas en Petra (07520), Illes Balears — dato
    // que ya aparece en la ficha de contacto. `streetAddress` solo si la config
    // lo tiene; NO se emite `openingHoursSpecification` porque company config no
    // guarda horario (no inventamos horas).
    const address = {
        '@type': 'PostalAddress',
        ...(company.address ? { streetAddress: company.address } : {}),
        addressLocality: 'Petra',
        postalCode: '07520',
        addressRegion: 'Illes Balears',
        addressCountry: 'ES',
    };
    const geo = {
        '@type': 'GeoCoordinates',
        latitude: 39.6139,
        longitude: 3.1029,
    };

    const schema = {
        '@context': 'https://schema.org',
        '@type': 'HomeAndConstructionBusiness',
        name,
        ...(alternateName && { alternateName }),
        description,
        url,
        logo: logo.startsWith('http') ? logo : `${url}${logo}`,
        areaServed: areaServed.map(area => ({ '@type': 'Place', name: area })),
        address,
        geo,
        ...(telephone && { telephone }),
        ...(email && { email }),
        priceRange: '€€€',
        ...(sameAs.length > 0 && { sameAs }),
    };

    return (
        <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
    );
}

interface ArticleSchemaProps {
    /** Título del artículo (post.title / metaTitle). */
    headline: string;
    /** URL canónica absoluta del post. */
    url: string;
    description?: string;
    /** Imagen social del post (ogImageUrl / heroImageUrl). Se absolutiza. */
    image?: string;
    datePublished?: string | Date;
    dateModified?: string | Date;
    /** Idioma del post (locale) para `inLanguage`. */
    inLanguage?: string;
    keywords?: string[];
    /**
     * Autor real (E-E-A-T) si existe. Si no se pasa, se usa la empresa
     * (Organization) como autor — NO se inventa una persona.
     */
    author?: { name: string; url?: string };
}

// Article / BlogPosting JSON-LD (E-E-A-T)
export async function ArticleJsonLd({
    headline,
    url,
    description,
    image,
    datePublished,
    dateModified,
    inLanguage,
    keywords,
    author,
}: ArticleSchemaProps) {
    const company = await companyConfigService.get();

    const logoSrc = company.logoUrl ?? '/logo.webp';
    const logoUrl = absoluteUrl(logoSrc, company.web) ?? logoSrc;

    // Publisher: siempre la empresa (Organization con logo).
    const publisher = {
        '@type': 'Organization',
        name: company.name,
        ...(company.alternateName && { alternateName: company.alternateName }),
        url: company.web,
        logo: {
            '@type': 'ImageObject',
            url: logoUrl,
        },
    };

    // Autor: persona real si se aporta; en su defecto, la propia empresa.
    // Nunca se inventa una persona.
    const authorNode = author?.name
        ? { '@type': 'Person', name: author.name, ...(author.url && { url: author.url }) }
        : publisher;

    const toIso = (d?: string | Date) => (d ? new Date(d).toISOString() : undefined);
    const published = toIso(datePublished);
    const modified = toIso(dateModified) ?? published;

    const schema = {
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline,
        ...(description && { description }),
        mainEntityOfPage: { '@type': 'WebPage', '@id': url },
        url,
        ...(image && { image: absoluteUrl(image, company.web) }),
        ...(published && { datePublished: published }),
        ...(modified && { dateModified: modified }),
        author: authorNode,
        publisher,
        ...(inLanguage && { inLanguage }),
        ...(keywords && keywords.length > 0 && { keywords: keywords.join(', ') }),
    };

    return (
        <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
    );
}

// Breadcrumb JSON-LD
export async function BreadcrumbJsonLd({ items, baseUrl }: { items: BreadcrumbItem[]; baseUrl?: string }) {
    const company = await companyConfigService.get();
    const base = baseUrl ?? company.web;
    const schema = {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: items.map((item, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: item.name,
            item: `${base}${item.href}`
        }))
    };

    return (
        <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
    );
}

// Service JSON-LD
export async function ServiceJsonLd({
    name,
    description,
    category,
    image,
    areaServed = 'Mallorca, Islas Baleares'
}: ServiceSchemaProps) {
    const company = await companyConfigService.get();
    const schema = {
        '@context': 'https://schema.org',
        '@type': 'Service',
        name,
        description,
        category,
        provider: {
            '@type': 'HomeAndConstructionBusiness',
            name: company.name,
            url: company.web,
        },
        areaServed: {
            '@type': 'Place',
            name: areaServed
        },
        ...(image && { image: absoluteUrl(image, company.web) })
    };

    return (
        <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
    );
}

// FAQ JSON-LD
export function FAQJsonLd({ items }: { items: FAQItem[] }) {
    if (!items || items.length === 0) return null;

    const schema = {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: items.map(item => ({
            '@type': 'Question',
            name: item.question,
            acceptedAnswer: {
                '@type': 'Answer',
                text: item.answer
            }
        }))
    };

    return (
        <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
    );
}

// WebPage JSON-LD
export async function WebPageJsonLd({
    name,
    description,
    url,
    type = 'WebPage'
}: {
    name: string;
    description: string;
    url: string;
    type?: 'WebPage' | 'CollectionPage' | 'AboutPage' | 'ContactPage';
}) {
    const company = await companyConfigService.get();
    const schema = {
        '@context': 'https://schema.org',
        '@type': type,
        name,
        description,
        url,
        isPartOf: {
            '@type': 'WebSite',
            name: company.name,
            url: company.web,
        }
    };

    return (
        <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
    );
}
