/**
 * Measurement Extraction Flow
 * 
 * Uses Gemini Vision to extract line items (partidas) from a "Estado de Mediciones" PDF.
 * Input: Base64 encoded PDF or image
 * Output: Array of measurement items with code, description, unit, quantity
 */

import { ai, geminiFlash } from '@/backend/ai/core/config/genkit.config';
import { z } from 'zod';
import { PDFDocument } from 'pdf-lib';
import { emitGenerationEvent } from '@/backend/budget/events/budget-generation.emitter';

// Schema for extracted measurement items
export const MeasurementItemSchema = z.object({
    order: z.number().describe('Order/sequence number in the document'),
    code: z.string().optional().describe('Item code if present (e.g., 1.1, 2.3, etc.)'),
    description: z.string().describe('Full description of the work item'),
    unit: z.string().describe('Unit of measure (m2, m, ud, kg, etc.)'),
    quantity: z.number().describe('Measured quantity'),
    // These will be filled later by pricing flow
    unitPrice: z.number().optional(),
    totalPrice: z.number().optional(),
    // Added for classification
    type: z.enum(['PARTIDA', 'MATERIAL']).optional().describe('Classify if this is a labor unit (Partida) or pure supply (Material)'),
    page: z.number().optional().describe('Page number where this item was found'),
    chapter: z.string().optional().describe('Chapter name derived from context'),
    section: z.string().optional().describe('Section name derived from context'),
});

export type MeasurementItem = z.infer<typeof MeasurementItemSchema>;

const PageExtractionOutputSchema = z.object({
    items: z.array(MeasurementItemSchema).describe('List of measurement items found on this page'),
    detectedChapter: z.string().optional().describe('Chapter detected on this page (if any)'),
    detectedSection: z.string().optional().describe('Section detected on this page (if any)'),
    continuationDescription: z.string().optional().describe('If a description continues from previous page'),
});

const ExtractionOutputSchema = z.object({
    projectName: z.string().optional().describe('Project name if identified'),
    clientName: z.string().optional().describe('Client name if identified'),
    items: z.array(MeasurementItemSchema).describe('List of all measurement items extracted'),
    pageCount: z.number().optional().describe('Number of pages processed'),
});

export type ExtractionOutput = z.infer<typeof ExtractionOutputSchema>;

const getExtractionPrompt = (context: { chapter?: string, section?: string }) => `
Eres un experto en extracción de datos de documentos de construcción.
Estás analizando UNA SOLA PÁGINA de un documento PDF "Estado de Mediciones".

Contexto Anterior:
- Capítulo Actual: "${context.chapter || 'Desconocido'}"
- Sección Actual: "${context.section || 'Desconocida'}"

Tarea:
1. Analiza la imagen de esta página.
2. Identifica si hay un cambio de Capítulo o Sección (textos grandes/negrita).
3. Extrae TODAS las partidas (líneas de medición) visibles en esta página.
4. Si una descripción parece continuar de la página anterior, inclúyela completa.

Para cada partida, extrae:
- order: número secuencial
- code: código (ej: 1.1, 2.3). Si no hay, déjalo vacío.
- description: descripción del trabajo.
- unit: unidad (m², m, ud).
- quantity: cantidad.
- type: Clasifica el item:
    - "PARTIDA": Si implica mano de obra + materiales (ej: "Demolición de tabique", "Alicatado de baño").
    - "MATERIAL": Si es solo suministro de un producto (ej: "Grifo monomando", "Saco de cemento").
- chapter: EL NOMBRE DEL CAPÍTULO O FASE al que pertenece esta partida (ej. "01 ACTUACIONES PREVIAS"). Usa los subtítulos o textos gruesos que veas. Si no ves ningún título de capítulo, usa el "Capítulo Actual" del Contexto Anterior.

IMPORTANTE SOBRE NÚMEROS:
- El documento usa formato europeo/español: ',' para decimales y '.' para miles.
- Ejemplo: "1.200,50" es mil doscientos con cincuenta (1200.5).
- Ejemplo: "30,00" es treinta (30). NO lo confundas con tres mil.
- Ejemplo: "10.000" si son m2 en una vivienda, probablemente sea 10 con 3 decimales (10), no diez mil. Usa el sentido común.
- Devuelve SIEMPRE el número en formato JSON estándar (punto para decimales, sin separador de miles).

Formato JSON Estricto:
{
  "detectedChapter": "Nombre del capítulo principal de la página",
  "items": [
      { "chapter": "01 ACTUACIONES PREVIAS", "order": 1, "code": "1.1", "description": "Texto completo...", "unit": "m2", "quantity": 10.5, "type": "PARTIDA" }
  ]
}
No devuelvas Markdown rodeando el JSON ni texto adicional. SOLO JSON.`;

