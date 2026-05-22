"""Adapter Bc3Tree → List[RestructuredItem].

Produce el mismo shape que el parser TABULAR de PDFs, para que el
pipeline aguas abajo (SwarmPricingService, HybridCatalogSearch, etc.) no
necesite saber qué formato entró.
"""

from __future__ import annotations

from typing import List

from src.budget.bc3_parser.entities import Bc3ConceptKind, Bc3Tree


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
                # Formato consistente con el parser TABULAR: "CODE Nombre del capítulo"
                if concept.description:
                    return f"{concept.code} {concept.description}".strip()
                return concept.code
            current = parent_of.get(current)
        return "Sin Capítulo"

    items: List[RestructuredItem] = []
    for code, concept in tree.concepts.items():
        if concept.kind != Bc3ConceptKind.PARTIDA:
            continue
        measurement = tree.measurements.get(code)
        if measurement is None:
            # Defensivo: marcado como PARTIDA pero sin ~M — saltar.
            continue

        # Descripción extensa: combinar `~C.description` (corta) + `~T` (extendida).
        short = concept.description.strip()
        long = concept.long_description.strip()
        if short and long:
            description = f"{short}. {long}"
        elif long:
            description = long
        else:
            description = short or code  # fallback: código si no hay nada

        items.append(
            RestructuredItem(
                code=code,
                description=description,
                quantity=measurement.total_quantity,
                unit=concept.unit or "ud",
                chapter=find_chapter_path(code),
                sub_chapter=None,  # BC3 no distingue sub-capítulo explícito
            )
        )

    return items
