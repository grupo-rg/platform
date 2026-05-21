"""Sprint 4 Fase F — tests del extractor de metadata del documento.

Verifica que `extract_document_metadata` saca correctamente el título del
proyecto y la dirección/parcela de las primeras líneas de la primera página
del PDF, ignorando cabeceras tabulares, partidas y ruido.
"""
from __future__ import annotations

import pytest

from src.budget.pdf_tabular_parser.application.document_metadata import (
    extract_document_metadata,
    _looks_like_address,
    _looks_like_partida_title_only,
    _is_skippable_line,
)


class TestExtractDocumentMetadata:
    def test_empty_pdf_returns_empty_metadata(self):
        result = extract_document_metadata([])
        assert result.title is None
        assert result.address is None

    def test_only_skippable_lines_returns_empty(self):
        first_page = "Presupuesto\nCódigo Nat Ud Resumen\nPágina 1\n"
        result = extract_document_metadata([first_page])
        assert result.title is None
        assert result.address is None

    def test_sanitas_dental_style(self):
        """SANITAS: título + dirección explícita."""
        first_page = (
            "REFORMA DE LOCAL DESTINADO A CLINICA DENTAL\n"
            "SITO EN C. BARÓ DE PINOPAR, 9 - 07012 PALMA DE MALLORCA\n"
            "Presupuesto\n"
            "Código Nat Ud Resumen\n"
            "C01 Capítulo TRABAJOS PREVIOS\n"
        )
        result = extract_document_metadata([first_page])
        assert result.title == "REFORMA DE LOCAL DESTINADO A CLINICA DENTAL"
        assert result.address == "SITO EN C. BARÓ DE PINOPAR, 9 - 07012 PALMA DE MALLORCA"

    def test_rdll_style(self):
        """RdLL: solo título, sin dirección verificable."""
        first_page = (
            "Roger de lluria_OBRA CIVIL\n"
            "Presupuesto\n"
            "Código Nat Ud Resumen Comentario\n"
            "01 Capítulo DESBROCE\n"
            "01.01 Partida UD REPLANTEO\n"
            "REPLANTEO\n"
            "Replanteo de la cimentación de las viviendas.\n"
        )
        result = extract_document_metadata([first_page])
        assert result.title == "Roger de lluria_OBRA CIVIL"
        assert result.address is None  # no hay address verificable

    def test_mu02_style(self):
        """MU02: código de proyecto + parcela."""
        first_page = (
            "MU02-\n"
            "Pol.11-Parc.213\n"
            "1 ACTUACIONES PREVIAS\n"
            "Nº Ud Descripción Cantidad Precio Total\n"
        )
        result = extract_document_metadata([first_page])
        assert result.title == "MU02-"
        assert result.address == "Pol.11-Parc.213"

    def test_partida_title_only_repeated_is_skipped(self):
        """RdLL repite "REPLANTEO" como línea suelta — no es metadata."""
        first_page = (
            "Roger de lluria_OBRA CIVIL\n"
            "REPLANTEO\n"  # esto NO debe ser tomado como address
            "Replanteo de la cimentación.\n"
        )
        result = extract_document_metadata([first_page])
        assert result.title == "Roger de lluria_OBRA CIVIL"
        # "REPLANTEO" filtrado; "Replanteo de la cimentación." NO es address.
        assert result.address is None

    def test_address_with_cp_detected(self):
        first_page = "Mi Proyecto\nCarrer del Sol 12, 07012 Palma\n"
        result = extract_document_metadata([first_page])
        assert result.title == "Mi Proyecto"
        assert "07012" in (result.address or "")

    def test_truncates_excessively_long_lines(self):
        long = "X" * 500
        first_page = f"{long}\nSITO EN C/Test 1\n"
        result = extract_document_metadata([first_page])
        assert result.title is not None
        assert len(result.title) <= 305  # 300 + "..." tolerancia


