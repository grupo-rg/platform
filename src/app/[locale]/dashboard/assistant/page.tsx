import { BudgetWizardChat } from '@/components/budget/wizard/BudgetWizardChat';
import { WizardSessionShell } from '@/components/budget/wizard/WizardSessionShell';

export default async function BudgetWizardPage({
    params,
    searchParams,
}: {
    params: Promise<{ locale: string }>;
    searchParams?: Promise<{ session?: string }>;
}) {
    const { locale } = await params;
    const search = searchParams ? await searchParams : undefined;

    return (
        <div className="flex flex-col h-[100dvh] w-full bg-background">
            <WizardSessionShell locale={locale} sessionParam={search?.session}>
                <BudgetWizardChat isAdmin={true} />
            </WizardSessionShell>
        </div>
    );
}
