import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { getDictionary } from '@/lib/dictionaries';
import { ContactFab } from '@/components/contact-fab';
import { CompanyContactProvider } from '@/components/providers/company-contact-provider';
import { companyConfigService } from '@/backend/platform/application/company-config-service';
import { CONTACT_PHONE_DISPLAY } from '@/lib/contact';

export default async function PublicLayout({
    children,
    params
}: {
    children: React.ReactNode;
    params: Promise<{ locale: string }>
}) {
    const { locale } = await params;
    const [dict, company] = await Promise.all([
        getDictionary(locale as any),
        companyConfigService.get(),
    ]);

    // Fuente única de los datos de contacto: Ajustes › Empresa.
    const contact = {
        phone: company.phone || CONTACT_PHONE_DISPLAY,
        email: company.email || '',
        address: company.address || '',
    };

    return (
        <CompanyContactProvider value={contact}>
            <Header t={dict} />
            <main className="flex-1">
                {children}
            </main>
            <Footer t={dict.home?.cta} locale={locale} />
            {/* <ContactFab /> */}
        </CompanyContactProvider>
    );
}
