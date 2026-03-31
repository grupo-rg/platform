import { BudgetWizardChat } from '@/components/budget/wizard/BudgetWizardChat';
import { getTranslations } from 'next-intl/server';

export default async function BudgetWizardPage() {
    const t = await getTranslations('Dashboard');

    return (
        <div className="flex flex-col h-[100dvh] w-full bg-background">
            <BudgetWizardChat isAdmin={true} />
        </div>
    );
}
