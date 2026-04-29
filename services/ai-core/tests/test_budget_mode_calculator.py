"""Fase 11.D — Helpers de cálculo de los 3 modos de presupuesto.

Reglas:
  - LABOR_ONLY → solo componentes mo* (o type=LABOR como fallback).
  - LABOR_AND_FIXED → todo excepto MATERIAL_VARIABLE.
  - COMPLETE → todo.

La categorización cruza code prefix + type + is_variable. Si discrepan,
prevalece el code prefix (autoritativo del catálogo COAATMCA).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional

from src.budget.catalog.application.services.budget_mode_calculator import (
    BudgetMode,
    compute_partida_total_for_mode,
    compute_unit_price_for_mode,
)
from src.budget.catalog.domain.breakdown_category import (
    BreakdownCategory,
    categorize_component,
)


@dataclass
class _FakeComponent:
    code: Optional[str] = None
    type: Optional[str] = None
    is_variable: Optional[bool] = None
    total: Optional[float] = 0.0


# -------- Tests de categorize_component (3 señales) ----------------------------


def test_categorize_prevalece_code_prefix_over_llm_type() -> None:
    """`code='mo123'` → LABOR aunque el LLM emita `type='MATERIAL'`."""
    cat = categorize_component(code="mo123", type_="MATERIAL", is_variable=True)
    assert cat == BreakdownCategory.LABOR


def test_categorize_falls_back_to_type_when_no_code_prefix_match() -> None:
    """Sin prefijo conocido, se usa el `type` del LLM."""
    cat = categorize_component(code="ABC123", type_="LABOR", is_variable=False)
    assert cat == BreakdownCategory.LABOR


def test_categorize_refines_material_to_variable_when_flag_true() -> None:
    """`mt*` con `is_variable=True` → MATERIAL_VARIABLE."""
    cat = categorize_component(code="mt51grout", type_=None, is_variable=True)
    assert cat == BreakdownCategory.MATERIAL_VARIABLE


def test_categorize_keeps_material_fixed_when_flag_false_or_none() -> None:
    cat_false = categorize_component(code="mt51grout", type_=None, is_variable=False)
    cat_none = categorize_component(code="mt51grout", type_=None, is_variable=None)
    assert cat_false == BreakdownCategory.MATERIAL_FIXED
    assert cat_none == BreakdownCategory.MATERIAL_FIXED


def test_categorize_indirect_for_percent_and_ci() -> None:
    assert categorize_component("%01", None, None) == BreakdownCategory.INDIRECT
    assert categorize_component("ci-001", None, None) == BreakdownCategory.INDIRECT


def test_categorize_other_when_all_signals_unknown() -> None:
    assert categorize_component(None, None, None) == BreakdownCategory.OTHER
    assert categorize_component("XYZ", "WEIRD", None) == BreakdownCategory.OTHER


# -------- Tests de compute_unit_price_for_mode --------------------------------


_REPRESENTATIVE_BREAKDOWN: List[_FakeComponent] = [
    _FakeComponent(code="mo112", type="LABOR", is_variable=False, total=50.0),
    _FakeComponent(code="mt51grout", type="MATERIAL", is_variable=True, total=100.0),  # variable
    _FakeComponent(code="mq05pdm", type="MACHINERY", is_variable=False, total=20.0),
]


def test_labor_only_filters_only_mo_prefix() -> None:
    """`LABOR_ONLY` solo suma componentes mo*."""
    total = compute_unit_price_for_mode(
        _REPRESENTATIVE_BREAKDOWN, fallback_unit_price=170.0, mode=BudgetMode.LABOR_ONLY
    )
    assert total == 50.0


def test_labor_and_fixed_excludes_only_variable_materials() -> None:
    """`LABOR_AND_FIXED` excluye solo MATERIAL_VARIABLE.
    Aquí: 50€ (mo) + 20€ (mq) = 70€. El mt* variable (100€) NO entra.
    """
    total = compute_unit_price_for_mode(
        _REPRESENTATIVE_BREAKDOWN, fallback_unit_price=170.0, mode=BudgetMode.LABOR_AND_FIXED
    )
    assert total == 70.0


def test_complete_includes_everything() -> None:
    total = compute_unit_price_for_mode(
        _REPRESENTATIVE_BREAKDOWN, fallback_unit_price=170.0, mode=BudgetMode.COMPLETE
    )
    assert total == 170.0


def test_empty_breakdown_returns_fallback_for_complete() -> None:
    """Sin breakdown, modo COMPLETE devuelve el unit_price calculado por el Judge."""
    assert compute_unit_price_for_mode(None, fallback_unit_price=42.0, mode=BudgetMode.COMPLETE) == 42.0
    assert compute_unit_price_for_mode([], fallback_unit_price=42.0, mode=BudgetMode.COMPLETE) == 42.0


def test_empty_breakdown_returns_zero_for_partial_modes() -> None:
    """Sin breakdown no podemos descomponer → modos parciales devuelven 0."""
    assert compute_unit_price_for_mode(None, fallback_unit_price=42.0, mode=BudgetMode.LABOR_ONLY) == 0.0
    assert compute_unit_price_for_mode([], fallback_unit_price=42.0, mode=BudgetMode.LABOR_AND_FIXED) == 0.0


def test_partida_total_multiplies_by_quantity() -> None:
    """`compute_partida_total_for_mode` aplica × quantity al unit_price."""
    total = compute_partida_total_for_mode(
        _REPRESENTATIVE_BREAKDOWN,
        fallback_unit_price=170.0,
        quantity=10.0,
        mode=BudgetMode.LABOR_ONLY,
    )
    assert total == 500.0  # 50€/u × 10
