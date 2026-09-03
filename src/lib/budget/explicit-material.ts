/**
 * "[MATERIAL EXPLÍCITO: X]" es una marca que el backend (Python,
 * `generate_budget_from_nl_uc._task_to_restructured`) inyecta en la DESCRIPCIÓN
 * de la partida cuando el usuario pidió un material concreto. Su única función es
 * sesgar la búsqueda/selección del Swarm hacia ese material en tiempo de
 * generación. Una vez resuelta la partida NO aporta nada al texto y NO debe
 * aparecer en el presupuesto que se entrega al cliente (editor limpio + PDF).
 *
 * Estas utilidades separan el material solicitado (para auditoría / UX) del texto
 * limpio (para mostrar y exportar). El dato crudo en Firestore no se toca aquí;
 * la limpieza es de presentación (y de persistencia sólo cuando el editor guarda).
 */

// Tolerante a acentos (EXPLÍCITO/EXPLICITO), mayúsc/minúsc y espacios. Global para
// capturar varias marcas si las hubiera. Se usa sólo con String.replace (sin
// estado de lastIndex compartido).
const EXPLICIT_MATERIAL_RE = /\s*\[\s*MATERIAL\s+EXPL[IÍ]CITO\s*:\s*([^\]]*)\]/gi;

export interface ParsedExplicitMaterial {
    /** Texto sin la marca "[MATERIAL EXPLÍCITO: …]" ni dobles espacios. */
    clean: string;
    /** Material solicitado por el usuario (contenido de la marca), o null. */
    material: string | null;
}

export function parseExplicitMaterial(text: string | undefined | null): ParsedExplicitMaterial {
    if (!text) return { clean: text ?? '', material: null };
    let material: string | null = null;
    const clean = text
        .replace(EXPLICIT_MATERIAL_RE, (_full, captured: string) => {
            const c = (captured || '').trim();
            if (c && !material) material = c;
            return '';
        })
        .replace(/\s{2,}/g, ' ')
        .trim();
    return { clean, material };
}

/** Devuelve el texto sin la marca "[MATERIAL EXPLÍCITO: …]". */
export function stripExplicitMaterialTag(text: string | undefined | null): string {
    return parseExplicitMaterial(text).clean;
}
