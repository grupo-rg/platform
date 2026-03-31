import { gemini25Flash } from '../../shared/config/genkit.config';
import { generateWithRetry } from '../../shared/utils/ai-retry';
import { FirestorePriceBookRepository } from '../../../../backend/price-book/infrastructure/firestore-price-book-repository';
import { RestApiVectorizerAdapter } from '../../../../backend/price-book/infrastructure/ai/rest-api-vectorizer.adapter';
import { PriceBookItem } from '../../../../backend/price-book/domain/price-book-item';
import { DecomposedTask } from './architect.agent';

/**
 * The Surveyor Agent takes decomposed tasks from the Architect and searches the DB.
 */
export class SurveyorAgent {
    private repository: FirestorePriceBookRepository;
    private vectorizer: RestApiVectorizerAdapter;

    constructor() {
        this.repository = new FirestorePriceBookRepository('price_book_2025');
        this.vectorizer = new RestApiVectorizerAdapter();
    }

    private readonly model = gemini25Flash; // Use a faster model for simple expansion

    /**
     * TDD Strategy: Tests the core reasoning logic of the Surveyor Agent before hitting an expensive Vector DB.
     * Generates semantic variations for a given construction term to improve RAG recall.
     */
    async generateQueryExpansions(task: DecomposedTask): Promise<{ queries: string[], usage?: any }> {
        const prompt = `
Eres el "Agente Aparejador Buscador" (Surveyor Agent RAG).
Tu objetivo es tomar la descripción de una tarea constructiva y aplicar "Multi-Query Expansion" para maximizar el *Recall* al buscar en nuestra Base de Datos Vectorial (Firestore 768d).

DATOS DE LA TAREA:
- Tarea Original: "${task.task}"
- Capítulo: "${task.chapter}"

REGLAS PARA LA EXPANSIÓN:
1. Genera exactamente entre 3 y 5 variaciones de búsqueda para la tarea.
2. Usa sinónimos técnicos, nombres comerciales genéricos aceptados y argot de obra en España (ej. Pladur -> Cartón yeso, Tabiquería seca, Placa de yeso laminado PYL).
3. Busca variaciones que abarquen tanto "mano de obra" (colocación, instalación) como el "material" (suministro, pieza).
4. NO incluyas cantidades numéricas ni marcas específicas. Concéntrate en la esencia de la partida base.

INSTRUCCIONES DE SALIDA:
Devuelve EXCLUSIVAMENTE un array de strings en formato JSON plano, sin propiedades extra ni bloques markdown.
Ejemplo: 
[
  "Suministro y colocación de tabique de pladur", 
  "Tabiquería seca cartón yeso", 
  "Montaje de tabique PYL"
]
`;
        try {
            const result = await generateWithRetry({
                model: this.model,
                prompt: prompt,
                config: { temperature: 0.2 }
            });

            const cleanJson = result.text.replace(/```json\n|\n```|```/g, '').trim();
            const queries: string[] = JSON.parse(cleanJson);
            // Always ensure the precise original task is included for strict matching
            return { queries: [task.task, ...queries], usage: result.usage };
        } catch (error) {
            console.error("Surveyor Agent Expansion Error:", error);
            return { queries: [task.task] }; // Fallback to original
        }
    }

    /**
     * Executes the hybrid search against the specific collection for 2025.
     */
    async retrieveCandidates(task: DecomposedTask, topK: number = 5): Promise<PriceBookItem[]> {
        const queryTerm = task.task;

        // We only use the original query embedding for now as the RestApiVectorizerAdapter expects a single string.
        // In a true Multi-Query architecture with a dedicated vector engine, we would sum/average embeddings 
        // or execute 5 parallel searches and deduplicate.
        const queryEmbedding = await this.vectorizer.embedText(queryTerm);

        // Smart Routing: We removed the HARD chapter filter. 
        // If the Architect guesses the wrong chapter (e.g., putting a ventilation hole in "RED DE VENTILACIÓN" instead of "OBRAS VARIAS"), 
        // a hard filter would return 0 correct results. Instead, we cast a wider net and soft-boost.
        let candidates = await this.repository.searchByVectorWithFilters(
            queryEmbedding,
            {}, // Unfiltered
            topK * 2
        );

        if (task.chapter !== "UNCLASSIFIED") {
            // Apply a 15% soft-boost to semantic scores that match the Architect's requested chapter
            // This favors logical organization but doesn't blind the AI to obvious semantic matches in other chapters.
            candidates = candidates.map((c: any) => ({
                ...c,
                matchScore: c.chapter === task.chapter ? c.matchScore * 1.15 : c.matchScore
            })).sort((a: any, b: any) => b.matchScore - a.matchScore);
        }

        return candidates.slice(0, topK);
    }
}
