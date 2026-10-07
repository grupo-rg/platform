'use server';

import { requireAdmin } from '@/actions/_guards';

import { companyConfigService } from '@/backend/platform/application/company-config-service';
import { CompanyConfig } from '@/backend/platform/domain/company-config';
import { revalidatePath } from 'next/cache';

export async function getCompanyConfigAction(): Promise<CompanyConfig> {
    await requireAdmin();
    return companyConfigService.get();
}

export async function saveCompanyConfigAction(config: CompanyConfig): Promise<void> {
    await requireAdmin();
    await companyConfigService.save({
        ...config,
        updatedAt: new Date(),
    });
    revalidatePath('/dashboard/settings/company');
    revalidatePath('/', 'layout');
}
