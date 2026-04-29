"""`CatalogTransformer` — función pura JSON-origen → entries v005.

Recibe la estructura de `docs/2025_variable_final.json` (lista de
capítulos que contienen items que contienen breakdowns) y devuelve:

  (list[PriceBookItemEntry], list[PriceBookBreakdownEntry])

Las entries devueltas son el material final que se escribe a Firestore
(con su embedding añadido por el use case aguas abajo).

Reglas:
  - Items sin `code` o `description` se omiten con log (no crash).
  - Breakdowns sin `description` se omiten; los válidos re-indexan sus
    posiciones de forma consecutiva (`#01`, `#02`, ...).
  - Las unidades se normalizan vía Unit value object.
  - `breakdown_ids` del padre refleja EXACTAMENTE los hijos emitidos.
"""

from __future__ import annotations

import logging
from typing import Any

from pydantic import ValidationError

from src.budget.catalog.domain.price_book_entry import (
    PriceBookBreakdownEntry,
    PriceBookItemEntry,
)
from src.budget.catalog.domain.unit import Unit

logger = logging.getLogger(__name__)


class CatalogTransformer:
    @staticmethod
    def transform(
        source_chapters: list[dict[str, Any]],
    ) -> tuple[list[PriceBookItemEntry], list[PriceBookBreakdownEntry]]:
        items: list[PriceBookItemEntry] = []
        breakdowns: list[PriceBookBreakdownEntry] = []

        for chapter in source_chapters:
            chapter_name = chapter.get("chapter") or ""
            for raw_item in chapter.get("items", []) or []:
                try:
                    item_entry, bk_entries = CatalogTransformer._transform_item(
                        raw_item=raw_item, chapter_name=chapter_name
                    )
                except Exception as e:
                    logger.warning(
                        f"Skipping invalid item in chapter '{chapter_name}' "
                        f"(code={raw_item.get('code', '<missing>')}): {e}"
                    )
                    continue
                items.append(item_entry)
                breakdowns.extend(bk_entries)

        return items, breakdowns

    @staticmethod
    def _transform_item(
        raw_item: dict[str, Any], chapter_name: str
    ) -> tuple[PriceBookItemEntry, list[PriceBookBreakdownEntry]]:
        code = raw_item.get("code")
        description = raw_item.get("description")
        if not code or not description:
            raise ValueError(f"code/description required (got code={code!r})")

        unit_raw = raw_item.get("unit", "") or ""
        unit_norm = Unit.normalize(unit_raw)
        unit_dim = Unit.dimension_of(unit_raw)

        # Fase 12 — primera pasada: construir hijos válidos preservando el code
        # original del COAATMCA (mt*/mo*/mq*/%) para que el filtro de modos
        # del editor funcione. El doc_id compound `{parent}#{idx:02d}` mantiene
        # unicidad en Firestore (un mismo `mo055` aparece en cientos de items).
        bk_entries: list[PriceBookBreakdownEntry] = []
        for bk in raw_item.get("breakdown", []) or []:
            bk_description = bk.get("description")
            if not bk_description:
                continue
            bk_idx = len(bk_entries) + 1  # 1-indexed sobre válidos
            bk_doc_id = f"{code}#{bk_idx:02d}"  # único en Firestore
            original_code = (bk.get("code") or "").strip()
            bk_code = original_code if original_code else bk_doc_id
            bk_unit_raw = bk.get("unit", "") or ""
            try:
                bk_entries.append(
                    PriceBookBreakdownEntry(
                        code=bk_code,
                        doc_id=bk_doc_id,
                        parent_code=code,
                        parent_description=description,
                        parent_unit=unit_raw,
                        chapter=chapter_name,
                        description=bk_description,
                        unit_raw=bk_unit_raw,
                        unit_normalized=Unit.normalize(bk_unit_raw),
                        unit_dimension=Unit.dimension_of(bk_unit_raw),
                        quantity=float(bk.get("quantity", 1.0) or 1.0),
                        price_unit=float(bk.get("price_unit", 0.0) or 0.0),
                        price=float(bk.get("price", 0.0) or 0.0),
                        is_variable=bool(bk.get("is_variable", False)),
                    )
                )
            except (ValidationError, ValueError, TypeError) as e:
                logger.warning(f"Skipping malformed breakdown of {code}: {e}")
                continue

        item_entry = PriceBookItemEntry(
            code=code,
            chapter=chapter_name,
            section=raw_item.get("section") or "",
            description=description,
            unit_raw=unit_raw,
            unit_normalized=unit_norm,
            unit_dimension=unit_dim,
            priceTotal=float(raw_item.get("priceTotal", 0.0) or 0.0),
            # Fase 12 — `breakdown_ids` apunta al doc_id (único en Firestore)
            # NO al `code` (que ahora es el original COAATMCA y puede repetirse
            # entre items, ej. `mo055` aparece en cientos de partidas).
            breakdown_ids=[b.doc_id or b.code for b in bk_entries],
            source_page=raw_item.get("page"),
        )
        return item_entry, bk_entries
