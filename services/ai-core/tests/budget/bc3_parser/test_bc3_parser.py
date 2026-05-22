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