const getTextExtractionPrompt = (textChunk: string, currentChapterContext: string = 'Unknown') => `
Eres un experto en construcción. Extrae todas las partidas (líneas de medición) del siguiente fragmento de texto extraído de un presupuesto "Estado de Mediciones" en España (PEM).

Contexto Anterior:
- Capítulo Actual: "${currentChapterContext}"

Texto a analizar:
"""
${textChunk}
"""

Extrae cada partida considerando las siguientes REGLAS ESTRICTAS:
1. MULTI-LÍNEA: Las descripciones largas a menudo aparecen cortadas en múltiples saltos de línea físicos. DEBES concatenar mentalmente todas las líneas de texto que pertenezcan a la misma partida hasta hallar el bloque de precio/cantidad. NUNCA devuelvas una descripción cortada por la mitad. 
2. order: número secuencial.
3. code: código si está presente (ej. 1.1, 2.3).
4. description: TEXTO COMPLETO Y ABSOLUTAMENTE ÍNTEGRO de la descripción del trabajo, combinando todos los saltos de línea.
5. unit: unidad de medida (m2, m, ud, kg).
6. quantity: cantidad real encontrada. Atención a la coma decimal (ej. 10.200,50 -> 10200.5).
7. type: "PARTIDA" o "MATERIAL".
8. chapter: EL NOMBRE DEL CAPÍTULO O FASE al que pertenece esta partida (ej. "01 ACTUACIONES PREVIAS"). Usa los subtítulos o textos gruesos que veas. Si no ves ningún título de capítulo, usa el "Capítulo Actual" del Contexto Anterior.

Formato JSON Estricto:
{
  "detectedChapter": "Nombre del capítulo principal de la hoja si aparece",
  "items": [
      { "chapter": "01 ACTUACIONES PREVIAS", "order": 1, "code": "1.1", "description": "Texto completo o partido...", "unit": "m2", "quantity": 10.5, "type": "PARTIDA" }
  ]
}`;

