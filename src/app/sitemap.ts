import { MetadataRoute } from 'next';
import { routing } from '@/i18n/routing';
import { services } from '@/lib/services';
import { blogPosts } from '@/lib/blog-posts';
import { locations } from '@/lib/locations';
import { getTranslatedCategorySlug, getTranslatedSubcategorySlug } from '@/lib/service-slugs';

export default function sitemap(): MetadataRoute.Sitemap {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://Grupo RG.es';
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

    // 3. Dynamic Blog Posts
    blogPosts.forEach(post => {
        routing.locales.forEach(locale => {
            const path = getLocalizedPath('/blog/[slug]', locale, {
                slug: post.slug
            });
            entries.push({
                url: `${baseUrl}${path}`,
                lastModified: new Date(), // Ideally create date from post
                changeFrequency: 'monthly',
                priority: 0.7,
            });
        });
    });

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
