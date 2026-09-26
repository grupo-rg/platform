import type { Metadata } from 'next';
import { getDictionary } from '@/lib/dictionaries';
import { BudgetRequestForm } from '@/components/budget-request/budget-request-form';
import { constructMetadata } from '@/i18n/seo-utils';
import { companyConfigService } from '@/backend/platform/application/company-config-service';

// Sin este generateMetadata la página heredaba el canonical/hreflang del layout
// (apuntando a la HOME). Lo generamos con el path propio '/budget-request' para que
// canonical + alternates.languages apunten a su URL localizada real.
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const [dict, company] = await Promise.all([
    getDictionary(locale as any),
    companyConfigService.get(),
  ]);
  const t = dict.budgetRequest;

  return constructMetadata({
    title: `${t.page.title} | ${company.name}`,
    description: t.page.description,
    path: '/budget-request',
    locale,
  });
}

export default async function BudgetRequestPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const dict = await getDictionary(locale as any);
  const t_br = dict.budgetRequest;

  return (
    <>
      <div className="w-full py-16 md:py-20 bg-background">
        <div className="container-limited text-center">
          <h1 className="font-headline text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight">
            {t_br.page.title}
          </h1>
          <p className="mt-4 text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto mb-8">
            {t_br.page.description}
          </p>

          <div className='w-full flex justify-center mt-12'>
            <BudgetRequestForm t={dict} />
          </div>
        </div>
      </div>
    </>
  );
}
