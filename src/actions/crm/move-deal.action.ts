'use server';

import { revalidatePath } from 'next/cache';
import { FirebaseDealRepository } from '@/backend/crm/infrastructure/persistence/firebase.deal.repository';
import { PipelineStage } from '@/backend/crm/domain/deal';

export async function moveDealStageAction(
    dealId: string,
    newStage: PipelineStage
): Promise<{ success: boolean; error?: string }> {
    try {
        const repo = new FirebaseDealRepository();
        const deal = await repo.findById(dealId);
        if (!deal) return { success: false, error: 'Deal no encontrado' };

        if (deal.stage === newStage) {
            return { success: true };
        }
        deal.moveToStage(newStage);
        await repo.save(deal);

        revalidatePath('/dashboard/leads');
        return { success: true };
    } catch (error: any) {
        console.error('moveDealStageAction Error:', error);
        return { success: false, error: error?.message || 'Error moviendo deal' };
    }
}
