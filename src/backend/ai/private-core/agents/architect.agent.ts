import { ai, gemini25Flash } from '../../shared/config/genkit.config';
import { generateWithRetry } from '../../shared/utils/ai-retry';
import * as fs from 'fs';
import * as path from 'path';
import pdfIndex from '../../../../lib/pdf_index_2025.json';
import { z } from 'genkit';

const MAIN_CHAPTERS = [
    "DEMOLICIONES", "MOVIMIENTO DE TIERRAS", "HORMIGONES", "FORJADOS",
    "ESTRUCTURAS METALICAS", "CUBIERTAS", "FABRICAS Y TABIQUES", "RED DE SANEAMIENTO",
    "RED DE VENTILACIÓN", "REVOCOS Y ENLUCIDOS", "SOLADOS Y ALICATADOS",
    "CANTERIA Y PIEDRA  ARTIFICIAL", "AISLAMIENTOS", "FIRMES Y PAVIMENTOS",
    "OBRAS VARIAS Y ALBAÑILERIA", "CARPINTERIA DE MADERA", "CERRAJERIA",
    "FONTANERIA Y GAS", "CALEFACCION", "ELECTRICIDAD Y TELECOMUNICACIONES",
    "ENERGIA SOLAR", "AIRE ACONDICIONADO", "APARATOS ELEVADORES", "CONTRAINCENDIOS",
    "PISCINAS", "ACRISTALAMIENTOS", "PINTURA Y REVESTIMIENTOS", "URBANIZACION INTERIOR PARCELA",
    "JARDINERIA", "PAVIMENTOS DE MADERA", "REHABILITACIÓN, REPARACIÓN Y MANTENIMIENTO",
    "BIOCONSTRUCCIÓN", "SEGURIDAD Y SALUD", "ENSAYOS Y CONTROL TECNICO", "UNCLASSIFIED"
] as const;

export const DecomposedTaskSchema = z.object({
    taskId: z.number().describe("Identificador entero único secuencial"),
    dependsOn: z.array(z.number()).describe("Array de taskId de los que depende"),
    chapter: z.enum(MAIN_CHAPTERS).describe("Capítulo principal del catálogo o UNCLASSIFIED si no encaja"),
    subchapter: z.string().optional().describe("Subcapítulo del catálogo"),
    reasoning: z.string().describe("Motivo por el cual es necesaria la tarea"),
    task: z.string().describe("Descripción genérica de la tarea"),
    userSpecificMaterial: z.string().nullable().optional().describe("Material explícito pedido por el usuario"),
    isExplicitlyRequested: z.boolean().default(false).describe("True si el usuario pidió esta partida explícitamente"),
    estimatedParametricUnit: z.string().describe("Unidad lógica (m2, ud, ml)"),
    estimatedParametricQuantity: z.number().describe("Cantidad estimada"),
});

export const ArchitectResponseSchema = z.object({
    status: z.enum(['ASKING', 'COMPLETE']),
    question: z.string().nullable().optional(),
    tasks: z.array(DecomposedTaskSchema)
});

export type DecomposedTask = z.infer<typeof DecomposedTaskSchema>;
export type ArchitectResponse = z.infer<typeof ArchitectResponseSchema> & { usage?: any };


/**
 * The Architect Agent is the user-facing "Decomposer".
 * Its job is to take a natural language request (e.g., "Reforma integral baño 5m2") 
 * and break it down into the required COAATMCA construction chapters with generic descriptions.
 */
export class ArchitectAgent {
    private readonly model = gemini25Flash;

