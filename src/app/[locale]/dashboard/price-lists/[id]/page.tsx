import { notFound } from 'next/navigation';
import { getPriceListAction, getPriceListStarterBlocksAction } from '@/actions/price-list/price-list.action';
import { listDocumentTemplatesAction } from '@/actions/document-template/document-template.action';
import { getCompanyConfigAction } from '@/actions/platform/company-config.action';
import { PriceListEditor } from '@/components/price-lists/PriceListEditor';

export const dynamic = 'force-dynamic';

export default async function PriceListDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const isNew = id === 'new';

    const [listRes, templatesRes, starterRes, company] = await Promise.all([
        isNew ? Promise.resolve(null) : getPriceListAction(id),
        listDocumentTemplatesAction(),
        isNew ? getPriceListStarterBlocksAction() : Promise.resolve(null),
        getCompanyConfigAction(),
    ]);

    if (listRes && !listRes.success) {
        return <p className="p-6 text-sm text-destructive">No se pudo cargar la lista: {listRes.error}</p>;
    }
    if (listRes && listRes.success && !listRes.data) notFound();

    const templates = templatesRes.success
        ? templatesRes.data.filter((t) => t.kind === 'price_list' || t.kind === 'any')
        : [];

    return (
        <PriceListEditor
            initialList={listRes?.success ? listRes.data : null}
            starter={starterRes?.success ? starterRes.data : null}
            templates={templates}
            company={company}
        />
    );
}
