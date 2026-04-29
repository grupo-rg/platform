import { Suspense } from 'react';
import { getCompanyConfigAction } from '@/actions/platform/company-config.action';
import { CompanyConfigForm } from './company-config-form';
import { Skeleton } from '@/components/ui/skeleton';

export default async function CompanySettingsPage() {
    const config = await getCompanyConfigAction();

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-medium">Datos de empresa</h3>
                <p className="text-sm text-muted-foreground">
                    Información que aparece en los PDFs de presupuesto, emails transaccionales y la web pública.
                </p>
            </div>
            <Suspense fallback={<Skeleton className="h-[400px] w-full" />}>
                <CompanyConfigForm initialConfig={config} />
            </Suspense>
        </div>
    );
}
