"""Tests para patterns_mu02.py — Sprint 4 Fase E.

Verifica que los patrones regex MU02 matchean los formatos reales de
Balearchitekt Projekte (mu02_albanileria.pdf) y rechazan los casos
adversarios (subtotales duplicados, filas de medición, etc.).
"""
from __future__ import annotations

import pytest

from src.budget.pdf_tabular_parser.application.patterns_mu02 import (
    MU02_CHAPTER_RE,
    MU02_MEASUREMENT_HEADER_RE,
    MU02_PARTIDA_HEADER_RE,
    MU02_TABLE_HEADER_RE,
    MU02_TOTAL_INLINE_RE,
)


# --- MU02_TABLE_HEADER_RE ---


class TestMU02TableHeaderRE:
    def test_matches_real_header_with_masculine_ordinal(self):
        # Real MU02: 'Nº Ud Descripción Cantidad Precio Total'
        line = "Nº Ud Descripción Cantidad Precio Total"
        assert MU02_TABLE_HEADER_RE.match(line) is not None

    def test_matches_degree_symbol_variant(self):
        # 'N° Ud Descripción Cantidad Precio Total' (degree)
        line = "N° Ud Descripción Cantidad Precio Total"
        assert MU02_TABLE_HEADER_RE.match(line) is not None

    def test_matches_n_o_variant(self):
        # 'No Ud Descripcion Cantidad Precio Total' (sin acentos ni ordinal)
        line = "No Ud Descripcion Cantidad Precio Total"
        assert MU02_TABLE_HEADER_RE.match(line) is not None

    def test_matches_with_extra_whitespace(self):
        line = "  Nº   Ud   Descripción   Cantidad   Precio   Total  "
        assert MU02_TABLE_HEADER_RE.match(line) is not None

    def test_does_not_match_cifre_header(self):
        # Cabecera CIFRE, no MU02.
        line = "CÓDIGO RESUMEN UDS LONGITUD ANCHURA ALTURA PARCIALES CANTIDAD"
        assert MU02_TABLE_HEADER_RE.match(line) is None

    def test_does_not_match_partial_text(self):
        line = "Cantidad Precio Total"
        assert MU02_TABLE_HEADER_RE.match(line) is None


# --- MU02_PARTIDA_HEADER_RE ---


class TestMU02PartidaHeaderRE:
    def test_matches_m2_partida(self):
        line = "2.1 M² Desbroce y limpieza del terreno, con medios mecánicos."
        m = MU02_PARTIDA_HEADER_RE.match(line)
        assert m is not None
        assert m.group("code") == "2.1"
        assert m.group("unit") == "M²"
        assert "Desbroce" in m.group("title")

    def test_matches_ud_partida(self):
        line = "1.1 Ud Acondicioanmiento de la entrada del solar."
        m = MU02_PARTIDA_HEADER_RE.match(line)
        assert m is not None
        assert m.group("code") == "1.1"
        assert m.group("unit") == "Ud"
        assert "Acondicioanmiento" in m.group("title")

    def test_matches_m3_partida(self):
        line = "2.2 M³ Excavación de tierras a cielo abierto, en suelo de arcilla semidura."
        m = MU02_PARTIDA_HEADER_RE.match(line)
        assert m is not None
        assert m.group("code") == "2.2"
        assert m.group("unit") == "M³"

    def test_matches_h_unit(self):
        line = "15.1 H Oficial 1ª estructurista."
        m = MU02_PARTIDA_HEADER_RE.match(line)
        assert m is not None
        assert m.group("code") == "15.1"
        assert m.group("unit") == "H"

    def test_matches_three_level_code(self):
        # 3 niveles (XX.YY.ZZ): no es típico en MU02 pero el spec lo permite.
        line = "15.16.1 Ud Limpieza final de obra completa"
        m = MU02_PARTIDA_HEADER_RE.match(line)
        assert m is not None
        assert m.group("code") == "15.16.1"

    def test_matches_m_only_unit(self):
        # Caso real MU02: '1.2 M Vallado provisional...'
        line = "1.2 M Vallado provisional de solar compuesto por vallas trasladables."
        m = MU02_PARTIDA_HEADER_RE.match(line)
        assert m is not None
        assert m.group("code") == "1.2"
        assert m.group("unit") == "M"

    def test_does_not_match_total_line(self):
        line = "Total C01.01 236,50"
        assert MU02_PARTIDA_HEADER_RE.match(line) is None

    def test_does_not_match_measurement_header(self):
        line = "Area Largo Ancho Alto Parcial Subtotal"
        assert MU02_PARTIDA_HEADER_RE.match(line) is None

    def test_does_not_match_chapter_alone(self):
        # Chapter alone (sin punto en code) NO debe matchear.
        line = "2 ACONDICIONAMIENTO DEL TERRENO"
        assert MU02_PARTIDA_HEADER_RE.match(line) is None

    def test_does_not_match_measurement_with_invalid_unit(self):
        # '0.80 cm Eje...' es una fila de medición, no partida. 'cm' NO está
        # en el listado MU02 de unidades.
        line = "0.80 cm Eje excavación vivienda 0,8 50,00 40,00"
        assert MU02_PARTIDA_HEADER_RE.match(line) is None