class TestLooksLikeAddress:
    @pytest.mark.parametrize("line,expected", [
        ("SITO EN C. BARÓ DE PINOPAR, 9 - 07012", True),
        ("Calle Mayor 5", True),
        ("C/ Test 12", True),
        ("Pol.11-Parc.213", True),
        ("Avenida de la Paz", True),
        ("07012 Palma de Mallorca", True),
        ("REFORMA DE LOCAL", False),
        ("Roger de lluria_OBRA CIVIL", False),
        ("MEDICIONES INFORME IEE ALEXANDRE", False),  # no es address
        ("Replanteo de la cimentación", False),
        ("", False),
        ("ab", False),
    ])
    def test_pattern_recognition(self, line, expected):
        assert _looks_like_address(line) is expected


class TestLooksLikePartidaTitleOnly:
    @pytest.mark.parametrize("line,expected", [
        ("REPLANTEO", True),
        ("DESBROCE", True),
        ("MOVIMIENTO TIERRAS", True),
        ("Replanteo de la cimentación", False),  # mixed case, larga
        ("MU02-", False),  # tiene "-"
        ("Pol.11-Parc.213", False),  # tiene punto
        ("01 ACTUACIONES", False),  # tiene dígito
        ("", False),
        ("AB", False),  # muy corta
    ])
    def test_partida_title_detection(self, line, expected):
        assert _looks_like_partida_title_only(line) is expected


class TestIsSkippableLine:
    @pytest.mark.parametrize("line,expected", [
        ("", True),
        ("Página 1", True),
        ("Pag. 3", True),
        ("Código Nat Ud Resumen", True),  # cabecera tabular
        ("Nº Ud Descripción Cantidad Precio Total", True),  # MU02 header
        ("CÓDIGO RESUMEN UDS LONGITUD ANCHURA", True),  # CIFRE header
        ("01.01 Partida UD REPLANTEO", True),  # cabecera de partida
        ("C01 Capítulo TRABAJOS PREVIOS", True),  # capítulo
        ("1 ACTUACIONES PREVIAS", True),  # capítulo implícito
        ("Presupuesto", True),  # etiqueta del documento
        ("PRESUPUESTO Y MEDICIONES", True),  # etiqueta del documento
        ("SPC0010", True),  # ID interno
        ("SPC0010 Solar", True),
        ("REFORMA DE LOCAL DESTINADO A CLINICA DENTAL", False),  # NO skip
        ("Roger de lluria_OBRA CIVIL", False),
        ("MU02-", False),
        ("Pol.11-Parc.213", False),
    ])
    def test_skippable_detection(self, line, expected):
        assert _is_skippable_line(line) is expected


# --- Golden tests on real PDFs --------------------------------------------

import os
from pathlib import Path

_GOLDEN_DIR = Path(
    os.environ.get(
        "SPRINT4_GOLDEN_DIR",
        r"c:\Users\Usuario\Documents\github\works\dochevi\dochevi-construc\data\pdf_layouts\golden",
    )
)


@pytest.mark.golden
@pytest.mark.skipif(
    not _GOLDEN_DIR.exists(),
    reason="Golden dir no disponible",
)
class TestGoldenDocumentMetadata:
    def test_rdll(self):
        from src.budget.pdf_tabular_parser.application.tabular_parser import TabularParser
        pdf = _GOLDEN_DIR / "presupuesto_grande_rdll.pdf"
        if not pdf.exists():
            pytest.skip("RdLL no disponible")
        r = TabularParser().parse(pdf.read_bytes())
        assert r.document_title == "Roger de lluria_OBRA CIVIL"
        assert r.document_address is None  # RdLL no tiene address explícita

    def test_sanitas(self):
        from src.budget.pdf_tabular_parser.application.tabular_parser import TabularParser
        pdf = _GOLDEN_DIR / "sanitas_dental.pdf"
        if not pdf.exists():
            pytest.skip("SANITAS no disponible")
        r = TabularParser().parse(pdf.read_bytes())
        assert r.document_title is not None
        assert "REFORMA DE LOCAL" in r.document_title
        assert r.document_address is not None
        assert "SITO EN" in r.document_address
        assert "PALMA DE MALLORCA" in r.document_address

    def test_mu02(self):
        from src.budget.pdf_tabular_parser.application.tabular_parser import TabularParser
        pdf = _GOLDEN_DIR / "mu02_albanileria.pdf"
        if not pdf.exists():
            pytest.skip("MU02 no disponible")
        r = TabularParser().parse(pdf.read_bytes())
        assert r.document_title == "MU02-"
        assert r.document_address == "Pol.11-Parc.213"
