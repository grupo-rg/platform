"""Tests para el flujo ANNEXED del TabularParser (Sprint 4 Fase D).

Verifica:
- El modo ANNEXED se activa cuando hay transition_page válido.
- Cabeceras detectadas se mapean a quantities via totals dict.
- Cabeceras sin total quedan con quantity=None (huérfanas).
- El callback de eventos emite annexed_transition_detected y annexed_mapping_complete.
- Resultados son viable si match rate >= 50%.
- No se confunden códigos PRESTO internos (TC-, EL-, FN-) con partidas.
"""
from __future__ import annotations

from typing import Dict, List, Optional, Tuple

import pytest

from src.budget.pdf_tabular_parser.application.tabular_parser import TabularParser
from src.budget.pdf_tabular_parser.domain.result import (
    TabularExtractionResult,
)


def _run_annexed_parse(
    text_per_page: List[str],
    transition_page: int,
) -> Tuple[TabularExtractionResult, List[Tuple[str, dict]]]:
    """Helper que invoca _parse_annexed directamente sobre un mock de pages.

    Permite testear sin necesidad de generar PDFs reales.
    """
    parser = TabularParser()
    result = TabularExtractionResult()
    events: List[Tuple[str, dict]] = []

    def cb(name: str, payload: dict) -> None:
        events.append((name, payload))

    parser._parse_annexed(
        text_per_page=text_per_page,
        transition_page=transition_page,
        result=result,
        event_callback=cb,
    )
    return result, events


def test_annexed_flow_assigns_quantities_to_matched_headers():
    """Flujo ANNEXED básico: 3 cabeceras + 3 totales → 3 matched."""
    # Páginas 1-2: descripciones con cabeceras.
    description_text = (
        "01 Capítulo DESBROCE\n"
        "01.01 Partida UD REPLANTEO General\n"
        "01.02 Partida m2 Desbroce y limpieza del terreno\n"
        "02 Capítulo MOVIMIENTO DE TIERRAS\n"
        "02.01 Partida m3 Excavación de zanja para cimentación\n"
    )
    pages: List[str] = [description_text, ""]
    # Página 3: totales (transition_page=3).
    pages.append(
        "Total 01.01 5,00 0,00\n"
        "Total 01.02 100,00 0,00\n"
        "Total 02.01 25,00 0,00\n"
    )

    result, events = _run_annexed_parse(pages, transition_page=3)

    assert result.annexed is True
    assert result.annexed_transition_page == 3
    assert result.annexed_totals_found == 3
    assert result.partidas_count == 3
    assert result.annexed_matched == 3
    assert result.annexed_orphans == 0

    by_code = {p.code: p for p in result.partidas}
    assert by_code["01.01"].quantity == 5.0
    assert by_code["01.02"].quantity == 100.0
    assert by_code["02.01"].quantity == 25.0


def test_annexed_flow_marks_orphans_as_none():
    """Cabeceras sin total quedan con quantity=None (no 1.0 default)."""
    pages = [
        "01 Capítulo X\n"
        "01.01 Partida UD Title one\n"
        "01.02 Partida UD Title two\n"
        "01.03 Partida UD Title three\n",
        "",
        "Total 01.01 5,00 0,00\n",   # solo el primer code matchea
    ]
    result, _ = _run_annexed_parse(pages, transition_page=3)

    assert result.annexed_matched == 1
    assert result.annexed_orphans == 2
    by_code = {p.code: p for p in result.partidas}
    assert by_code["01.01"].quantity == 5.0
    assert by_code["01.02"].quantity is None
    assert by_code["01.03"].quantity is None


def test_annexed_flow_assigns_chapter_label():
    """Cada partida hereda el capítulo correspondiente."""
    pages = [
        "01 Capítulo DESBROCE\n"
        "01.01 Partida UD Replanteo\n"
        "01.02 Partida UD Limpieza\n"
        "02 Capítulo MOVIMIENTO\n"
        "02.01 Partida UD Excavación\n",
        "Total 01.01 5,00 0,00\n"
        "Total 01.02 6,00 0,00\n"
        "Total 02.01 25,00 0,00\n",
    ]
    result, _ = _run_annexed_parse(pages, transition_page=2)

    by_code = {p.code: p for p in result.partidas}
    assert by_code["01.01"].chapter == "01 DESBROCE"
    assert by_code["01.02"].chapter == "01 DESBROCE"
    assert by_code["02.01"].chapter == "02 MOVIMIENTO"


def test_annexed_flow_dedupes_repeated_codes():
    """Si una cabecera aparece dos veces en el PDF, se cuenta una sola vez."""
    pages = [
        "01.01 Partida UD Replanteo\n"
        "01.01 Partida UD Replanteo (duplicate)\n",
        "Total 01.01 5,00 0,00\n",
    ]
    result, _ = _run_annexed_parse(pages, transition_page=2)
    assert result.partidas_count == 1
    assert result.partidas[0].quantity == 5.0


def test_annexed_flow_emits_events():
    """El callback recibe los eventos annexed_mapping_complete."""
    pages = [
        "01.01 Partida UD Replanteo\n"
        "01.02 Partida UD Limpieza\n",
        "Total 01.01 5,00 0,00\n"
        "Total 01.02 6,00 0,00\n",
    ]
    _, events = _run_annexed_parse(pages, transition_page=2)

    event_names = [e[0] for e in events]
    assert "annexed_mapping_complete" in event_names
    mapping_event = next(e for e in events if e[0] == "annexed_mapping_complete")
    payload = mapping_event[1]
    assert payload["headersTotal"] == 2
    assert payload["matched"] == 2
    assert payload["orphans"] == 0
    assert payload["matchRate"] == 1.0
    assert payload["totalsFound"] == 2


