"""Fase 5.H (Golden 001) — tests del parser de presupuestos Presto (P030326).

Presto es el software que Grupo RG usa para tasar. Sus PDFs tienen formato
muy regular, heredado históricamente:

  Capítulo nº {num} {NOMBRE}
  Nº Ud Descripción Medición Precio Importe
  {num} {code} {unit} {descripción multi-línea...}
  [opcional: subtotales por zona: "Uds. Largo Ancho Alto Parcial Subtotal"]
  [opcional: líneas de "VIVIENDA [A] 117,9 117,90"]
  Total {unit} : {quantity} {unitPrice} € {totalPrice} €

Los tests cubren los casos reales detectados en P030326:
  1. Partida simple (1:1) con Total directo.
  2. Partida con subtotales por zona antes del Total.
  3. Partida multi-nivel (4.1.9 EHV030b M³...).
  4. Capítulo con varias partidas.
  5. Resumen final del PEM (página 33).
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

# Carga el script como módulo (vive en scripts/, no en src/)
_SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "parse_p030326_to_expected.py"
spec = importlib.util.spec_from_file_location("parse_p030326", _SCRIPT)
assert spec is not None and spec.loader is not None
_mod = importlib.util.module_from_spec(spec)
sys.modules["parse_p030326"] = _mod
spec.loader.exec_module(_mod)

parse_presto_text = _mod.parse_presto_text
Partida = _mod.Partida
Chapter = _mod.Chapter


# -------- Fixtures (textos reales de P030326) -----------------------------


CAPITULO_1_PAGINA_2 = """\
Proyecto: P030326 PRESUPUESTO ALBAÑILERIA
Promotor:
Situación:
: IV - V Mediciones y Presupuesto
Capítulo nº 1 ACTUACIONES PREVIAS
Nº Ud Descripción Medición Precio Importe
1.1 ACCESO Ud Acondicioanmiento de la entrada del solar para camiones.
Incluye:
- Limpiar superficie
- Meter 10cm de grava, 40-60mm, 50m2
- Compactar Grava....
Total Ud : 1,00 1.210,00 € 1.210,00 €
1.2 VALLADO M Vallado provisional de solar compuesto por vallas trasladables de 3,50x2,00 m, formadas por panel
de malla electrosoldada de 200x100 mm de paso de malla y postes verticales de 40 mm de
diámetro, acabado galvanizado, colocados sobre bases prefabricadas de hormigón fijadas al
pavimento, con malla de ocultación colocada sobre las vallas. Amortizables las vallas en 5 usos y
las bases en 5 usos.
Total m : 10,00 35,00 € 350,00 €
1.3 GRIFOBR Ud Conexión de salida de agua con grifo para el uso durante la ejecución de las obras. Totalmente
montado e instalado. Incluye, 4 depositos de 1m3 cada uno. También, retirada del mismo una vez
finalizada la obra.
Total Ud : 1,00 1.600,00 € 1.600,00 €
"""


CAPITULO_2_CON_SUBTOTALES = """\
Capítulo nº 2 ACONDICIONAMIENTO DEL TERRENO
Nº Ud Descripción Medición Precio Importe
2.1 ADL005 M² Desbroce y limpieza del terreno, con medios mecánicos. Comprende los trabajos necesarios para
retirar de las zonas previstas para la edificación o urbanización: pequeñas plantas, maleza, broza.
Uds. Largo Ancho Alto Parcial Subtotal
VIVIENDA [A] 117,9 117,90
CASETA [A] 19,4 19,40
TERRAZA 01 Y 02 / PÉRGOLA 01 Y 02 [A] 215,83 215,83
PISCINA [A] 61,58 61,58
ACCESO [A] 5,29 5,29
A 300 300,00
720,00 720,00
Total m² : 720,00 2,15 € 1.548,00 €
"""


CAPITULO_MULTINIVEL = """\
Capítulo nº 4 ESTRUCTURA
Nº Ud Descripción Medición Precio Importe
4.1.9 EHV030b M³ Formación de pórtico de hormigón armado, realizada con hormigón HA-30/B/20/IIIa fabricado en central.
Uds. Largo Ancho Alto Parcial Subtotal
Portico 1,2,3,4 4 9,00 0,25 0,30 2,70
Portico 7,8 2 11,00 0,27 0,40 2,38
Portico 5,6 2 6,00 0,25 0,40 1,20
6,28 6,28
Total m³ : 6,28 1.150,00 € 7.222,00 €
"""


RESUMEN_PEM_FINAL = """\
Presupuesto de ejecución material
1 ACTUACIONES PREVIAS 9.695,00 €
2 ACONDICIONAMIENTO DEL TERRENO 27.516,13 €
3 CIMENTACIONES 15.857,50 €
4 ESTRUCTURA 101.738,05 €
5 FACHADAS 75.178,44 €
14 SEGURIDAD Y SALUD 18.200,00 €
15 VARIOS 570,00 €
Total .........: 549.636,90 €
"""


# -------- Tests: partidas individuales -------------------------------------


class TestParsePartidaSimple:
    def test_canonical_acondicionamiento_11(self):
        """La partida 1.1 ACCESO es el caso canónico del sprint. Validar que
        el parser la extrae con todos los campos esperados."""
        result = parse_presto_text(CAPITULO_1_PAGINA_2)
        partidas = result["partidas"]
        p11 = next((p for p in partidas if p.num == "1.1"), None)
        assert p11 is not None, "partida 1.1 no extraída"
        assert p11.code == "ACCESO"
        assert p11.unit == "Ud"
        assert p11.quantity == pytest.approx(1.0)
        assert p11.unitPrice == pytest.approx(1210.0)
        assert p11.totalPrice == pytest.approx(1210.0)
        assert p11.chapter_num == 1
        assert "Acondicioanmiento" in p11.description
        assert "10cm de grava" in p11.description

    def test_extracts_all_three_partidas_from_chapter_1(self):
        result = parse_presto_text(CAPITULO_1_PAGINA_2)
        nums = {p.num for p in result["partidas"]}
        assert nums == {"1.1", "1.2", "1.3"}

    def test_partida_12_with_unit_m(self):
        result = parse_presto_text(CAPITULO_1_PAGINA_2)
        p12 = next(p for p in result["partidas"] if p.num == "1.2")
        assert p12.code == "VALLADO"
        assert p12.unit.lower() == "m"
        assert p12.quantity == pytest.approx(10.0)
        assert p12.unitPrice == pytest.approx(35.0)
        assert p12.totalPrice == pytest.approx(350.0)


class TestParsePartidaWithSubtotals:
    """El parser debe ignorar los subtotales por zona y quedarse con el Total final."""

    def test_partida_with_zone_subtotals(self):
        result = parse_presto_text(CAPITULO_2_CON_SUBTOTALES)
        partidas = result["partidas"]
        assert len(partidas) == 1
        p = partidas[0]
        assert p.num == "2.1"
        assert p.code == "ADL005"
        assert p.unit == "M²"
        assert p.quantity == pytest.approx(720.0)
        assert p.unitPrice == pytest.approx(2.15)
        assert p.totalPrice == pytest.approx(1548.0)


class TestParseMultiLevelCode:
    """Partidas como 4.1.9 (tres niveles) deben parsearse igual que 1.1."""

    def test_partida_419_multinivel(self):
        result = parse_presto_text(CAPITULO_MULTINIVEL)
        partidas = result["partidas"]
        assert len(partidas) == 1
        p = partidas[0]
        assert p.num == "4.1.9"
        assert p.code == "EHV030b"
        assert p.unit == "M³"
        assert p.quantity == pytest.approx(6.28)
        assert p.unitPrice == pytest.approx(1150.0)
        assert p.totalPrice == pytest.approx(7222.0)
        assert p.chapter_num == 4


# -------- Tests: capítulos + resumen ---------------------------------------


class TestParseChapters:
    def test_chapter_detected_from_header(self):
        result = parse_presto_text(CAPITULO_1_PAGINA_2)
        chapters = {c.num: c.name for c in result["chapters"]}
        assert chapters.get(1) == "ACTUACIONES PREVIAS"

    def test_multiple_chapters_in_same_pass(self):
        text = CAPITULO_1_PAGINA_2 + CAPITULO_2_CON_SUBTOTALES
        result = parse_presto_text(text)
        chapter_nums = sorted(c.num for c in result["chapters"])
        assert chapter_nums == [1, 2]


class TestParseResumenFinal:
    def test_pem_total_extracted_from_final_summary(self):
        result = parse_presto_text(RESUMEN_PEM_FINAL)
        assert result["pem_total"] == pytest.approx(549636.90, abs=0.01)

    def test_chapter_totals_extracted(self):
        result = parse_presto_text(RESUMEN_PEM_FINAL)
        # Los totales parciales por capítulo también entran al dict chapters
        chapter_totals = {c.num: c.total for c in result["chapters"] if c.total is not None}
        assert chapter_totals.get(1) == pytest.approx(9695.0)
        assert chapter_totals.get(4) == pytest.approx(101738.05)
        assert chapter_totals.get(15) == pytest.approx(570.0)


# -------- Integración completa ---------------------------------------------


class TestFullPipeline:
    def test_combined_text_extracts_all(self):
        text = CAPITULO_1_PAGINA_2 + CAPITULO_2_CON_SUBTOTALES + CAPITULO_MULTINIVEL + RESUMEN_PEM_FINAL
        result = parse_presto_text(text)
        assert len(result["partidas"]) == 5  # 1.1, 1.2, 1.3, 2.1, 4.1.9
        assert result["pem_total"] == pytest.approx(549636.90, abs=0.01)
