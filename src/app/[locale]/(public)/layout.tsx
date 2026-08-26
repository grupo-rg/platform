import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { getDictionary } from '@/lib/dictionaries';
import { ContactFab } from '@/components/contact-fab';

export default async function PublicLayout({
    children,
    params
}: {
    children: React.ReactNode;
    params: Promise<{ locale: string }>
}) {
    const { locale } = await params;
    const dict = await getDictionary(locale as any);

    return (
        <>
            <Header t={dict} />
            <main className="flex-1">
                {children}
            </main>
            <Footer t={dict.home?.cta} locale={locale} />
            {/* <ContactFab /> */}
        </>
    );
}
