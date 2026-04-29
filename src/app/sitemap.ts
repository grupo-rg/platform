import { MetadataRoute } from 'next';
import { routing } from '@/i18n/routing';
import { services } from '@/lib/services';
import { locations } from '@/lib/locations';
import { getTranslatedCategorySlug, getTranslatedSubcategorySlug } from '@/lib/service-slugs';
import { companyConfigService } from '@/backend/platform/application/company-config-service';
import { blogPostService } from '@/backend/marketing/application/blog-post-service';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const company = await companyConfigService.get();
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || company.web || 'http://localhost:9002';
    const entries: MetadataRoute.Sitemap = [];

    // Helper to get localized path
    const getLocalizedPath = (pathTemplate: string, locale: string, params?: Record<string, string>) => {
        let path = pathTemplate;
        const mapping = routing.pathnames[pathTemplate as keyof typeof routing.pathnames];

        if (mapping && typeof mapping === 'object' && locale in mapping) {
            path = (mapping as any)[locale];
        } else if (typeof mapping === 'string') {
            path = mapping;
        }

        // Replace params
        if (params) {
            Object.entries(params).forEach(([key, value]) => {
                path = path.replace(`[${key}]`, value);
            });
        }

        // Handle root
        if (path === '/') return `/${locale}`;

        return `/${locale}${path}`;
    };

    // 1. Static Pages
    const staticPages = [
        '/',
        '/contact',
        '/budget-request',
        '/blog',
        '/login',
        '/signup',
        '/privacy',
        '/terms'
    ];

    staticPages.forEach(page => {
        routing.locales.forEach(locale => {
            entries.push({
                url: `${baseUrl}${getLocalizedPath(page, locale)}`,
                lastModified: new Date(),
                changeFrequency: page === '/' ? 'daily' : 'weekly',
                priority: page === '/' ? 1.0 : 0.8,
            });
        });
    });

    // 2. Dynamic Services
    services.forEach(service => {
        if (service.subservices) {
            service.subservices.forEach(sub => {
                routing.locales.forEach(locale => {
                    const path = getLocalizedPath('/services/[category]/[subcategory]', locale, {
                        category: getTranslatedCategorySlug(service.id, locale),
                        subcategory: getTranslatedSubcategorySlug(sub.id, locale)
                    });
                    entries.push({
                        url: `${baseUrl}${path}`,
                        lastModified: new Date(),
                        changeFrequency: 'weekly',
                        priority: 0.9,
                    });
                });
            });
        }
    });

    // 3. Dynamic Blog Posts — leemos desde Firestore por cada locale
    for (const locale of routing.locales) {
        const posts = await blogPostService.listPublishedAll(locale as any, 100).catch(() => []);
        for (const post of posts) {
            const path = getLocalizedPath('/blog/[slug]', locale, { slug: post.slug });
            entries.push({
                url: `${baseUrl}${path}`,
                lastModified: post.publishedAt ? new Date(post.publishedAt) : new Date(),
                changeFrequency: 'monthly',
                priority: 0.7,
            });
        }
    }

    // 4. Dynamic Locations
    locations.forEach(location => {
        const zoneSlug = location.toLowerCase().replace(/\s+/g, '-');
        routing.locales.forEach(locale => {
            const path = getLocalizedPath('/zonas/[zone]', locale, {
                zone: zoneSlug
            });
            entries.push({
                url: `${baseUrl}${path}`,
                lastModified: new Date(),
                changeFrequency: 'weekly',
                priority: 0.8,
            });
        });
    });

    return entries;
}
