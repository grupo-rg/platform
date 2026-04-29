/**
 * JSON-LD Structured Data Components
 * Reusable across all public pages for SEO
 */
import { companyConfigService } from '@/backend/platform/application/company-config-service';

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
    const name = props.name ?? company.name;
    const description = props.description ?? company.tagline ?? '';
    const url = props.url ?? company.web;
    const logo = props.logo ?? company.logoUrl ?? '/logo.webp';
    const areaServed = props.areaServed ?? ['Mallorca', 'Menorca', 'Ibiza', 'Formentera', 'Islas Baleares'];
    const telephone = props.telephone ?? company.phone;
    const email = props.email ?? company.email;

    const schema = {
        '@context': 'https://schema.org',
        '@type': 'HomeAndConstructionBusiness',
        name,
        description,
        url,
        logo: logo.startsWith('http') ? logo : `${url}${logo}`,
        areaServed: areaServed.map(area => ({ '@type': 'Place', name: area })),
        ...(telephone && { telephone }),
        ...(email && { email }),
        priceRange: '€€€',
        aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: '4.8',
            reviewCount: '127'
        }
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
        ...(image && { image })
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
