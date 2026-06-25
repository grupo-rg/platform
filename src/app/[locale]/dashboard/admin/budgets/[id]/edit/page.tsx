import { getBudgetAction } from '@/actions/budget/get-budget.action';
import { getCompanyConfigAction } from '@/actions/platform/company-config.action';
import { BudgetEditorWrapper } from '@/components/budget-editor/BudgetEditorWrapper';
import { notFound } from 'next/navigation';

interface BudgetEditorPageProps {
    params: Promise<{
        id: string;
    }>;
}

export default async function BudgetEditorPage({ params }: BudgetEditorPageProps) {
    // Next.js 15 requires awaiting params
    const { id } = await params;

    const [budget, companyConfig] = await Promise.all([
        getBudgetAction(id),
        getCompanyConfigAction(),
    ]);

    if (!budget) {
        notFound();
    }

    return (
        <BudgetEditorWrapper budget={budget} isAdmin={true} initialCompanyConfig={companyConfig} />
    );
}
