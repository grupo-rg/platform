import { EditableBudgetLineItem } from '@/types/budget-editor';

export const CHAPTER_DROPPABLE_PREFIX = 'chapter:';

/**
 * Recalcula el array global de partidas tras un drag-and-drop (@dnd-kit),
 * soportando el movimiento ENTRE capítulos.
 *
 * - `activeId`: id de la partida arrastrada.
 * - `overId`: id de la partida destino, o `chapter:<nombre>` si se soltó sobre
 *   el contenedor de un capítulo (típicamente uno vacío).
 *
 * Devuelve un array nuevo, agrupado por el orden de `chapters`, con `chapter` y
 * `order` (1..n por capítulo) actualizados. Devuelve `null` si no hay cambio.
 */
export function reorderOnDragEnd(
    items: EditableBudgetLineItem[],
    chapters: string[],
    activeId: string,
    overId: string,
): EditableBudgetLineItem[] | null {
    // 1) Orden canónico: por orden de capítulos, y dentro de cada uno el orden
    //    en que aparecen en `items` (que es el orden de display actual).
    const grouped: EditableBudgetLineItem[] = [];
    for (const ch of chapters) {
        for (const it of items) if (it.chapter === ch) grouped.push(it);
    }
    // Huérfanos (capítulo no listado) al final, por seguridad.
    for (const it of items) if (!chapters.includes(it.chapter as string)) grouped.push(it);

    const activeIndex = grouped.findIndex(i => i.id === activeId);
    if (activeIndex < 0) return null;
    const active = grouped[activeIndex];

    // 2) Resolver capítulo e índice de inserción destino.
    let targetChapter: string;
    let insertIndex: number;

    if (overId.startsWith(CHAPTER_DROPPABLE_PREFIX)) {
        targetChapter = overId.slice(CHAPTER_DROPPABLE_PREFIX.length);
        // Fin del bloque del capítulo destino (funciona también si está vacío):
        // nº de ítems en capítulos anteriores-o-igual al destino en el orden de `chapters`.
        const targetPos = chapters.indexOf(targetChapter);
        insertIndex = grouped.filter(it => {
            const p = chapters.indexOf(it.chapter as string);
            return p !== -1 && p <= targetPos;
        }).length;
    } else {
        const overIndex = grouped.findIndex(i => i.id === overId);
        if (overIndex < 0) return null;
        targetChapter = grouped[overIndex].chapter as string;
        insertIndex = overIndex;
    }

    // 3) Quitar el activo e insertar en destino (ajustando si iba antes).
    const without = grouped.filter((_, idx) => idx !== activeIndex);
    let idx = activeIndex < insertIndex ? insertIndex - 1 : insertIndex;
    if (idx < 0) idx = 0;
    if (idx > without.length) idx = without.length;

    const moved: EditableBudgetLineItem = { ...active, chapter: targetChapter, isDirty: true };
    without.splice(idx, 0, moved);

    // Sin cambio real (mismo capítulo y misma posición) → no dispatch.
    if (moved.chapter === active.chapter && idx === activeIndex) return null;

    // 4) Reindexar `order` por capítulo.
    const counters: Record<string, number> = {};
    return without.map(it => {
        const ch = it.chapter as string;
        counters[ch] = (counters[ch] || 0) + 1;
        return { ...it, order: counters[ch] };
    });
}
