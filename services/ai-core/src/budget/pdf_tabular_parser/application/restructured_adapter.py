"""Adapter: TabularPartida → RestructuredItem.

Mantiene la **misma interfaz pública** del pipeline existente: el extractor
sigue devolviendo `List[RestructuredItem]`. Solo cambia el productor.

Mapeo:
- code → code
- description → description (limpio, sin prefijo de jerarquía).
- quantity → quantity (1.0 default si None — RestructuredItem.quantity es float).
- unit → unit (sin normalizar; downstream Unit.normalize lo cubre).
- chapter → chapter (= label nivel 1).
- sub_chapter → sub_chapter (campo opcional añadido en Sprint 4; el matcher
  downstream lo lee sin contaminar la descripción).
"""
from __future__ import annotations

from typing import List

from src.budget.application.services.pdf_extractor_service import RestructuredItem
from src.budget.catalog.domain.unit import Unit
from src.budget.pdf_tabular_parser.domain.result import TabularPartida


def tabular_to_restructured_items(partidas: List[TabularPartida]) -> List[RestructuredItem]:
    """Convierte la salida del parser tabular al schema del pipeline.

    Aplica los defaults retro-compatibles:
    - `quantity` = 1.0 si `partida.quantity is None` (matchea el contrato pre-v1.2).
    - `unit_normalized` y `unit_dimension` calculados via Unit.normalize / dimension_of.
    - `chapter` = "Sin Capítulo" si la partida no tiene capítulo asignado.
    - `sub_chapter` = None si la partida no tiene subcapítulo.

    NOTA: el caller (`pdf_extractor_service`) aún correrá `consolidate_chapters`
    y `stabilize_chapter_name` sobre la lista, así que no hace falta hacerlo aquí.
    """
    items: List[RestructuredItem] = []
    for p in partidas:
        # Chapter label fallback.
        chapter = (p.chapter or "").strip() or "Sin Capítulo"
        sub_chapter = (p.sub_chapter or "").strip() or None
        # Quantity 1.0 default per contract.
        qty = p.quantity if p.quantity is not None else 1.0

        items.append(
            RestructuredItem(
                code=p.code or "",
                description=p.description,
                quantity=qty,
                unit=p.unit or "ud",
                chapter=chapter,
                sub_chapter=sub_chapter,
                unit_normalized=Unit.normalize(p.unit or "ud"),
                unit_dimension=Unit.dimension_of(p.unit or "ud"),
            )
        )
    return items
