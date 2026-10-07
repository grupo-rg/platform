'use server';

import { requireAdmin } from '@/actions/_guards';

import { FirestoreProjectRepository } from '@/backend/project/infrastructure/firestore-project-repository';
import { FirestoreExpenseRepository } from '@/backend/expense/infrastructure/firestore-expense-repository';
import { AnalyticsService, ProjectAnalytics } from '@/backend/analytics/analytics-service';

const projectRepo = new FirestoreProjectRepository();
const expenseRepo = new FirestoreExpenseRepository();
const analyticsService = new AnalyticsService();

export async function getProjectAnalyticsAction(projectId: string): Promise<ProjectAnalytics | null> {
    await requireAdmin();
    try {
        const [project, expenses] = await Promise.all([
            projectRepo.findById(projectId),
            expenseRepo.findByProjectId(projectId),
        ]);

        if (!project) return null;

        return analyticsService.getProjectAnalytics(project, expenses);
    } catch (error) {
        console.error('Error fetching project analytics:', error);
        return null;
    }
}