export const measurementExtractionFlow = ai.defineFlow(
    {
        name: 'measurementExtractionFlow',
        inputSchema: z.object({
            pdfBase64: z.string().describe('Base64 encoded PDF'),
            mimeType: z.string().default('application/pdf'),
            leadId: z.string().optional().describe('Optional lead ID for progress tracking'),
        }),
        outputSchema: ExtractionOutputSchema,
    },
    async ({ pdfBase64, leadId }) => {
        console.log('[MeasurementExtraction] Starting Hybrid extraction...');

        const allItems: MeasurementItem[] = [];
        let pdfDoc;
        let pageCount = 1;

        try {
            pdfDoc = await PDFDocument.load(pdfBase64);
            pageCount = pdfDoc.getPageCount();
            console.log(`[MeasurementExtraction] PDF loaded.Pages: ${pageCount}`);
        } catch (e) {
            console.error("Error loading PDF metrics", e);
        }

        // 1. GATE 1: Fast Text Extraction via pdf2json
        let rawText = '';
        try {
            const buffer = Buffer.from(pdfBase64, 'base64');
            const PDFParser = require('pdf2json');
            const pdfParser = new PDFParser(this, 1); // 1 = Return raw text

            rawText = await new Promise((resolve, reject) => {
                pdfParser.on("pdfParser_dataError", (errData: any) => reject(errData.parserError));
                pdfParser.on("pdfParser_dataReady", (pdfData: any) => {
                    resolve(pdfParser.getRawTextContent());
                });
                pdfParser.parseBuffer(buffer);
            });

        } catch (error) {
            console.warn('[MeasurementExtraction] pdf-parse failed. Falling back to Vision.', error);
        }

        if (rawText.length > 500) {
            console.log(`[MeasurementExtraction] Found Text Layer(${rawText.length} chars).Executing FAST Parallel Text Extraction!`);
            if (leadId) emitGenerationEvent(leadId, 'batch_progress', { message: `Capa de texto detectada.Procesando ${Math.ceil(rawText.length / 3000)} bloques de texto en paralelo...` });

            // Smart chunking by page boundaries
            // pdf2json natively separates pages using "----------------Page (X) Break----------------"
            const pageDelimiters = /----------------Page \(\d+\) Break----------------/i;
            const textChunks = rawText.split(pageDelimiters)
                .map(chunk => chunk.trim())
                .filter(chunk => chunk.length > 50); // Ignore empty or very short junk pages

            console.log(`[MeasurementExtraction] Processing ${textChunks.length} chunks sequentially to preserve chapter context...`);

            let currentChapter = 'Unknown';
            for (let i = 0; i < textChunks.length; i++) {
                const chunk = textChunks[i];
                if (leadId) emitGenerationEvent(leadId, 'batch_progress', { message: `Analizando contexto del bloque de texto ${i + 1} de ${textChunks.length}...` });
                try {
                    const promptText = getTextExtractionPrompt(chunk, currentChapter);
                    const { output } = await ai.generate({
                        model: geminiFlash,
                        prompt: promptText,
                        output: { schema: PageExtractionOutputSchema },
                        config: { temperature: 0.1 }
                    });

                    if (output) {
                        if (output.detectedChapter && output.detectedChapter.trim().length > 3) {
                            currentChapter = output.detectedChapter;
                        }

                        if (output.items && output.items.length > 0) {
                            const enrichedItems = output.items.map(item => {
                                // If the item explicitly defined a chapter, update our running tracker
                                if (item.chapter && item.chapter.trim().length > 3) {
                                    currentChapter = item.chapter;
                                }
                                return {
                                    ...item,
                                    page: i + 1, // Mock page based on chunk index
                                    chapter: item.chapter || currentChapter
                                };
                            });
                            allItems.push(...enrichedItems);
                        }
                    }
                } catch (e) {
                    console.error(`Chunk ${i} extraction failed: `, e);
                }
            }

        } else {
            // 2. GATE 2: Vision Extraction (Slow Fallback)
            console.log('[MeasurementExtraction] No text layer found (Scanned Image). Using Vision Loop...');
            if (leadId) emitGenerationEvent(leadId, 'batch_progress', { message: `Documento escaneado.Iniciando Reconocimiento Visual(página a página)...` });
            if (!pdfDoc) throw new Error("Could not load PDF document for vision analysis");

            const maxPages = pageCount;
            let currentChapter = '';
            let currentSection = '';

            for (let i = 0; i < maxPages; i++) {
                const pageNum = i + 1;
                console.log(`[MeasurementExtraction] Processing Page ${pageNum}/${pageCount}...`);
                if (leadId) emitGenerationEvent(leadId, 'batch_progress', { message: `Analizando visualmente página ${pageNum} de ${maxPages}...` });

                const subPdf = await PDFDocument.create();
                const [copiedPage] = await subPdf.copyPages(pdfDoc, [i]);
                subPdf.addPage(copiedPage);
                const subPdfBytes = await subPdf.saveAsBase64();

                const promptText = getExtractionPrompt({ chapter: currentChapter, section: currentSection });

                try {
                    const { output } = await ai.generate({
                        model: geminiFlash,
                        prompt: [
                            { text: promptText },
                            {
                                media: {
                                    url: `data:application/pdf;base64,${subPdfBytes}`,
                                    contentType: 'application/pdf'
                                }
                            }
                        ],
                        output: { schema: PageExtractionOutputSchema },
                        config: { temperature: 0.1 }
                    });

                    if (output) {
                        if (output.detectedChapter) currentChapter = output.detectedChapter;
                        if (output.detectedSection) currentSection = output.detectedSection;

                        const enrichedItems = output.items.map(item => {
                            if (item.chapter && item.chapter.trim().length > 3) {
                                currentChapter = item.chapter;
                            }
                            if (item.section && item.section.trim().length > 3) {
                                currentSection = item.section;
                            }
                            return {
                                ...item,
                                page: pageNum,
                                chapter: item.chapter || currentChapter,
                                section: item.section || currentSection
                            };
                        });

                        allItems.push(...enrichedItems);
                        console.log(`  -> Page ${pageNum}: Found ${enrichedItems.length} items.`);
                    }
                } catch (error) {
                    console.error(`  -> Error processing page ${pageNum}:`, error);
                }
            }
        }

        // 3. GATE 3: Phase 13 Dimensional Reasoning & Inference (Interceptor)
        console.log('[MeasurementExtraction] Starting Dimensional Inference for generic units (ud, pa)...');
        if (leadId) emitGenerationEvent(leadId, 'batch_progress', { message: `Aplicando cálculo de razonamiento dimensional automático a unidades genéricas...` });

        const DimensionalInferenceSchema = z.object({
            hasDimensions: z.boolean().describe('True if mathematical dimensions were found in the description'),
            inferredUnit: z.string().optional().describe('The calculated physical unit (m2, m3, m, kg)'),
            inferredQuantity: z.number().optional().describe('The mathematically calculated result of the dimensions (e.g. 50 * 0.1 = 5)'),
            reasoning: z.string().describe('Explain the math formula used')
        });

        const refinedItems: MeasurementItem[] = [];
        for (const item of allItems) {
            let processedItem = item;

            // Check if unit is generic 'ud', 'pa', 'u' etc.
            const genericUnits = ['ud', 'ud.', 'u', 'pa', 'pa.', 'u.', 'unidad', 'unidades'];
            if (item.unit && genericUnits.includes(item.unit.toLowerCase().trim())) {
                try {
                    console.log(`[MeasurementExtraction] Dimensional Inference triggered for: ${item.description.substring(0, 50)}...`);
                    if (leadId) emitGenerationEvent(leadId, 'batch_progress', { message: `Infiriendo dimensiones para: ${item.description.substring(0, 40)}...` });
                    const { output } = await ai.generate({
                        model: geminiFlash,
                        prompt: `
                        Eres una calculadora CYPE / Arquitectónica.
                        Esta partida tiene unidad genérica "ud" pero necesitamos dimensionarla físicamente para emparejarla con la base de datos (m2, m3, m, kg).
                        
                        Descripción de la partida:
                        """${item.description}"""
                        
                        Busca medidas literales (ej: 50m2, 10cm de espesor, 3m de largo).
                        IMPORTANTE SOBRE SUPERFICIES (Capas, Gravas, Soleras, Pinturas):
                        - Si ves Área y Espesor (ej. 50m2 * 0.10m), DEBES DEVOLVER EL ÁREA ORIGINAL (50). El inferredUnit debe ser "m2". Casi todas las partidas de formación de base, grava o pavimentación se pagan por metro cuadrado, no por volumen. El espesor es solo descriptivo.
                        - SOLO debes calcular Volumen (m3) si la partida es claramente de "Excavación", "Vaciado", "Relleno masivo" o si la unidad original ya sugería que se necesitaba volumen.
                        - Si ves solo un Largo (lineal) -> El inferredUnit debe ser "m" o "ml".
                        - Convierte todo a metros antes de calcular nada si hiciera falta.
                        
                        Si no hay números dimensionales claros, marca hasDimensions: false.
                        `,
                        output: { schema: DimensionalInferenceSchema },
                        config: { temperature: 0.1 }
                    });

                    if (output?.hasDimensions && output.inferredUnit && output.inferredQuantity) {
                        console.log(`  -> Math Inferred! ${item.unit} -> ${output.inferredUnit}, Qty: ${item.quantity} -> ${output.inferredQuantity}`);
                        processedItem = {
                            ...item,
                            unit: output.inferredUnit,
                            quantity: output.inferredQuantity,
                            // Append to the description so the user knows what AI did
                            description: `${item.description}\n\n[IA Dimensional: Convertido de ${item.quantity} ${item.unit} a ${output.inferredQuantity} ${output.inferredUnit} mediante cálculo: ${output.reasoning}]`
                        };
                    }
                } catch (err) {
                    console.error('[MeasurementExtraction] Error in Dimensional Inference:', err);
                }
            }
            refinedItems.push(processedItem);
        }

        console.log(`[MeasurementExtraction] Complete. Total items mapped & refined: ${refinedItems.length}`);

        return {
            items: refinedItems,
            pageCount: pageCount,
            projectName: 'Detected Project',
        };
    }
);
