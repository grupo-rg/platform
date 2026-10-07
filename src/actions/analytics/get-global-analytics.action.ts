'use server';

import { requireAdmin } from '@/actions/_guards';

import { FirestoreProjectRepository } from '@/backend/project/infrastructure/firestore-project-repository';
import { FirestoreExpenseRepository } from '@/backend/expense/infrastructure/firestore-expense-repository';
import { AnalyticsService, GlobalAnalytics } from '@/backend/analytics/analytics-service';

const projectRepo = new FirestoreProjectRepository();
const expenseRepo = new FirestoreExpenseRepository();
const analyticsService = new AnalyticsService();

export async function getGlobalAnalyticsAction(): Promise<GlobalAnalytics> {
    await requireAdmin();
    try {
        const [projects, expenses] = await Promise.all([
            projectRepo.findAll(),
            expenseRepo.findAll(),
        ]);

        return analyticsService.getGlobalAnalytics(projects, expenses);
    } catch (error) {
        console.error('Error fetching global analytics:', error);
        return {
            totalBilled: 0,
            totalExpenses: 0,
            netProfit: 0,
            profitMargin: 0,
            vatCollected: 0,
            vatPaid: 0,
            vatBalance: 0,
            totalProjects: 0,
            projectsByStatus: {},
            projectSummaries: [],
            monthlyExpenses: [],
        };
    }
}
