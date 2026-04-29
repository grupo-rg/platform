import type { MetadataRoute } from 'next';
import { companyConfigService } from '@/backend/platform/application/company-config-service';

export default async function robots(): Promise<MetadataRoute.Robots> {
    const company = await companyConfigService.get();
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || company.web || 'http://localhost:9002';

    return {
        rules: {
            userAgent: '*',
            allow: '/',
            disallow: ['/private/', '/admin/', '/dashboard/'],
        },
        sitemap: `${baseUrl}/sitemap.xml`,
    };
}
