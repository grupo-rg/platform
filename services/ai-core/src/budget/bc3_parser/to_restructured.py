"""Adapter Bc3Tree → List[RestructuredItem].

Produce el mismo shape que el parser TABULAR de PDFs, para que el
pipeline aguas abajo (SwarmPricingService, HybridCatalogSearch, etc.) no
necesite saber qué formato entró.
"""

from __future__ import annotations

import re
from typing import List, Optional, Tuple

from src.budget.bc3_parser.entities import Bc3ConceptKind, Bc3Tree


# --- Fallback de cantidad para BC3 CIEGOS (mediciones ~M con total=0) ----------
# Algunos exportadores no escriben la medición en los registros ~M (total=0, sin
# parciales) y la vuelcan en el TEXTO de la descripción, seguida del número de
# parcial (p.ej. "… 25,85 m² 1.1 Replanteo …", "… 2,00 Ud 1.2 …"). Este helper
# recupera esa cantidad+unidad del texto para no quedarnos con cantidad 0 → total 0€.
# Se mantiene AMPLIO: unidades habituales del oficio y ancla en el marcador de
# parcial "N.N" tras la unidad (no solo "1.1"). Solo se usa cuando ~M viene ciego.
_BC3_UNIT_ALT = r"(?:uds|ud|u|m2|m²|m3|m³|ml|kg|dm3|dm³|cm|h|l|t|pa|%)"
_QTY_FROM_TEXT_RE = re.compile(
    r"([0-9]+(?:[.,][0-9]+)?)\s*(" + _BC3_UNIT_ALT + r")\b\s*(?=\d+\.\d+)",
    re.IGNORECASE,
)


def _normalize_bc3_unit(unit: str) -> str:
    u = (unit or "").strip().lower()
    return {"m²": "m2", "m³": "m3", "dm³": "dm3", "uds": "ud", "u": "ud"}.get(u, u)


def _extract_qty_from_text(text: str) -> Optional[Tuple[float, str, int]]:
    """Devuelve (cantidad, unidad_normalizada, posición_inicio) si el texto lleva
    una medición del tipo "<nº> <unidad> <N.N>", o None. La posición permite
    recortar la anotación de la descripción."""
    if not text:
        return None
    m = _QTY_FROM_TEXT_RE.search(text)
    if not m:
        return None
    qty_raw = m.group(1).replace(".", "").replace(",", ".") if "," in m.group(1) else m.group(1)
    try:
        qty = float(qty_raw)
    except ValueError:
        return None
    if qty <= 0:
        return None
    return qty, _normalize_bc3_unit(m.group(2)), m.start()


def bc3_tree_to_restructured_items(tree: Bc3Tree) -> List["RestructuredItem"]:
    """Recorre el árbol BC3 y emite un RestructuredItem por cada partida medida.

    Algoritmo:
      1. Para cada concepto con `kind == PARTIDA` (tiene `~M`):
         - code = código BC3
         - description = description + long_description concatenados
         - quantity = `~M.total_quantity` (autoritativo)
         - unit = `~C.unit`
         - chapter = inferido recorriendo padres vía decompositions
      2. Saltar capítulos puros (los partidas ya los referencian).
      3. Saltar componentes (van dentro del partida que los usa, no son
         entries top-level).
    """
    # Import diferido para no crear dependencia circular en tiempo de carga.
    from src.budget.application.services.pdf_extractor_service import RestructuredItem

    # Mapa inverso: child_code → parent_code (para reconstruir chapter path).
    parent_of: dict[str, str] = {}
    for parent_code, decomp in tree.decompositions.items():
        for child_code, _factor in decomp.children:
            # Si un código aparece como hijo de varios padres, conservamos el
            # primero visto (en BC3 bien formado esto no suele pasar).
            parent_of.setdefault(child_code, parent_code)

    def find_chapter_path(code: str) -> str:
        """Recorre hacia arriba y devuelve el primer ancestro CHAPTER."""
        seen: set[str] = set()
        current = parent_of.get(code)
        while current and current not in seen:
            seen.add(current)
            concept = tree.concepts.get(current)
            if concept and concept.kind == Bc3ConceptKind.CHAPTER:
                # Formato consistente con el parser TABULAR: "CODE Nombre del capítulo".
                # El marcador de capítulo FIEBDC ('#'/'##') no debe verse en el título.
                clean_code = concept.code.rstrip("#").strip() or concept.code
                if concept.description:
                    return f"{clean_code} {concept.description}".strip()
                return clean_code
            current = parent_of.get(current)
        return "Sin Capítulo"

    items: List[RestructuredItem] = []
    for code, concept in tree.concepts.items():
        if concept.kind != Bc3ConceptKind.PARTIDA:
            continue
        # Una PARTIDA puede venir SIN `~M` en exports jerárquicos "en blanco"
        # (plantilla capítulo→partida sin mediciones). No la descartamos: la
        # emitimos con cantidad recuperada del texto o, en su defecto, 1 (irá a
        # revisión) para que el pipeline la valore igualmente. Antes se perdía.
        measurement = tree.measurements.get(code)

        # Descripción extensa: combinar `~C.description` (corta) + `~T` (extendida).
        short = concept.description.strip()
        long = concept.long_description.strip()
        if short and long:
            description = f"{short}. {long}"
        elif long:
            description = long
        else:
            description = short or code  # fallback: código si no hay nada

        # Cantidad + unidad: normalmente del ~M. Si el ~M viene CIEGO (total 0, sin
        # parciales) O NO HAY ~M (partida "en blanco" de plantilla jerárquica),
        # recuperamos la medición del TEXTO de la descripción y de paso limpiamos la
        # anotación pegada. Fallback final: 1 (irá a revisión) para no quedar en 0
        # (0 × precio = 0€). Los BC3 bien formados con ~M válido NO entran aquí.
        quantity = measurement.total_quantity if measurement is not None else 0.0
        unit = concept.unit or "ud"
        if quantity is None or quantity <= 0:
            extracted = _extract_qty_from_text(description)
            if extracted is not None:
                qty_x, unit_x, cut_at = extracted
                quantity = qty_x
                if not (concept.unit or "").strip():
                    unit = unit_x
                cleaned = description[:cut_at].strip().rstrip(".·-–— ").strip()
                if cleaned:
                    description = cleaned
            else:
                quantity = 1.0

        # BC3 con precio: importamos el precio del archivo. Un BC3 "ciego" trae
        # price=0.0 → lo tratamos como "sin precio" (None) para el flujo híbrido.
        bc3_price = concept.price if (concept.price and concept.price > 0) else None

        # Estado de mediciones estructurado (serializado a dicts para el pipeline).
        measurement_lines = None
        if measurement is not None and measurement.lines:
            measurement_lines = [
                {
                    "comment": ln.comment,
                    "units": ln.units,
                    "length": ln.length,
                    "width": ln.width,
                    "height": ln.height,
                    "subtotal": ln.subtotal,
                    "is_section": ln.is_section,
                }
                for ln in measurement.lines
            ]

        items.append(
            RestructuredItem(
                code=code,
                description=description,
                quantity=quantity,
                unit=unit,
                chapter=find_chapter_path(code),
                sub_chapter=None,  # BC3 no distingue sub-capítulo explícito
                bc3_unit_price=bc3_price,
                measurements=measurement_lines,
            )
        )

    return items
