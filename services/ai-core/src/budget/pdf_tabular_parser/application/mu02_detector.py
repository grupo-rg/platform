"""MU02 Layout Detector — Sprint 4 Fase E.

Detecta si un PDF tiene formato MU02 (Balearchitekt Projekte estado de
mediciones) buscando la cabecera tabular `Nº Ud Descripción Cantidad
Precio Total` repetida en >=2 páginas como header band.

Función pura (sin I/O ni LLM). Se invoca desde el orquestador
`TabularParser` ANTES de los detectores ANNEXED e INLINE.
"""
from __future__ import annotations

import logging
from typing import List

from src.budget.pdf_tabular_parser.application.patterns_mu02 import (
    MU02_TABLE_HEADER_RE,
)

logger = logging.getLogger(__name__)

# Mínimo de páginas con cabecera para considerar MU02.
MIN_PAGES_WITH_HEADER_FOR_MU02 = 2


def detect_mu02_layout(text_per_page: List[str]) -> bool:
    """Retorna True si el PDF parece formato MU02.

    Criterio: >=`MIN_PAGES_WITH_HEADER_FOR_MU02` (=2) páginas con la
    cabecera tabular MU02 (`Nº Ud Descripción Cantidad Precio Total`).

    Esto es muy específico — no se confunde con cabecera CIFRE
    (`CÓDIGO RESUMEN UDS LONGITUD ANCHURA ALTURA PARCIALES CANTIDAD`)
    ni con líneas de totales ANNEXED.

    Args:
        text_per_page: Lista de strings, uno por página.

    Returns:
        True si >=2 páginas tienen la cabecera MU02. False en caso
        contrario (incluyendo lista vacía, todas vacías o solo 1 página
        con header).
    """
    if not text_per_page:
        return False

    pages_with_header = 0
    for page_text in text_per_page:
        if not page_text:
            continue
        for line in page_text.splitlines():
            if MU02_TABLE_HEADER_RE.match(line.strip()):
                pages_with_header += 1
                break  # 1 hit por página

    is_mu02 = pages_with_header >= MIN_PAGES_WITH_HEADER_FOR_MU02
    if is_mu02:
        logger.debug(
            "mu02_detector: MU02 detectado (%d/%d páginas con cabecera)",
            pages_with_header,
            len(text_per_page),
        )
    return is_mu02


def count_mu02_pages_with_header(text_per_page: List[str]) -> int:
    """Variante diagnóstica: cuenta páginas con cabecera MU02.

    Usado para telemetría (event `mu02_layout_detected`).
    """
    if not text_per_page:
        return 0
    count = 0
    for page_text in text_per_page:
        if not page_text:
            continue
        for line in page_text.splitlines():
            if MU02_TABLE_HEADER_RE.match(line.strip()):
                count += 1
                break
    return count
