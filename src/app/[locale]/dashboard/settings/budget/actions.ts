'use server';

import { requireAdmin } from '@/actions/_guards';

import { FirestoreBudgetConfigRepository } from "@/backend/budget/infrastructure/firestore-budget-config.repository";
import { BudgetConfig } from "@/backend/budget/domain/budget-config";
import { revalidatePath } from "next/cache";

const repo = new FirestoreBudgetConfigRepository();

export async function getBudgetConfigAction(): Promise<BudgetConfig> {
    await requireAdmin();
    try {
        return await repo.getConfig();
    } catch (error) {
        console.error("Error fetching budget config:", error);
        throw new Error("Failed to fetch budget configuration");
    }
}

export async function saveBudgetConfigAction(config: BudgetConfig): Promise<void> {
    await requireAdmin();
    try {
        await repo.saveConfig(config);
        revalidatePath('/dashboard/settings/budget');
    } catch (error) {
        console.error("Error saving budget config:", error);
        throw new Error("Failed to save budget configuration");
    }
}