def test_annexed_flow_ignores_presto_internal_codes_in_totals():
    """Códigos PRESTO internos (TC-, EL-, FN-) en totales son ignorados."""
    pages = [
        "01.01 Partida UD Replanteo\n",
        "Total TC-1.1.1 1,00\n"        # ignorado
        "Total EL-1.8 1,00\n"           # ignorado
        "Total 01.01 5,00 0,00\n",     # válido
    ]
    result, _ = _run_annexed_parse(pages, transition_page=2)

    assert result.annexed_totals_found == 1
    assert result.partidas_count == 1
    assert result.partidas[0].quantity == 5.0


def test_annexed_flow_ignores_presto_internal_codes_as_headers():
    """Líneas como 'TC-1.1.1 UD Descripción' NO se convierten en partidas."""
    pages = [
        "01.01 Partida UD Replanteo válido\n"
        "TC-1.1.1 UD No es partida\n"
        "EL-1.8 UD Tampoco esta\n",
        "Total 01.01 5,00 0,00\n",
    ]
    result, _ = _run_annexed_parse(pages, transition_page=2)
    assert result.partidas_count == 1
    assert result.partidas[0].code == "01.01"


def test_annexed_is_viable_at_50_percent_match():
    """ANNEXED es viable si >= 50% de cabeceras tienen quantity."""
    pages = [
        "01.01 Partida UD Partida uno descripción\n"
        "01.02 Partida UD Partida dos descripción\n"
        "01.03 Partida UD Partida tres descripción\n"
        "01.04 Partida UD Partida cuatro descripción\n",
        "Total 01.01 5,00 0,00\n"
        "Total 01.02 5,00 0,00\n",   # solo 2/4 = 50% matchean
    ]
    result, _ = _run_annexed_parse(pages, transition_page=2)
    # Necesitamos set pages_total para que is_viable no falle por otra razón.
    result.pages_total = 2
    assert result.is_viable() is True, f"reason={result.reason}"


def test_annexed_not_viable_below_50_percent_match():
    """ANNEXED NO es viable si <50% matchean (degradación inaceptable)."""
    pages = [
        "01.01 Partida UD Partida uno descripción\n"
        "01.02 Partida UD Partida dos descripción\n"
        "01.03 Partida UD Partida tres descripción\n"
        "01.04 Partida UD Partida cuatro descripción\n"
        "01.05 Partida UD Partida cinco descripción\n",
        "Total 01.01 5,00 0,00\n"
        "Total 01.02 5,00 0,00\n",   # 2/5 = 40% matchean
    ]
    result, _ = _run_annexed_parse(pages, transition_page=2)
    result.pages_total = 2
    assert result.is_viable() is False
    assert "low_qty_rate" in (result.reason or "")


def test_annexed_full_parse_with_byte_pdf_mock_via_iter_pages(monkeypatch):
    """Parse completo simulando iter_pages con un PDF mock — verifica que
    parse() invoca _parse_annexed cuando detecta transition_page.
    """
    from src.budget.pdf_tabular_parser.infrastructure import pdfplumber_adapter

    class _MockPage:
        def __init__(self, page_number: int, raw_text: str):
            self.page_number = page_number
            self.width = 600.0
            self.height = 800.0
            self.words = []
            self.raw_text = raw_text

    # PDF de 100 pp con totales empezando en p70 (70% > 50% → ANNEXED).
    mock_pages_text = []
    # Descripciones en pp 1-50.
    for i in range(50):
        if i < 5:
            mock_pages_text.append(
                f"0{i+1} Capítulo CAPITULO_{i+1}\n"
                f"0{i+1}.01 Partida UD Partida en cap {i+1}\n"
            )
        else:
            mock_pages_text.append(f"descripción página {i+1}\n")
    # Pp 51-69: vacías
    for _ in range(50, 69):
        mock_pages_text.append("nada relevante aquí\n")
    # Pp 70-100: totales
    totals_lines = "\n".join(
        f"Total 0{i+1}.01 {(i+1)*10},00 0,00" for i in range(5)
    )
    mock_pages_text.append(totals_lines)
    for _ in range(70, 100):
        mock_pages_text.append("nada relevante aquí\n")

    def mock_iter_pages(_pdf_bytes):
        for idx, text in enumerate(mock_pages_text, start=1):
            yield _MockPage(idx, text)

    monkeypatch.setattr(
        "src.budget.pdf_tabular_parser.application.tabular_parser.iter_pages",
        mock_iter_pages,
    )

    parser = TabularParser()
    events_received: List[Tuple[str, dict]] = []
    result = parser.parse(b"fake_pdf_bytes", event_callback=lambda n, p: events_received.append((n, p)))

    assert result.annexed is True
    assert result.annexed_transition_page == 70
    assert result.partidas_count == 5
    assert result.annexed_matched == 5

    event_names = [e[0] for e in events_received]
    assert "annexed_transition_detected" in event_names
    assert "annexed_mapping_complete" in event_names
