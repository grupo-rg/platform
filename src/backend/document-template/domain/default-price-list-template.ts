import type { TemplateBlock } from './document-template';

/**
 * Condiciones por defecto de una LISTA DE PRECIOS / tarifa. Fallback final de la
 * resolución para `kind = 'price_list'` cuando no hay plantilla en Firestore.
 */

export const BUILTIN_PRICE_LIST_TEMPLATE_NAME = 'Condiciones estándar de lista de precios';

export const DEFAULT_PRICE_LIST_DISCLAIMER =
    '* Los precios de esta lista son orientativos y no constituyen un presupuesto cerrado de obra.';

export const DEFAULT_PRICE_LIST_BLOCKS: TemplateBlock[] = [
    {
        id: 'pl-1',
        title: 'Condiciones de la tarifa',
        body: [
            '- **Validez:** los precios se mantienen durante el periodo de validez indicado en la cabecera. Pasado ese plazo, {{empresa}} podrá revisarlos.',
            '- **Precios orientativos:** cada trabajo se valora definitivamente en su presupuesto u orden de trabajo, según las condiciones reales de la obra.',
            '- **IVA:** se aplica según lo indicado en la cabecera de esta lista (IVA incluido o no incluido).',
            '- **Mano de obra por horas:** se factura el tiempo efectivo de trabajo de cada categoría profesional.',
            '- **Materiales:** salvo que se indique lo contrario, no están incluidos en el precio de la mano de obra y se facturan aparte.',
            '- **Desplazamiento:** se aplica por servicio o por kilómetro según figure en la lista.',
        ].join('\n'),
    },
];
