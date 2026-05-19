/**
 * Sprint 3 — S3-07 partial
 *
 * Entidad `CorrectionPair`: persiste cada vez que un humano corrige una partida
 * en el editor de presupuestos. Captura la TERNA RLHF mínima
 *   (query_text, ai_proposed, human_chosen)
 * y deriva el `correction_type` a partir del diff entre la propuesta IA y la
 * elección humana, sin tocar el JSON original (que vive en `ai_training_traces`
 * via `SaveFinalHumanEditUseCase`).
 *
 * Esta colección sirve como dataset para el reentreno del bi-encoder/reranker
 * (Sprint 3.B). En este sprint solo persistimos pares; el reentreno es manual
 * + humano.
 */
export type CorrectionType =
    | 'mismatch'              // ai propuso codeA, humano eligió codeB
    | 'no_match_then_match'   // ai dijo from_scratch / sin code, humano asignó code real
    | 'unit_fix'              // solo cambió la unidad
    | 'quantity_fix'          // solo cambió la cantidad
    | 'price_fix';            // solo cambió el precio

export interface CorrectionPairAiProposed {
    code: string;
    description: string;
    unitPrice: number;
    matchConfidence: number;
}

export interface CorrectionPairHumanChosen {
    code: string;
    description: string;
    unitPrice: number;
    /** Opcional — capturamos unit y quantity para detectar unit_fix / quantity_fix. */
    unit?: string;
    quantity?: number;
}

export interface CorrectionPairAiProposedExtra extends CorrectionPairAiProposed {
    /** Opcional — se usa solo para clasificar unit_fix / quantity_fix sin alterar el schema persistido. */
    unit?: string;
    quantity?: number;
}

export interface CorrectionPairProps {
    id: string;
    budgetId: string;
    partidaCode: string;
    query_text: string;
    ai_proposed: CorrectionPairAiProposed;
    human_chosen: CorrectionPairHumanChosen;
    correction_type: CorrectionType;
    corrected_at: Date;
    corrected_by: string;
}

/**
 * Códigos que el motor IA emite cuando NO encontró match en el catálogo
 * (placeholder "from scratch"). Si el humano cambia uno de estos a algo real,
 * clasificamos como `no_match_then_match`.
 *
 * Mantener sincronizado con los emisores en `src/backend/ai/**`:
 *   - `GENERIC-EXPLICIT` aparece en `TableRowItem` con tratamiento UI especial.
 *   - `from_scratch` viene del flow recurse cuando el judge rechaza candidatos.
 *   - cadenas vacías o `---` aparecen cuando el catálogo no devuelve nada.
 */
const FROM_SCRATCH_CODES = new Set<string>([
    '',
    '---',
    'from_scratch',
    'FROM_SCRATCH',
    'GENERIC-EXPLICIT',
]);

function isFromScratch(code: string | undefined | null): boolean {
    if (code == null) return true;
    return FROM_SCRATCH_CODES.has(code.trim());
}

function near(a: number, b: number, epsilon = 0.001): boolean {
    return Math.abs(a - b) < epsilon;
}

/**
 * Clasifica el tipo de corrección comparando la propuesta IA y la elección
 * humana. La prioridad es:
 *   1. `no_match_then_match` — ai era placeholder, humano asignó code real.
 *   2. `mismatch` — humano cambió de un code real a otro code real.
 *   3. `unit_fix` — solo cambió `unit` y el resto coincide.
 *   4. `quantity_fix` — solo cambió `quantity` y el resto coincide.
 *   5. `price_fix` — fallback cuando solo cambió `unitPrice`.
 *
 * Los empates entre múltiples cambios resuelven por la prioridad anterior:
 *   - si code Y unit cambian → `mismatch` (porque code domina).
 *   - si unit Y quantity cambian → `unit_fix` (por orden declarado).
 */
export function classifyCorrection(
    ai: CorrectionPairAiProposedExtra,
    human: CorrectionPairHumanChosen,
): CorrectionType {
    const aiPlaceholder = isFromScratch(ai.code);
    const humanReal = !isFromScratch(human.code);

    if (aiPlaceholder && humanReal) return 'no_match_then_match';

    const codeChanged = (ai.code || '').trim() !== (human.code || '').trim();
    if (codeChanged) return 'mismatch';

    // A partir de aquí el code es el mismo (o ambos placeholders). Detectamos
    // sub-correcciones puras.
    const unitChanged =
        ai.unit !== undefined &&
        human.unit !== undefined &&
        (ai.unit || '').trim().toLowerCase() !== (human.unit || '').trim().toLowerCase();
    const quantityChanged =
        ai.quantity !== undefined &&
        human.quantity !== undefined &&
        !near(ai.quantity, human.quantity);
    const priceChanged = !near(ai.unitPrice, human.unitPrice);

    if (unitChanged) return 'unit_fix';
    if (quantityChanged) return 'quantity_fix';
    if (priceChanged) return 'price_fix';

    // Defensa: si no cambió nada material el caller no debería estar llamando,
    // pero devolvemos `price_fix` como fallback semántico neutro.
    return 'price_fix';
}

