import { Suspense } from 'react';
import { getBudgetConfigAction } from './actions';
import { getCalibrationFactorsAction } from './calibration-actions';
import { BudgetConfigForm } from './budget-config-form';
import { CalibrationPanel } from './calibration-panel';
import { CalibrationFactors } from '@/backend/calibration/domain/calibration-factors';
import { Skeleton } from "@/components/ui/skeleton";

export default async function BudgetSettingsPage() {
    const config = await getBudgetConfigAction();

    // Admin-gated. Non-admins still see the financial config above; the calibration
    // panel degrades to an "admins only" notice instead of crashing the page.
    let calibration: CalibrationFactors | null = null;
    try {
        calibration = await getCalibrationFactorsAction();
    } catch {
        calibration = null;
    }

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-medium">Configuración de Presupuestos</h3>
                <p className="text-sm text-muted-foreground">
                    Ajusta los parámetros financieros globales del sistema.
                </p>
            </div>
            <div className="separator" />
            <Suspense fallback={<Skeleton className="h-[400px] w-full" />}>
                <BudgetConfigForm initialConfig={config} />
            </Suspense>
            <CalibrationPanel initialFactors={calibration} />
        </div>
    );
}
