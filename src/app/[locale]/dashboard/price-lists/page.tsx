import { listPriceListsAction } from '@/actions/price-list/price-list.action';
import { getCompanyConfigAction } from '@/actions/platform/company-config.action';
import { PriceListsClient } from '@/components/price-lists/PriceListsClient';

export const dynamic = 'force-dynamic';

export default async function PriceListsPage() {
    const [res, company] = await Promise.all([listPriceListsAction(), getCompanyConfigAction()]);

    return (
        <div className="space-y-6 p-4 md:p-6 max-w-[1400px] mx-auto w-full">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Listas de precios</h1>
                <p className="text-sm text-muted-foreground">
                    Tarifas y listas de precios manuales para clientes o uso interno, con PDF de la empresa.
                </p>
            </div>
            {res.success ? (
                <PriceListsClient initialLists={res.data} company={company} />
            ) : (
                <p className="text-sm text-destructive">No se pudieron cargar las listas: {res.error}</p>
            )}
        </div>
    );
}
