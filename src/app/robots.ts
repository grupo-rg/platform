import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
    // Unificado con el criterio del layout: no dependemos de company.web
    // (puede venir vacío en prod y emitir localhost).
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://constructoresenmallorca.com';

    return {
        rules: {
            userAgent: '*',
            // Permitimos '/' para todos los agentes (incl. crawlers de IA / GEO).
            allow: '/',
            // Cubrimos tanto las rutas sin locale como las localizadas
            // (/[locale]/dashboard/…) mediante wildcard por locale.
            disallow: [
                '/dashboard/',
                '/admin/',
                '/private/',
                '/*/dashboard/',
                '/*/admin/',
                '/*/private/',
                '/*/invitacion/',
            ],
        },
        sitemap: `${baseUrl}/sitemap.xml`,
    };
}
