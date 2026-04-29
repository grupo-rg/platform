'use server';

import { companyConfigService } from '@/backend/platform/application/company-config-service';
import { CompanyConfig } from '@/backend/platform/domain/company-config';
import { revalidatePath } from 'next/cache';

export async function getCompanyConfigAction(): Promise<CompanyConfig> {
    return companyConfigService.get();
}

export async function saveCompanyConfigAction(config: CompanyConfig): Promise<void> {
    await companyConfigService.save({
        ...config,
        updatedAt: new Date(),
    });
    revalidatePath('/dashboard/settings/company');
    revalidatePath('/', 'layout');
}
