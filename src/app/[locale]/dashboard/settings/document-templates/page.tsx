import { listDocumentTemplatesAction } from '@/actions/document-template/document-template.action';
import { DocumentTemplatesClient } from './document-templates-client';

export const dynamic = 'force-dynamic';

export default async function DocumentTemplatesPage() {
    const res = await listDocumentTemplatesAction();

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-medium">Plantillas PDF</h3>
                <p className="text-sm text-muted-foreground">
                    Textos de condiciones que se añaden al final de los presupuestos y de las listas de precios.
                    Si no hay ninguna plantilla predeterminada, se usan las condiciones estándar.
                </p>
            </div>
            {res.success ? (
                <DocumentTemplatesClient initialTemplates={res.data} />
            ) : (
                <p className="text-sm text-destructive">No se pudieron cargar las plantillas: {res.error}</p>
            )}
        </div>
    );
}
