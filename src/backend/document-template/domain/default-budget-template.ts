import type { TemplateBlock } from './document-template';

/**
 * Plantilla de condiciones ESTÁNDAR del presupuesto: los textos que hasta ahora
 * estaban escritos a mano en `BudgetDocument.tsx` (última página + aviso en
 * cursiva), copiados VERBATIM. Es el fallback final de la resolución de
 * plantillas: si no hay ninguna en Firestore (o ninguna aplica), el PDF se pinta
 * con esto y sale idéntico a como salía antes.
 *
 * El marcado (`**negrita**`, "✔ ", línea entera en negrita) está elegido para
 * reproducir exactamente la maqueta anterior — ver `template-body.ts`.
 * NO editar estos textos sin querer cambiar el PDF por defecto.
 */

export const BUILTIN_BUDGET_TEMPLATE_NAME = 'Condiciones estándar de presupuesto';

/** Validez por defecto del presupuesto (días) para `{{validez_dias}}`. */
export const DEFAULT_BUDGET_VALIDITY_DAYS = 15;

export const DEFAULT_BUDGET_DISCLAIMER =
    '* Este documento es una estimación técnica preliminar. Un experto contactará con usted para realizar una visita técnica y refinar los detalles finales del presupuesto.';

export const DEFAULT_BUDGET_BLOCKS: TemplateBlock[] = [
    {
        id: 'std-1',
        title: '1. Por qué es importante leer este presupuesto hasta el final',
        body: [
            'Independientemente de que finalmente trabajemos juntos o no, le recomendamos leer este presupuesto hasta el final. La información que contiene le ayudará a comprender cómo debe desarrollarse un proceso de reforma bien organizado, seguro y de calidad, qué riesgos es importante evitar y cómo tomar una decisión informada al elegir a la empresa ejecutora.',
            '',
            'Este documento no es solo un precio: describe nuestra forma de trabajar, el nivel de responsabilidad que asumimos y el valor real que recibe como cliente.',
        ].join('\n'),
    },
    {
        id: 'std-2',
        title: '2. Precio y Validez del Presupuesto',
        body: [
            'El precio total estimado para este proyecto es de **{{total}}**.',
            '',
            '**Validez del presupuesto:** hasta el {{validez_dias}} días posteriores a la fecha de emisión. Trabajamos con planificación previa y con capacidad limitada. Una vez finalizado el plazo de validez, no podemos garantizar ni el precio ni las fechas de inicio y ejecución indicadas.',
        ].join('\n'),
    },
    {
        id: 'std-3',
        title: '3. Qué problemas resolvemos por usted',
        body: [
            'Como cliente, no debería supervisar diariamente si los trabajos se están realizando correctamente, conocer materiales técnicos, coordinar operarios o asumir riesgos de mala planificación.',
            '',
            'En la práctica, la falta de organización suele provocar retrasos y sobrecostes. Nuestro trabajo consiste en asumir ese riesgo por usted y ofrecerle un proceso tranquilo, claro y previsible.',
        ].join('\n'),
    },
    {
        id: 'std-4',
        title: '4. Qué hacemos y qué beneficios obtiene usted',
        body: [
            '✔ Experiencia contrastada y control real',
            'Contamos con 25 años de experiencia práctica real. Dispongo de formación profesional en diseño de interiores, lo que me permite tener una visión global de cada proyecto: funcional, estético y duradero. Cada fase está supervisada personalmente.',
            '',
            '✔ Equipo propio, medios y estándares',
            'Trabajamos con personal propio y formado. Todos cuentan con equipos de protección individual y siguen estándares claros de ejecución. Disponemos de herramientas profesionales de alta precisión.',
            '',
            '✔ Materiales de calidad y buena ejecución',
            'Utilizamos materiales contrastados que previenen problemas futuros y evitan reparaciones innecesarias, suponiendo un ahorro de tiempo y dinero para usted.',
            '',
            '✔ Pensamos como inversor y como cliente',
            'Como profesional que ha sido inversor, entiendo perfectamente sus necesidades. Abordamos cada proyecto como si fuera para nosotros mismos.',
        ].join('\n'),
    },
    {
        id: 'std-5',
        title: '5. Plazos de inicio y organización',
        body: 'Este sistema de trabajo nos permite no asumir más proyectos de los que podemos ejecutar correctamente, cumplir los plazos acordados y mantener un nivel de calidad constante.',
    },
    {
        id: 'std-6',
        title: '6. Preguntas frecuentes',
        body: [
            '**¿Por qué el precio es más alto que otras ofertas?**',
            'Porque incluye organización integral, 25 años de experiencia y responsabilidad real. Un precio más bajo casi siempre implica concesiones en materiales, ejecución o control.',
            '',
            '**¿Tendré que supervisar la obra constantemente?**',
            'No. Nuestro trabajo es que usted no tenga que involucrarse en cuestiones técnicas u operativas.',
        ].join('\n'),
    },
    {
        id: 'std-7',
        title: '',
        variant: 'highlight',
        body: 'No buscamos clientes que elijan únicamente por precio. Trabajamos con quienes valoran seguridad, calidad y profesionalidad.',
    },
];