export class CorrectionPair {
    private constructor(private readonly props: CorrectionPairProps) {
        this.validate(props);
    }

    private validate(p: CorrectionPairProps): void {
        if (!p.id) throw new Error('CorrectionPair: id is required');
        if (!p.budgetId) throw new Error('CorrectionPair: budgetId is required');
        if (!p.partidaCode) throw new Error('CorrectionPair: partidaCode is required');
        if (!p.query_text || p.query_text.trim() === '') {
            throw new Error('CorrectionPair: query_text is required');
        }
        if (!p.corrected_by) throw new Error('CorrectionPair: corrected_by is required');
        if (!(p.corrected_at instanceof Date) || isNaN(p.corrected_at.getTime())) {
            throw new Error('CorrectionPair: corrected_at must be a valid Date');
        }
    }

    public static create(input: {
        id: string;
        budgetId: string;
        partidaCode: string;
        query_text: string;
        ai_proposed: CorrectionPairAiProposedExtra;
        human_chosen: CorrectionPairHumanChosen;
        corrected_by: string;
        corrected_at?: Date;
        /**
         * Override opcional para tests; en producción se deriva con
         * `classifyCorrection(ai, human)`.
         */
        correction_type?: CorrectionType;
    }): CorrectionPair {
        const correction_type =
            input.correction_type ?? classifyCorrection(input.ai_proposed, input.human_chosen);
        return new CorrectionPair({
            id: input.id,
            budgetId: input.budgetId,
            partidaCode: input.partidaCode,
            query_text: input.query_text,
            // Persistimos SOLO el schema canónico (sin unit/quantity extra) para
            // no expandir Firestore con campos opcionales.
            ai_proposed: {
                code: input.ai_proposed.code,
                description: input.ai_proposed.description,
                unitPrice: input.ai_proposed.unitPrice,
                matchConfidence: input.ai_proposed.matchConfidence,
            },
            human_chosen: {
                code: input.human_chosen.code,
                description: input.human_chosen.description,
                unitPrice: input.human_chosen.unitPrice,
                ...(input.human_chosen.unit ? { unit: input.human_chosen.unit } : {}),
                ...(input.human_chosen.quantity !== undefined
                    ? { quantity: input.human_chosen.quantity }
                    : {}),
            },
            correction_type,
            corrected_at: input.corrected_at ?? new Date(),
            corrected_by: input.corrected_by,
        });
    }

    public toMap(): Record<string, any> {
        return {
            ...this.props,
            corrected_at: this.props.corrected_at.toISOString(),
        };
    }

    public static fromMap(data: any): CorrectionPair {
        return new CorrectionPair({
            id: data.id,
            budgetId: data.budgetId,
            partidaCode: data.partidaCode,
            query_text: data.query_text,
            ai_proposed: data.ai_proposed,
            human_chosen: data.human_chosen,
            correction_type: data.correction_type,
            corrected_by: data.corrected_by,
            corrected_at: data.corrected_at
                ? new Date(data.corrected_at)
                : new Date(),
        });
    }

    get id(): string { return this.props.id; }
    get budgetId(): string { return this.props.budgetId; }
    get partidaCode(): string { return this.props.partidaCode; }
    get queryText(): string { return this.props.query_text; }
    get aiProposed(): CorrectionPairAiProposed { return this.props.ai_proposed; }
    get humanChosen(): CorrectionPairHumanChosen { return this.props.human_chosen; }
    get correctionType(): CorrectionType { return this.props.correction_type; }
    get correctedAt(): Date { return this.props.corrected_at; }
    get correctedBy(): string { return this.props.corrected_by; }
}

export interface CorrectionPairRepository {
    save(pair: CorrectionPair): Promise<void>;
    findById(id: string): Promise<CorrectionPair | null>;
    findByBudgetId(budgetId: string): Promise<CorrectionPair[]>;
    /** Para el dashboard `/admin/model-health` (S3-09). */
    count(): Promise<number>;
    /** Para el dashboard `/admin/model-health` — agrupa por `ai_proposed.code`. */
    findAll(limit?: number): Promise<CorrectionPair[]>;
}
