'use server';

import { requireAdmin } from '@/actions/_guards';

import { FirestoreProjectRepository } from '@/backend/project/infrastructure/firestore-project-repository';
import { FirestoreExpenseRepository } from '@/backend/expense/infrastructure/firestore-expense-repository';
import {
    AnalyticsService,
    EVMAnalytics,
    ProviderRankingAnalytics,
    BudgetAccuracyAnalytics,
} from '@/backend/analytics/analytics-service';

const projectRepo = new FirestoreProjectRepository();
const expenseRepo = new FirestoreExpenseRepository();
const analyticsService = new AnalyticsService();

export async function getEVMAnalyticsAction(projectId: string): Promise<EVMAnalytics | null> {
    await requireAdmin();
    try {
        const [project, expenses] = await Promise.all([
            projectRepo.findById(projectId),
            expenseRepo.findByProjectId(projectId),
        ]);
        if (!project) return null;
        return analyticsService.getEVMAnalytics(project, expenses);
    } catch (error) {
        console.error('Error fetching EVM analytics:', error);
        return null;
    }
}

export async function getProviderRankingAction(): Promise<ProviderRankingAnalytics> {
    await requireAdmin();
    try {
        const [projects, expenses] = await Promise.all([
            projectRepo.findAll(),
            expenseRepo.findAll(),
        ]);
        return analyticsService.getProviderRanking(projects, expenses);
    } catch (error) {
        console.error('Error fetching provider ranking:', error);
        return { providers: [], totalGlobalSpend: 0, topProviderRiskPercent: 0 };
    }
}

export async function getBudgetAccuracyAction(): Promise<BudgetAccuracyAnalytics> {
    await requireAdmin();
    try {
        const [projects, expenses] = await Promise.all([
            projectRepo.findAll(),
            expenseRepo.findAll(),
        ]);
        return analyticsService.getBudgetAccuracy(projects, expenses);
    } catch (error) {
        console.error('Error fetching budget accuracy:', error);
        return {
            entries: [],
            avgDeviationPercent: 0,
            medianDeviationPercent: 0,
            bestProject: null,
            worstProject: null,
            chapterAccuracies: [],
        };
    }
}
