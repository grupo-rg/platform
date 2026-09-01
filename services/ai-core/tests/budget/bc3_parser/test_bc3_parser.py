"""Tests del parser BC3 contra los 5 BC3 ciegos reales del cliente.

Sprint 4 Fase L — golden set test.

Cada fixture se valida contra expectativas mínimas:
  - Tree no vacío
  - Al menos N partidas medidas
  - Conceptos con descripción no vacía en >=80%
  - Quantities >0 en mediciones
  - Encoding detectado correctamente

Marker `bc3` permite correr solo este subset rápido:
    pytest -m bc3 services/ai-core/tests/budget/bc3_parser/
"""

from __future__ import annotations

from pathlib import Path

import pytest

from src.budget.bc3_parser import Bc3Parser, bc3_tree_to_restructured_items
from src.budget.bc3_parser.entities import Bc3ConceptKind

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures" / "bc3"


# Expectativas mínimas por BC3 (basadas en el análisis inicial del cliente real).
GOLDEN_SET = [
    # (fixture filename, min_concepts, min_partidas, min_measurements, expected_version_substr)
    (
        "25_126_quatre_cantons_10_felanitx_borrador_instalaciones_260211.bc3",
        40, 30, 30, "FIEBDC-3",
    ),
    (
        "20240531_marina_8_ciego.bc3",
        800, 350, 400, "FIEBDC-3",
    ),
    (
        "remolars7instal_ciego_copia.bc3",
        200, 90, 90, "FIEBDC-3",
    ),
    (
        "piscina20251117_1.bc3",
        500, 40, 40, "FIEBDC-3",
    ),
    (
        "pres_grup_vanrell_vivienda_31_dic_ciego.bc3",
        300, 150, 150, "FIEBDC-3",
    ),
]


pytestmark = pytest.mark.bc3


@pytest.mark.parametrize(
    "filename,min_concepts,min_partidas,min_measurements,expected_version",
    GOLDEN_SET,
)
def test_parses_real_bc3_with_expected_structure(
    filename, min_concepts, min_partidas, min_measurements, expected_version,
):
    """Cada BC3 real se parsea sin errores y tiene la estructura esperada."""
    raw = (FIXTURES / filename).read_bytes()
    tree = Bc3Parser().parse(raw)

    assert tree.version, f"{filename}: no version detected"
    assert expected_version in tree.version, (
        f"{filename}: version mismatch — got {tree.version!r}"
    )

    assert len(tree.concepts) >= min_concepts, (
        f"{filename}: expected >={min_concepts} concepts, got {len(tree.concepts)}"
    )

    partidas = [c for c in tree.concepts.values() if c.kind == Bc3ConceptKind.PARTIDA]
    assert len(partidas) >= min_partidas, (
        f"{filename}: expected >={min_partidas} partidas, got {len(partidas)}"
    )

    assert len(tree.measurements) >= min_measurements, (
        f"{filename}: expected >={min_measurements} measurements, "
        f"got {len(tree.measurements)}"
    )

    # Todas las mediciones deben tener quantity > 0.
    zero_qty = [m for m in tree.measurements.values() if m.total_quantity <= 0]
    assert not zero_qty, (
        f"{filename}: {len(zero_qty)} measurements with qty <= 0"
    )

    # Currency detectada (default EUR si no está).
    assert tree.currency in ("EUR", "USD", "GBP")


@pytest.mark.parametrize("filename,_a,_b,_c,_d", GOLDEN_SET)
def test_to_restructured_produces_valid_items(filename, _a, _b, _c, _d):
    """El adapter produce RestructuredItem con campos esenciales no nulos."""
    raw = (FIXTURES / filename).read_bytes()
    tree = Bc3Parser().parse(raw)
    items = bc3_tree_to_restructured_items(tree)

    assert items, f"{filename}: no items produced"

    for item in items:
        assert item.code, f"{filename}: item without code"
        assert item.description, f"{filename}: item {item.code} without description"
        assert item.quantity > 0, (
            f"{filename}: item {item.code} with qty={item.quantity}"
        )
        assert item.unit, f"{filename}: item {item.code} without unit"
        # chapter es 'Sin Capítulo' si no se pudo inferir — siempre poblado.
        assert item.chapter


