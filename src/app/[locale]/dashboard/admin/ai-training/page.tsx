import { getAiTrainingDataAction } from '@/actions/admin/get-ai-training-data.action';
import { AiTrainingClient } from './ai-training-client';
import { getTranslations } from 'next-intl/server';

export default async function AiTrainingDashboardPage() {
    const response = await getAiTrainingDataAction();
    const data = response.success ? response.data : [];

    return (
        <div className="flex-1 space-y-4 p-8 pt-6 w-full max-w-[1400px] mx-auto">
            <AiTrainingClient initialData={data || []} />
        </div>
    );
}
