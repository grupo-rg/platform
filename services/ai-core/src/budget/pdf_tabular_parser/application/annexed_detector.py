"""AnnexedDetector — detecta layout PRESTO ANNEXED y extrae totales.

Layout ANNEXED:
- Descripciones de partidas en primer tercio del PDF.
- Mediciones zonales en páginas intermedias (opcional).
- Sumatorios finales `Total <code> <qty>` en último tercio.

Este módulo proporciona dos funciones puras (sin I/O ni LLM):

1. `detect_annexed_transition_page(text_per_page) -> Optional[int]`:
   Busca la primera página donde aparecen ≥2 totales válidos. Retorna
   None si los totales aparecen demasiado pronto (<50% del PDF) o si no
   hay totales en absoluto.

2. `extract_totals_from_annexed_pages(text_per_page, start_page) -> Dict[str, float]`:
   Parsea las líneas `Total <code> <qty> ...` y devuelve un diccionario
   `{code: qty}`. Si el mismo código aparece múltiples veces, las
   cantidades se suman (extra robustness — caso raro).

Criterios de transición (heurística empírica medida sobre los goldens):
- Una página califica como "página de totales" si tiene >=2 líneas que
  matchean TOTAL_LINE_RE (y no son sub-totales internos PRESTO).
- La transition page debe estar >= 50% del PDF para considerarse ANNEXED.
- Si está en el primer tercio (<33%), es UNKNOWN layout — retorna None.
"""
from __future__ import annotations

import logging
from typing import Dict, List, Optional

from src.budget.pdf_tabular_parser.application.patterns import TOTAL_LINE_RE
from src.budget.pdf_tabular_parser.application.spanish_number import parse_spanish_number

logger = logging.getLogger(__name__)

# Mínimo de totales válidos en una página para considerarla "página de totales".
MIN_TOTALS_PER_PAGE_FOR_TRANSITION = 2

# Threshold: transición debe ocurrir en este % del PDF o después.
# Si <= 33% → UNKNOWN (totales tempranos no son ANNEXED).
# Si entre 33% y 50% → ambiguo, también UNKNOWN (conservador).
# Si >= 50% → ANNEXED válido.
MIN_TRANSITION_RATIO_FOR_ANNEXED = 0.50


def detect_annexed_transition_page(text_per_page: List[str]) -> Optional[int]:
    """Detecta la página donde inicia la fase ANNEXED de totales.

    Args:
        text_per_page: Lista de strings, uno por página (orden 1-indexed
            implícito — text_per_page[0] es la página 1).

    Returns:
        Número de página 1-indexed donde inicia el bloque de totales, o
        None si el PDF no es ANNEXED (no hay totales o aparecen demasiado
        pronto).
    """
    if not text_per_page:
        return None

    total_pages = len(text_per_page)
    min_transition_page = max(1, int(total_pages * MIN_TRANSITION_RATIO_FOR_ANNEXED))

    for idx, page_text in enumerate(text_per_page, start=1):
        if not page_text:
            continue

        matches_count = _count_valid_totals_in_text(page_text)

        if matches_count >= MIN_TOTALS_PER_PAGE_FOR_TRANSITION:
            # Encontramos la primera página con varios totales.
            if idx >= min_transition_page:
                logger.debug(
                    "annexed_detector: transition page found at p%d/%d (%.0f%%)",
                    idx,
                    total_pages,
                    100.0 * idx / max(1, total_pages),
                )
                return idx
            # Totales aparecen demasiado pronto — NO es ANNEXED.
            logger.debug(
                "annexed_detector: totales tempranos en p%d (%.0f%% del PDF) — UNKNOWN",
                idx,
                100.0 * idx / max(1, total_pages),
            )
            return None

    return None


def extract_totals_from_annexed_pages(
    text_per_page: List[str],
    start_page: int,
) -> Dict[str, float]:
    """Extrae el mapa code→qty de las páginas de totales.

    Args:
        text_per_page: Lista de strings por página (1-indexed implícito).
        start_page: Página desde la que empezar a procesar (1-indexed,
            inclusive).

    Returns:
        Diccionario {code: qty_total}. Códigos con prefijo PRESTO interno
        (TC-, EL-, FN-, etc.) NO aparecen (los rechaza el regex). Si un
        code aparece varias veces, las qty se suman.

    Notas:
        - parse_spanish_number ya tolera "1.247,30" (miles con punto).
        - Líneas malformadas se ignoran silenciosamente.
    """
    if not text_per_page or start_page < 1:
        return {}

    # Convertimos a 0-indexed para slicing.
    start_idx = start_page - 1
    if start_idx >= len(text_per_page):
        return {}

    totals: Dict[str, float] = {}

    for page_idx in range(start_idx, len(text_per_page)):
        page_text = text_per_page[page_idx]
        if not page_text:
            continue

        for line in page_text.splitlines():
            line = line.strip()
            if not line:
                continue
            m = TOTAL_LINE_RE.match(line)
            if m is None:
                continue
            code = m.group("code")
            qty_str = m.group("qty")
            qty = parse_spanish_number(qty_str)
            if qty is None:
                logger.debug(
                    "annexed_detector: qty no parseable en línea %r (code=%s)",
                    line,
                    code,
                )
                continue
            if code in totals:
                totals[code] += qty
            else:
                totals[code] = qty

    return totals


def _count_valid_totals_in_text(page_text: str) -> int:
    """Cuenta cuántas líneas en page_text matchean TOTAL_LINE_RE.

    Sub-totales internos PRESTO (TC-, EL-, FN-) NO se cuentan — el regex
    ya los rechaza.
    """
    if not page_text:
        return 0
    count = 0
    for line in page_text.splitlines():
        line = line.strip()
        if not line:
            continue
        if TOTAL_LINE_RE.match(line):
            count += 1
    return count