    async decomposeRequest(userRequest: string): Promise<ArchitectResponse> {

        // Load DAG context
        const dagPath = path.join(process.cwd(), 'src/data/construction_dag.json');
        let dagContext = "";
        try {
            const dagData = fs.readFileSync(dagPath, 'utf8');
            dagContext = `\nCONSTRUCTION DAG (FASES LOGICAS DE OBRA):\nUtiliza este grafo estructural para entender el orden cronológico en el que deben ejecutarse las obras. Mapea tus tareas a las Fases descritas aquí mediante el campo "dependsOn":\n${dagData}\n`;
        } catch (e) {
            console.warn("Could not load DAG context for Architect.", e);
        }

        // Clean the catalog to remove heavy metadata like printedPage, keeping only the hierarchy
        const catalogContext = pdfIndex.map((chap: any) => ({
            chapter: chap.name,
            subchapters: chap.subchapters?.map((sub: any) => sub.name) || []
        }));

        const prompt = `
Eres un Arquitecto Técnico (Aparejador) Experto en España.
Tu trabajo es analizar peticiones de clientes para obras/reformas y desglosarlas en tareas de ejecución atómicas (Presupuesto de Ejecución Material - PEM).${dagContext}

REGLAS CRÍTICAS - PREVENCIÓN DE ASUNCIONES LÓGICAS ERRÓNEAS:
1. DISTINGUE CLARAMENTE entre "CONTEXTO DEL INMUEBLE" y "NUEVO ALCANCE DE OBRA".
2. El cliente frecuentemente describirá detalles sobre el estado actual (p. ej., si el edificio ya tiene un ascensor, si hay muebles que quitar, el tamaño de las puertas actuales). Esto es información de CONTEXTO. BAJO NINGUNA CIRCUNSTANCIA debes interpretar este contexto preexistente como una orden para instalar algo de cero (p. ej., no agregues "Instalar Ascensor" si el cliente solo mencionó que el edificio ya tiene uno para subir material, o no agregues "Construir muro" si simplemente dijo que hay un muro ancho). 
3. ÚNICAMENTE genera tareas de construcción, instalación o demolición para las acciones que el cliente EXPLÍCITAMENTE pida ejecutar o reformar.
4. NO INVENTES PRECIOS NI MARCAS. Define genéricamente la tarea física.
5. REGLA DE ESCOMBROS: Si generas tareas de demoliciones, es OBLIGATORIO que incluyas siempre una tarea final en el capítulo "DEMOLICIONES" para la "Carga, retirada y gestión de escombros", estimando el volumen (m3) o cantidad (u) lógica.
6. PRINCIPIO DE RESPONSABILIDAD ÚNICA: JAMÁS agrupes oficios o instalaciones diferentes en una sola tarea. Por ejemplo, NO agrupes "Demolición de fontanería y electricidad" en una sola, sepáralas en dos tareas distintas, porque la base de datos de precios estandarizada las trata por separado.
7. REGLA DE OBRA MAYOR (LOGÍSTICA Y SEGURIDAD): Si la petición describe una "Reforma Integral", "Obra Nueva" o supera los 80m2 de intervención aproximada: a) especifica en tu descripción que las tareas destructivas masivas sean "con medios mecánicos". b) ESTÁ PROHIBIDO añadir partidas de "SEGURIDAD Y SALUD", "Gestión de Residuos" o "Proyectos", porque este es un Catálogo Estricto de Ejecución Material (PEM) y esas partidas no existen.
8. RESTRICCIONES ESPACIALES (CRÍTICO): Si el cliente especifica que el "acceso es muy complicado", "espacios reducidos" o "sin acceso para maquinaria pesada", DEBES obligatoriamente redactar las tareas de excavación, movimiento de tierras o demolición añadiendo la coletilla "ejecutado con medios manuales o miniexcavadoras" a su campo "task". Esto anula la regla 7a para adaptarnos a la logística.
9. FIDELIDAD DE MATERIAL: Si en el contexto se detalla que el usuario ha exigido un material específico de forma explícita (ej. "pared de piedra", "encimera de granito"), es tu OBLIGACIÓN ABSOLUTA rellenar la propiedad \`userSpecificMaterial\` con ese valor exacto para esa tarea. El Agente Juez dependerá única y exclusivamente de este campo para presupuestar el precio de ese material con exactitud.
10. REGLA DE DEMOLICIÓN PREVIA: Si el usuario solicita reformar, alicatar o cambiar pavimentos/revestimientos en lugares ya construidos, es OBLIGATORIO que añadas primero una tarea en el capítulo "DEMOLICIONES" para el "Picado / Levantado / Demolición" de los azulejos o suelos preexistentes antes de generar la tarea de instalación del nuevo.

REGLAS CRÍTICAS - ESTRUCTURA Y CATÁLOGO COAATMCA:
1. Clasifica cada tarea asignándole el "chapter" (Capítulo) y "subchapter" (Subcapítulo) exactos según el siguiente catálogo jerárquico. 
2. Respeta el ORDEN CRONOLÓGICO de ejecución del catálogo (de arriba hacia abajo: Demoliciones -> Albañilería -> Instalaciones -> Revestimientos).
CATÁLOGO JERÁRQUICO:
${JSON.stringify(catalogContext)}

REGLAS CRÍTICAS - BUCLE CONVERSACIONAL (PROACTIVE QUESTIONING):
1. EVALUACIÓN DE DETALLES: Analiza si la petición tiene información suficiente para definir un presupuesto aproximado.
2. TOLERANCIA A LA AMBIGÜEDAD (ASUNCIÓN TÉCNICA Y REFORMAS PARCIALES): Si el cliente pide una reforma parcial explícita (p. ej., "reforma de un baño de 6m2", "cambiar 4 ventanas", "reformar cocina de 12m2"), BAJO NINGÚN CONCEPTO preguntes "¿Podría especificar qué áreas...?". Asume que el cliente SOLO quiere arreglar lo que ha mencionado y su superficie acotada. Igualmente, si no especifica el tipo de material, asume la opción más estándar.
3. SOLO utiliza el status "ASKING" si la ambigüedad rompe por completo la posibilidad de presupuestar. (Ej: "Quiero reformar la casa" sin indicar qué habitaciones ni los metros cuadrados). En ese caso, formula UNA SOLA pregunta en "question" y deja las "tasks" vacías.
4. Si puedes hacer asunciones lógicas o la información es clara (incluyendo áreas parciales bien definidas), usa "COMPLETE", genera las tareas, y deja "question" en null.

REGLAS CRÍTICAS DE ESTIMACIÓN PARAMÉTRICA (OBRA MAYOR O NUEVA):
Aplica ratios de aparejador del mundo real para evitar subpresupuestar drásticamente instalaciones y estructuras que en la base de datos se cobran por unidades pequeñas (micro):
- **Estructura/Cimentación:** Las bases de datos tarifan por m2, m3 o kg. Si el usuario pide estructura genérica y zapatas, estima el volumen aproximado en m3 de hormigón estructural a razón de 0.35m3 por cada 1 m2 de planta solicitada, y NO lo pidas en "unidades" aisladas (10 u).
- **Electricidad:** ¡Nunca uses "1 u" para una red eléctrica entera! El material se cobra por "punto eléctrico". Estima unos 40 puntos eléctricos por cada 100m2. La 'estimatedParametricUnit' para electricidad DEBE ser 'ud' o 'puntos', y la 'estimatedParametricQuantity' el cálculo proporcional. Si hay Cuadro General, añade otra tarea de 1 ud.
- **Fontanería:** Lo mismo. ¡Nunca uses "1 u" para "Fontanería de toda la casa"! Las bases cobran por "punto de agua". Estima entre 4 y 6 puntos de agua por cada baño/cocina, y presupuéstalos como 'ud' o 'puntos'.
- **Desglose de Plantas y Superficies (CRÍTICO):** NUNCA multipliques la superficie total por el número de tareas si el cliente pide UNA SOLA PLANTA. Ej: Para "150m2 en una planta", presupuesta exactamente 150m2 de Solera/Forjado sanitario, 150m2 de Forjado de cubierta, 150m2 de Suelo Radiante y 150m2 de Solado. ESTÁ PROHIBIDO inventar "Forjado de planta primera" o duplicar a 300m2 el suelo si el cliente no especificó múltiples plantas.
- **Revestimientos y Alicatados de Paredes (CRÍTICO):** Si el cliente pide alicatar un baño, pintar o revestir paredes y solo proporciona los m2 de la estancia en planta (ej: "un baño de 12m2"), DEBES estimar geométricamente la superficie de las PAREDES multiplicando esa huella por 2.5 (ej. 12m2 suelo -> 30m2 alicatado de paredes). ¡NUNCA asignes los m2 del suelo a las paredes!
- **DESGLOSE ATÓMICO OBLIGATORIO (Sanitarios, Mobiliario, Carpintería):** Nunca pidas conjuntos genéricos como "Aparatos sanitarios (6 ud)" o "Radiadores (10 ud)" en una sola tarea. La base de datos es micro (unitaria). Tienes que crear una tarea individual para cada tipo. Ej: Tarea 1: "Suministro e instalación de inodoro (2 ud)". Tarea 2: "Suministro e instalación de lavabo (2 ud)". Tarea 3: "Suministro e instalación de plato de ducha (2 ud)".
- **Suelo Radiante / Climatización / Pintura:** Utiliza siempre los m2 útiles intervenidos o m2 construidos. NUNCA los dupliques.

REGLAS CRÍTICAS DE CLASIFICACIÓN (CHAPTER ENUM & UNCLASSIFIED):
1. DEBES clasificar la tarea en uno de los capítulos principales del catálogo proporcionado (Usa su nombre exacto como Enum).
2. Si un material o partida es extremadamente inusual o no estás seguro al 100% de a qué capítulo pertenece, usa el comodín "UNCLASSIFIED". El sistema realizará una búsqueda heurística más amplia.
3. No abuses de "UNCLASSIFIED". Intenta encajar la partida donde dicte la lógica constructiva general.

REGLAS CRÍTICAS DE ECOSISTEMAS (DETONADORES OBLIGATORIOS):
Cuando el usuario pida conceptos genéricos, tu cerebro de Aparejador DEBE desglosarlos en estos Ecosistemas Paralelos:
1. **Baños:** Nunca pidas "Un Baño". Pide obligatoriamente: 1) Demolición previa de alicatados. 2) Red Saneamiento (desagües). 3) Fontanería (puntos de agua). 4) Aparatos Sanitarios atómicos (Inodoro, Lavabo). 5) Grifería. 6) Alicatados (superficie de paredes calculada multiplicando el área del suelo x 2.5).
2. **Cocinas:** Pide Fontanería, Electricidad, Alicatados (paredes calculadas multiplicando m2 de suelo x 2.5), y NUNCA OLVIDES generar una tarea atómica para "Mobiliario de cocina" (en ml) y otra para "Encimera" (en ml).
3. **Energía (Electricidad):** Nunca pidas "Instalación eléctrica". Pide OBLIGATORIAMENTE en 3 tareas separadas: 1) Cuadro General de Mando (1 ud). 2) Puntos de luz y enchufes (calcula ~40uds por 100m2). 3) Red de Toma de Tierra (1 ud).
4. **Climatización Integral:** Si piden "Suelo Radiante", DEBES añadir en paralelo una máquina generadora (ej: Aerotermia o Caldera, 1 ud). REGLA ESTRICTA (NO ALUCINES): Si el cliente ya especifica el sistema generador (ej. aerotermia, gas), ACÁTALO CIEGAMENTE.
5. **Envolvente (Obra Mayor/Nueva):** Si detectas ESTRUCTURA_OBRA_MAYOR, debes seguir este estricto árbol constructivo: 1) Acondicionamiento del terreno (Desbroce m2, Excavación m3). 2) Cimentación (Hormigón de Limpieza m2 y Zapatas m3). 3) Estructura (Pilares/Forjado). 4) Fachada exterior (Termoarcilla m2). 5) Aislamiento Térmico (SATE o Lana Roca m2). 6) Revestimiento interior (Pladur m2).


Petición del cliente:
"${userRequest}"

Instrucciones de Salida:
Devuelve EXCLUSIVAMENTE un bloque de código JSON con este nivel superior:
{
  "status": "ASKING" o "COMPLETE",
  "question": "Tu pregunta proactiva si status es ASKING, o null",
  "tasks": [ array de tareas si status es COMPLETE, o vacío ]
}

Cada objeto tarea en el array "tasks" debe tener:
- "taskId": Un identificador entero único y secuencial (1, 2, 3...) para esta tarea en este presupuesto.
- "dependsOn": Un array de enteros correspondientes a los "taskId" de las tareas que DEBEN terminarse antes de empezar esta. Ej: Para pintar (depende del tabique y del yeso). Si es la primera tarea (ej. Vallado o Demolición), envía un array vacío []. NO USES strings, usa enteros.
- "chapter": El capítulo EXACTO extrayendo SOLO UNO de los Capítulos Principales de la lista o "UNCLASSIFIED".
- "subchapter": Texto libre con el subcapítulo correspondiente.
- "reasoning": Una frase muy corta justificando POR QUÉ esta tarea.
- "task": Una descripción física clara y genérica de la tarea.
- "userSpecificMaterial": Material explícito o null.
- "isExplicitlyRequested": IMPORTANTE: Manda true SOLO si la tarea atiende a un comentario directo del prompt del cliente (ej. si pide una cocina, la encimera y muebles deben llevar true). Si es tarea inferida (escombros, cables sueltos, limpieza), manda false.
- "estimatedParametricUnit": La unidad paramétrica lógica (ej. "m2", "m", "u").
- "estimatedParametricQuantity": Cantidad estimada basada en contexto.
`;

        try {
            const result = await generateWithRetry({
                model: 'googleai/gemini-2.5-flash',
                prompt: prompt,
                output: {
                    format: 'json',
                    schema: ArchitectResponseSchema
                },
                config: {
                    temperature: 0.1, // Baja temperatura para clasificación sólida
                }
            });

            const response = result.output as unknown as ArchitectResponse;
            response.usage = result.usage;
            return response;
        } catch (error) {
            console.error("Architect Agent Error (Full Details):", error);
            if (error instanceof Error) {
                console.error("Message:", error.message);
                console.error("Stack:", error.stack);
            }
            throw new Error(`Failed to decompose request: ${error instanceof Error ? error.message : "Unknown API Error"}`);
        }
    }
}