# --- MU02_TOTAL_INLINE_RE ---


class TestMU02TotalInlineRE:
    def test_matches_m2_total(self):
        line = "720,00 m²"
        m = MU02_TOTAL_INLINE_RE.match(line)
        assert m is not None
        assert m.group("qty") == "720,00"
        assert m.group("unit") == "m²"

    def test_matches_ud_total(self):
        line = "1,00 Ud"
        m = MU02_TOTAL_INLINE_RE.match(line)
        assert m is not None
        assert m.group("qty") == "1,00"
        assert m.group("unit") == "Ud"

    def test_matches_m3_total(self):
        line = "445,08 m³"
        m = MU02_TOTAL_INLINE_RE.match(line)
        assert m is not None
        assert m.group("qty") == "445,08"

    def test_matches_h_total(self):
        line = "10,00 h"
        m = MU02_TOTAL_INLINE_RE.match(line)
        assert m is not None
        assert m.group("qty") == "10,00"
        assert m.group("unit") == "h"

    def test_does_not_match_duplicate_subtotal(self):
        # '720,00 720,00' = línea con 2 decimales, NO un total final.
        line = "720,00 720,00"
        assert MU02_TOTAL_INLINE_RE.match(line) is None

    def test_does_not_match_measurement_row(self):
        line = "VIVIENDA [A] 117,9 117,90"
        assert MU02_TOTAL_INLINE_RE.match(line) is None

    def test_does_not_match_subtotal_with_label(self):
        line = "Subtotal 720,00"
        assert MU02_TOTAL_INLINE_RE.match(line) is None

    def test_does_not_match_zero_decimal_with_extra_number(self):
        # '0.80 cm' es una fila de medición; el regex tampoco debería
        # matchear porque tiene texto entre la cantidad y unit.
        line = "0,80 cm Eje excavación"
        assert MU02_TOTAL_INLINE_RE.match(line) is None


# --- MU02_CHAPTER_RE ---


class TestMU02ChapterRE:
    def test_matches_chapter_2(self):
        line = "2 ACONDICIONAMIENTO DEL TERRENO"
        m = MU02_CHAPTER_RE.match(line)
        assert m is not None
        assert m.group("code") == "2"
        assert "ACONDICIONAMIENTO" in m.group("name")

    def test_matches_chapter_15(self):
        line = "15 VARIOS"
        m = MU02_CHAPTER_RE.match(line)
        assert m is not None
        assert m.group("code") == "15"
        assert m.group("name").strip() == "VARIOS"

    def test_matches_chapter_with_comma(self):
        line = "9 REMATES Y AYUDAS"
        m = MU02_CHAPTER_RE.match(line)
        assert m is not None

    def test_matches_chapter_with_accents(self):
        # '12 GESTIÓN DE RESIDUOS' usa Ó mayúscula.
        line = "12 GESTIÓN DE RESIDUOS"
        m = MU02_CHAPTER_RE.match(line)
        assert m is not None
        assert m.group("code") == "12"

    def test_does_not_match_partida(self):
        line = "2.1 M² Desbroce"
        assert MU02_CHAPTER_RE.match(line) is None

    def test_does_not_match_pol_parc(self):
        # 'Pol.11-Parc.213' no es capítulo.
        line = "Pol.11-Parc.213"
        assert MU02_CHAPTER_RE.match(line) is None

    def test_does_not_match_too_short_name(self):
        # 'X' tres caracteres no llega al mínimo 4 chars (case spec).
        line = "1 AB"
        assert MU02_CHAPTER_RE.match(line) is None


# --- MU02_MEASUREMENT_HEADER_RE ---


class TestMU02MeasurementHeaderRE:
    def test_matches_area_largo_ancho_alto(self):
        line = "Area Largo Ancho Alto Parcial Subtotal"
        assert MU02_MEASUREMENT_HEADER_RE.match(line) is not None

    def test_matches_area_prof_ancho_alto(self):
        line = "Area Prof Ancho Alto Parcial Subtotal"
        assert MU02_MEASUREMENT_HEADER_RE.match(line) is not None

    def test_matches_largo_prof_ancho(self):
        line = "Largo Prof Ancho Alto Parcial Subtotal"
        assert MU02_MEASUREMENT_HEADER_RE.match(line) is not None

    def test_does_not_match_table_header(self):
        line = "Nº Ud Descripción Cantidad Precio Total"
        assert MU02_MEASUREMENT_HEADER_RE.match(line) is None
