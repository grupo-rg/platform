/**
 * Phase 17.3 — Re-bakeo de partidas antes de persistir cuando el admin
 * cambia GG o BI en el editor de un budget `phase17-markup-baked`.
 *
 * Invariante phase17: las partidas en Firestore están baked al `budget.config`
 * actual. Si admin modifica GG=10→12 y guarda:
 *   - Sin re-bake: partidas siguen al factor 1,25 pero budget.config dice 1,27
 *     → on reload, bakedFactor=1,27 con partidas al 1,25 → desfase visual.
 *   - Con re-bake: partidas se multiplican por currentFactor/bakedFactor antes
 *     de persistir → consistencia restaurada.
 *
 * Para legacy phase15: no-op (esos budgets almacenan raw, el frontend
 * multiplica por currentFactor en display).
 */

type Config = { marginGG: number; marginBI: number; tax: number };

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function rebakePartidasIfFactorChanged(
    chapters: any[],
    calibrationVersion: string | undefined,
    currentConfig: Config | undefined,
    bakedConfig: Config | undefined,
): any[] {
    if (calibrationVersion !== 'phase17-markup-baked') return chapters;
    if (!bakedConfig || !currentConfig) return chapters;

    const currentFactor = 1 + ((currentConfig.marginGG || 0) + (currentConfig.marginBI || 0)) / 100;
    const bakedFactor = 1 + ((bakedConfig.marginGG || 0) + (bakedConfig.marginBI || 0)) / 100;

    if (bakedFactor <= 0) return chapters;
    // Tolerancia 0,01% para evitar re-bake por ruido de coma flotante.
    if (Math.abs(currentFactor - bakedFactor) / bakedFactor < 0.0001) return chapters;

    const ratio = currentFactor / bakedFactor;

    return chapters.map((chapter) => {
        const newItems = (chapter.items || []).map((item: any) => {
            if (item.type !== 'PARTIDA') return item;
            const newUnitPrice = round2((item.unitPrice || 0) * ratio);
            const newTotalPrice = round2((item.totalPrice || 0) * ratio);
            return {
                ...item,
                unitPrice: newUnitPrice,
                totalPrice: newTotalPrice,
                breakdown: Array.isArray(item.breakdown)
                    ? item.breakdown.map((b: any) => ({
                          ...b,
                          price: round2((b.price || 0) * ratio),
                          total: round2((b.total || 0) * ratio),
                      }))
                    : item.breakdown,
            };
        });
        return {
            ...chapter,
            items: newItems,
            totalPrice: round2(
                newItems.reduce((acc: number, i: any) => acc + (i.totalPrice || 0), 0),
            ),
        };
    });
}
