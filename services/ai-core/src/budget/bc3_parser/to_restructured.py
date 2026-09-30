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


def _document_order(tree: Bc3Tree) -> List[str]:
    """Códigos de concepto en el ORDEN DEL DOCUMENTO: recorrido en profundidad del
    árbol `~D` desde la raíz, respetando el orden de los hijos de cada `~D`.

    No se puede usar el orden de `tree.concepts`: los exportadores (Presto, p.ej.)
    escriben los `~C` ordenados alfabéticamente por código, no en el orden del
    presupuesto. Además los `~D` referencian a los hijos SIN el marcador de
    capítulo (`DINS01` frente al concepto `DINS01#`), así que se resuelve por
    código normalizado. Los conceptos que el recorrido no alcanza (huérfanos) se
    añaden al final en su orden original, para no perder ninguno."""
    by_norm: dict[str, str] = {}
    for code in tree.concepts:
        by_norm.setdefault(code.rstrip("#").strip(), code)
    decomp_by_norm = {pc.rstrip("#").strip(): d for pc, d in tree.decompositions.items()}
    referenced = {cc.rstrip("#").strip() for d in tree.decompositions.values() for cc, _ in d.children}

    # Raíz del documento: el concepto '##'; si no hay, los no referenciados en orden.
    roots = [c for c in tree.concepts if c.rstrip().endswith("##")]
    if not roots:
        roots = [c for c in tree.concepts if c.rstrip("#").strip() not in referenced and c.rstrip("#").strip() in decomp_by_norm]

    ordered: List[str] = []
    seen: set[str] = set()
    stack: List[str] = list(reversed(roots))
    while stack:
        code = stack.pop()
        norm = code.rstrip("#").strip()
        if norm in seen:
            continue
        seen.add(norm)
        real = by_norm.get(norm)
        if real is not None:
            ordered.append(real)
        decomp = decomp_by_norm.get(norm)
        if decomp:
            stack.extend(child for child, _ in reversed(decomp.children))
    ordered.extend(c for c in tree.concepts if c.rstrip("#").strip() not in seen)
    return ordered


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
    from src.budget.catalog.domain.unit import Unit

    # Mapa inverso: child_code → parent_code (para reconstruir chapter path).
    parent_of: dict[str, str] = {}
    for parent_code, decomp in tree.decompositions.items():
        for child_code, _factor in decomp.children:
            # Si un código aparece como hijo de varios padres, conservamos el
            # primero visto (en BC3 bien formado esto no suele pasar). Los `~D`
            # citan a los hijos sin el marcador '#': se registran ambas formas.
            parent_of.setdefault(child_code, parent_code)
            parent_of.setdefault(child_code.rstrip("#").strip() + "#", parent_code)

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
    for code in _document_order(tree):
        concept = tree.concepts[code]
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
                # Resumen corto `~C` → núcleo de la consulta de recuperación
                # (`build_retrieval_query`). El Judge sigue viendo `description`.
                summary=short or None,
                # Dimensión física para la señal blanda de unidad del retrieval
                # (antes BC3 no la rellenaba → sin penalización dimensional).
                # Los BC3 escriben a menudo la unidad con punto final ("m.",
                # "ud.", "h.") que el normalizador no reconoce.
                unit_dimension=(
                    Unit.dimension_of(unit)
                    or Unit.dimension_of((unit or "").strip().rstrip("."))
                ),
            )
        )

    return items
