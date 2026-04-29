import { defineRouting } from 'next-intl/routing';


export const routing = defineRouting({
    // A list of all locales that are supported
    locales: ['es', 'en', 'ca', 'de', 'nl'],

    // Used when no locale matches
    defaultLocale: 'es',

    // Localized pathnames
    pathnames: {
        '/': '/',
        '/contact': {
            es: '/contacto',
            en: '/contact',
            ca: '/contacte',
            de: '/kontakt',
            nl: '/contact'
        },
        '/services': {
            es: '/servicios',
            en: '/services',
            ca: '/serveis',
            de: '/dienstleistungen',
            nl: '/diensten'
        },
        '/budget-request': {
            es: '/presupuesto',
            en: '/budget-request',
            ca: '/pressupost',
            de: '/angebot-anfordern',
            nl: '/offerte-aanvragen'
        },
        '/services/[category]/[subcategory]': {
            es: '/servicios/[category]/[subcategory]',
            en: '/services/[category]/[subcategory]',
            ca: '/serveis/[category]/[subcategory]',
            de: '/dienstleistungen/[category]/[subcategory]',
            nl: '/diensten/[category]/[subcategory]'
        },
        '/blog': {
            es: '/blog',
            en: '/blog',
            ca: '/blog',
            de: '/blog',
            nl: '/blog'
        },
        '/blog/[slug]': {
            es: '/blog/[slug]',
            en: '/blog/[slug]',
            ca: '/blog/[slug]',
            de: '/blog/[slug]',
            nl: '/blog/[slug]'
        },
        '/privacy': '/privacy',
        '/terms': '/terms',
        '/login': '/login',
        '/signup': '/signup',
        '/zonas/[zone]': {
            es: '/zonas/[zone]',
            en: '/locations/[zone]',
            ca: '/zones/[zone]',
            de: '/standorte/[zone]',
            nl: '/locaties/[zone]'
        },
        '/dashboard': '/dashboard',
        '/dashboard/assistant': {
            es: '/dashboard/asistente',
            en: '/dashboard/assistant',
            ca: '/dashboard/assistent',
            de: '/dashboard/assistent',
            nl: '/dashboard/assistent'
        },
        '/dashboard/budget-request': '/dashboard/budget-request',
        '/dashboard/admin/budgets': '/dashboard/admin/budgets',
        '/dashboard/admin/pipelines': '/dashboard/admin/pipelines',
        '/dashboard/seo-generator': '/dashboard/seo-generator',
        '/dashboard/settings/pricing': '/dashboard/settings/pricing',
        '/dashboard/settings/financial': '/dashboard/settings/financial',
        '/dashboard/settings/company': '/dashboard/settings/company',
        '/dashboard/admin/prices': '/dashboard/admin/prices',
        '/dashboard/settings': '/dashboard/settings'
    }
});
