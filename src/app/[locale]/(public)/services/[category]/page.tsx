import { services } from '@/lib/services';
import { notFound } from 'next/navigation';
import { redirect } from '@/i18n/navigation';
import i18nConfig from '@/../i18nConfig';
import { getOriginalCategoryId, getTranslatedCategorySlug, getTranslatedSubcategorySlug } from '@/lib/service-slugs';

export async function generateStaticParams() {
    const params: { locale: string; category: string }[] = [];
    const locales = i18nConfig.locales;

    services.forEach((service) => {
        locales.forEach(locale => {
            params.push({
                locale,
                category: getTranslatedCategorySlug(service.id, locale)
            });
        });
    });

    return params;
}

export default async function ServiceCategoryPage({ params }: { params: Promise<{ category: string, locale: string }> }) {
    const { category, locale } = await params;
    
    const categoryId = getOriginalCategoryId(category, locale);
    const service = services.find((s) => s.id === categoryId);

    if (!service) return notFound();

    // If subservices exist, redirect to the first one.
    // Otherwise, we might need a general category page, but for now redirect is safer for SEO silos structure.
    if (service.subservices && service.subservices.length > 0) {
        redirect({
            href: {
                pathname: '/services/[category]/[subcategory]',
                params: {
                    category,
                    subcategory: getTranslatedSubcategorySlug(service.subservices[0].id, locale)
                }
            },
            locale
        });
    }

    return notFound();
}