def test_quatre_cantons_quantities_match_known_values():
    """Validación quantitativa específica: Quatre Cantons tiene qty conocidas."""
    raw = (FIXTURES / GOLDEN_SET[0][0]).read_bytes()
    tree = Bc3Parser().parse(raw)

    # Estos valores los confirmé empíricamente comparando con el PDF original.
    expected = {
        "81PTOTIMBRE": 1.0,         # PUNTO PULSADOR TIMBRE
        "02EBPLSJ": 33.0,           # PUNTO LUZ SIMPLE
        "02EBPLCJ": 23.0,           # PUNTO LUZ CONMUTADO
        "02EBPLCRJ": 13.0,          # PUNTO LUZ CRUZAMIENTO
        "83PTOLUZADICJ": 98.0,      # PUNTO LUZ ADICIONAL
        "71PLAEXT": 21.0,           # PUNTO LUZ EXTERIORES
        "400712BS990": 102.0,       # BASE ENCHUFE 16A
        "400712BSA990": 69.0,       # BASE ENCHUFE 16A ANEXA
    }
    for code, qty_expected in expected.items():
        actual = tree.get_quantity(code)
        assert actual == pytest.approx(qty_expected), (
            f"Quatre Cantons {code}: esperaba qty={qty_expected}, parser dio {actual}"
        )


def test_encoding_latin1_handled():
    """Todos los BC3 del cliente usan latin-1 (ANSI) — el parser los decodifica."""
    raw = (FIXTURES / GOLDEN_SET[0][0]).read_bytes()
    # Verificar que el primer record tiene `~V` (no mojibake).
    tree = Bc3Parser().parse(raw)
    # Si el encoding fuese incorrecto, tree.version estaría vacío o mojibake.
    assert tree.version.startswith("FIEBDC-3"), (
        f"Encoding probablemente mal detectado — version={tree.version!r}"
    )


def test_parciales_parsed_into_structured_lines():
    """El desglose (~M parciales) se parsea en líneas estructuradas cuyo
    subtotal suma (±2%) el total declarado en >=95% de las partidas con
    desglose numérico. Validado sobre el golden set real."""
    ok = with_lines = 0
    for filename, *_ in GOLDEN_SET:
        tree = Bc3Parser().parse((FIXTURES / filename).read_bytes())
        for m in tree.measurements.values():
            numeric = [l for l in m.lines if not l.is_section and l.subtotal is not None]
            if not numeric:
                continue
            with_lines += 1
            denom = abs(m.total_quantity) or 1.0
            if abs(m.computed_total() - m.total_quantity) / denom <= 0.02:
                ok += 1
    assert with_lines > 0, "ninguna partida con parciales estructurados"
    rate = ok / with_lines
    assert rate >= 0.95, f"solo {rate:.1%} de partidas cuadran (esperado >=95%)"


def test_restructured_carries_bc3_price_and_measurements():
    """Un BC3 CON precios → el RestructuredItem lleva bc3_unit_price y measurements."""
    bc3 = (
        "~V|EMISOR|FIEBDC-3/2002|TEST|||ANSI||\r\n"
        "~C|CAP01##|CAP|CAPITULO UNO|0|||\r\n"
        "~C|P001|m3|Excavacion mecanica|54.00|||\r\n"
        "~D|CAP01##|P001\\1\\1\\|\r\n"
        "~M|CAP01##\\P001||10|\\Zona A\\1\\5\\\\2\\|\r\n"
    ).encode("cp1252")
    tree = Bc3Parser().parse(bc3)
    items = bc3_tree_to_restructured_items(tree)

    assert len(items) == 1
    it = items[0]
    assert it.code == "P001"
    assert it.bc3_unit_price == pytest.approx(54.0)
    assert it.measurements and len(it.measurements) == 1
    assert it.measurements[0]["comment"] == "Zona A"
    assert it.measurements[0]["subtotal"] == pytest.approx(10.0)  # 1 × 5 × 2


def test_restructured_ciego_has_no_price_but_carries_measurements():
    """Un BC3 ciego (fixture) → bc3_unit_price None, pero measurements poblado."""
    tree = Bc3Parser().parse((FIXTURES / GOLDEN_SET[0][0]).read_bytes())
    items = bc3_tree_to_restructured_items(tree)

    assert all(it.bc3_unit_price is None for it in items), "el borrador ciego no trae precios"
    assert any(it.measurements for it in items), "esperaba items con mediciones estructuradas"


def test_quatre_cantons_measurement_breakdown():
    """02EBPLSJ (Punto de luz simple, 33 ud) tiene desglose por estancia
    agrupado en secciones (PLANTA BAJA, PLANTA PISO...) que suma 33."""
    tree = Bc3Parser().parse((FIXTURES / GOLDEN_SET[0][0]).read_bytes())
    m = tree.measurements["02EBPLSJ"]

    assert m.lines, "sin líneas de medición estructuradas"
    sections = [l for l in m.lines if l.is_section]
    numeric = [l for l in m.lines if not l.is_section]
    assert sections, "esperaba encabezados de sección (plantas)"
    assert any(l.comment == "PLANTA BAJA" for l in sections)
    assert numeric, "esperaba líneas con unidades por estancia"
    # Todas las líneas numéricas de conteo tienen units y subtotal.
    assert all(l.subtotal is not None for l in numeric)
    assert m.computed_total() == pytest.approx(33.0)
    assert m.total_quantity == pytest.approx(33.0)
