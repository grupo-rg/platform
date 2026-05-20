"""MU02 Extractor — Sprint 4 Fase E.

Extrae partidas de un PDF MU02 (Balearchitekt Projekte estado de
mediciones) usando solo regex deterministas (sin LLM).

Estado del extractor por línea:
- `current_chapter`: capítulo activo (sticky entre páginas).
- `current_partida`: partida en construcción (header detectada, esperando
  total final).
- `block_lines`: líneas acumuladas de la partida actual.

Procesamiento por línea de cada página:
1. Skip cabecera tabular (`Nº Ud Descripción Cantidad Precio Total`).
2. Skip header documental (`MU02-`, `Pol.11-Parc.213`).
3. Si matchea capítulo (`<num> <NOMBRE_MAYUS>`) → actualiza current_chapter.
4. Si matchea cabecera de partida → finaliza la anterior, abre nueva.
5. Si matchea total inline cuya unidad coincide con la de la partida actual
   → guarda candidato. (El último candidato gana — porque pueden aparecer
   varios decimales y solo el último con unidad explícita es el total.)
6. Resto de líneas → se acumulan como cuerpo descriptivo.

Al final del PDF: finaliza la última partida.

Las quantities se asignan así:
- `current_partida.quantity = last_candidate_total` cuando se finaliza.
- Si nunca hubo candidato matching, quantity queda como None.
"""
from __future__ import annotations

import logging
import re
from typing import List, Optional

from src.budget.pdf_tabular_parser.application.patterns_mu02 import (
    MU02_CHAPTER_RE,
    MU02_MEASUREMENT_HEADER_RE,
    MU02_PARTIDA_HEADER_RE,
    MU02_TABLE_HEADER_RE,
    MU02_TOTAL_INLINE_RE,
)
from src.budget.pdf_tabular_parser.application.spanish_number import parse_spanish_number
from src.budget.pdf_tabular_parser.domain.result import TabularPartida

logger = logging.getLogger(__name__)


# Líneas de header documental a saltar dentro del cuerpo (no son partida ni
# medición). Aparecen al inicio de cada página.
_DOC_HEADER_PATTERNS = [
    re.compile(r"^MU\d+\s*-?\s*$", re.IGNORECASE),
    re.compile(r"^Pol\.\d+\s*-\s*Parc\.\d+\s*$", re.IGNORECASE),
    # Footer del documento (pie de página recurrente)
    re.compile(r"^.*P[áa]gina\s+\d+\s*$", re.IGNORECASE),
    re.compile(r"^BALEARARCHITEKT", re.IGNORECASE),
]


def _is_doc_header_line(line: str) -> bool:
    """Devuelve True si la línea es header/footer documental del PDF MU02."""
    line_clean = line.strip()
    if not line_clean:
        return True  # tratamos vacías como skip
    for pattern in _DOC_HEADER_PATTERNS:
        if pattern.match(line_clean):
            return True
    return False


def _normalize_unit(unit: str) -> str:
    """Normaliza una unidad para comparación case-insensitive.

    'M²' -> 'm2'
    'm²' -> 'm2'
    'Ud' -> 'ud'
    'H' -> 'h'
    'm³' -> 'm3'
    """
    if not unit:
        return ""
    u = unit.lower().strip()
    # Reemplazo de superíndices
    u = u.replace("²", "2").replace("³", "3")
    return u


def extract_mu02_partidas(text_per_page: List[str]) -> List[TabularPartida]:
    """Extrae partidas de un PDF MU02.

    Args:
        text_per_page: Lista de strings, uno por página (1-indexed implícito,
            text_per_page[0] = página 1).

    Returns:
        Lista de TabularPartida con code, unit, title, quantity y chapter.
        Si no se pudo extraer la qty de una partida, quantity=None.
    """
    if not text_per_page:
        return []

    partidas: List[TabularPartida] = []
    current_chapter: str = ""

    # Estado de la partida en construcción.
    current_partida: Optional[TabularPartida] = None
    current_partida_unit_normalized: str = ""
    current_partida_start_page: int = 1
    block_description_lines: List[str] = []
    last_total_candidate: Optional[float] = None

    def _finalize_current_partida() -> None:
        """Cierra la partida actual: asigna qty, descripción, y la appendea."""
        nonlocal current_partida, last_total_candidate, block_description_lines
        if current_partida is None:
            return
        if last_total_candidate is not None:
            current_partida.quantity = last_total_candidate
        if block_description_lines:
            # Acumulamos descripción de bloque (compactada).
            extra = " ".join(line.strip() for line in block_description_lines if line.strip())
            if extra:
                # Anexamos solo si la descripción base es corta o vacía.
                if current_partida.description and len(current_partida.description) < 200:
                    current_partida.description = f"{current_partida.description} {extra}".strip()
        partidas.append(current_partida)
        current_partida = None
        last_total_candidate = None
        block_description_lines = []

    for page_idx, page_text in enumerate(text_per_page):
        if not page_text:
            continue
        page_number_1idx = page_idx + 1

        for raw_line in page_text.splitlines():
            line = raw_line.strip()
            if not line:
                continue

            # 1. Skip cabecera tabular MU02 (header band).
            if MU02_TABLE_HEADER_RE.match(line):
                continue

            # 2. Skip header/footer documental.
            if _is_doc_header_line(line):
                continue

            # 3. Skip cabecera de mediciones (Area Largo Ancho ...).
            if MU02_MEASUREMENT_HEADER_RE.match(line):
                continue

            # 4. ¿Es cabecera de capítulo? — debe verificarse ANTES de partida.
            m_chapter = MU02_CHAPTER_RE.match(line)
            if m_chapter:
                current_chapter = f"{m_chapter.group('code')} {m_chapter.group('name').strip()}"
                # No cerramos la partida actual aquí — el capítulo puede ser
                # legítimo dentro del cuerpo descriptivo (raro pero posible).
                # Lo cerraremos cuando aparezca otra cabecera de partida.
                continue

            # 5. ¿Es cabecera de partida? — finalizar la anterior, abrir nueva.
            m_partida = MU02_PARTIDA_HEADER_RE.match(line)
            if m_partida:
                _finalize_current_partida()

                code = m_partida.group("code")
                unit_raw = m_partida.group("unit")
                title = m_partida.group("title").strip()

                current_partida = TabularPartida(
                    code=code,
                    description=title,
                    unit=unit_raw,
                    quantity=None,
                    chapter=current_chapter,
                    sub_chapter=None,
                    apartado=None,
                    page_number=page_number_1idx,
                )
                current_partida_unit_normalized = _normalize_unit(unit_raw)
                current_partida_start_page = page_number_1idx
                continue

            # 6. ¿Es un total inline (`<qty> <unit>`)?
            m_total = MU02_TOTAL_INLINE_RE.match(line)
            if m_total and current_partida is not None:
                total_unit_norm = _normalize_unit(m_total.group("unit"))
                # Solo aceptamos si la unidad coincide con la cabecera de la
                # partida actual (anti-falso-positivo si hay decimales sueltos).
                if total_unit_norm == current_partida_unit_normalized:
                    qty = parse_spanish_number(m_total.group("qty"))
                    if qty is not None:
                        # El ÚLTIMO match gana — pueden aparecer múltiples decimales
                        # antes pero el total final es el último.
                        last_total_candidate = qty
                continue

            # 7. Cualquier otra línea → acumular como descripción del bloque.
            if current_partida is not None:
                block_description_lines.append(line)

    # Finalizar la última partida pendiente.
    _finalize_current_partida()

    return partidas
