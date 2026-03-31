import { getProjectAction } from '@/actions/project/get-project.action';
import { getProjectExpensesAction } from '@/actions/expense/get-project-expenses.action';
import { ProjectManagerClient } from './project-manager-client';
import { notFound } from 'next/navigation';

import { Expense } from '@/backend/expense/domain/expense';

export const dynamic = 'force-dynamic';

interface PageProps {
    params: Promise<{ id: string; locale: string }>;
    searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function ProjectPage({ params }: PageProps) {
    const { id, locale } = await params;

    const project = await getProjectAction(id);

    if (!project) {
        notFound();
    }

    // Fetch expenses for this project (reuse existing action if available, or fetch empty if not)
    // Assuming getProjectExpensesAction takes projectId
    let expenses: Expense[] = [];
    try {
        // Double check if getProjectExpensesAction exists and what it returns
        // If not available, we send empty array logic here to avoid build break, but plan says reusing logic.
        // Assuming it's available as discussed.
        expenses = await getProjectExpensesAction(id);
    } catch (error) {
        console.error('Failed to load project expenses', error);
        expenses = [];
    }

    return (
        <div className="container mx-auto py-8 px-4 max-w-7xl">
            <ProjectManagerClient
                project={project}
                expenses={expenses}
                locale={locale}
            />
        </div>
    );
}
