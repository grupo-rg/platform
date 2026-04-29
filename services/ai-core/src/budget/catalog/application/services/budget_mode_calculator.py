"""Fase 11.D — Cálculo del total de una partida según el modo de presupuesto.

Tres modos:
  - COMPLETE         → todo el breakdown.
  - LABOR_AND_FIXED  → labor + material_fixed + machinery + indirect.
                       Excluye solo MATERIAL_VARIABLE (el material que el cliente paga).
  - LABOR_ONLY       → solo labor.

Cuando el breakdown está vacío y el modo no es COMPLETE, devolvemos 0 — no
podemos descomponer un precio agregado sin sus partes.
"""

from __future__ import annotations

from enum import Enum
from typing import Iterable, Optional

from src.budget.catalog.domain.breakdown_category import (
    BreakdownCategory,
    categorize_component,
)


class BudgetMode(str, Enum):
    COMPLETE = "complete"
    LABOR_AND_FIXED = "labor_and_fixed"
    LABOR_ONLY = "labor_only"


_CATEGORIES_INCLUDED: dict[BudgetMode, set[BreakdownCategory]] = {
    BudgetMode.COMPLETE: {
        BreakdownCategory.LABOR,
        BreakdownCategory.MATERIAL_FIXED,
        BreakdownCategory.MATERIAL_VARIABLE,
        BreakdownCategory.MACHINERY,
        BreakdownCategory.INDIRECT,
        BreakdownCategory.OTHER,
    },
    BudgetMode.LABOR_AND_FIXED: {
        BreakdownCategory.LABOR,
        BreakdownCategory.MATERIAL_FIXED,
        BreakdownCategory.MACHINERY,
        BreakdownCategory.INDIRECT,
        BreakdownCategory.OTHER,  # OTHER se considera fijo por defecto (medios, etc.)
    },
    BudgetMode.LABOR_ONLY: {
        BreakdownCategory.LABOR,
    },
}


class _BreakdownLike:
    """Protocol minimo: un componente con `code`, `type`, `is_variable`, `total`."""

    code: Optional[str]
    type: Optional[str]
    is_variable: Optional[bool]
    total: Optional[float]


def compute_unit_price_for_mode(
    breakdown: Optional[Iterable[_BreakdownLike]],
    fallback_unit_price: float,
    mode: BudgetMode,
) -> float:
    """Devuelve €/unidad de partida para el modo. Si breakdown está vacío:
      - COMPLETE: devuelve `fallback_unit_price` (lo que el Judge calculó).
      - LABOR_AND_FIXED, LABOR_ONLY: devuelve 0 (no podemos descomponer).
    """
    if mode == BudgetMode.COMPLETE:
        if not breakdown:
            return fallback_unit_price

    if not breakdown:
        return 0.0

    included = _CATEGORIES_INCLUDED[mode]
    total = 0.0
    for comp in breakdown:
        category = categorize_component(
            getattr(comp, "code", None),
            getattr(comp, "type", None),
            getattr(comp, "is_variable", None),
        )
        if category in included:
            total += getattr(comp, "total", None) or 0.0
    return total


def compute_partida_total_for_mode(
    breakdown: Optional[Iterable[_BreakdownLike]],
    fallback_unit_price: float,
    quantity: float,
    mode: BudgetMode,
) -> float:
    """Como `compute_unit_price_for_mode` pero multiplicado por la cantidad."""
    unit_price = compute_unit_price_for_mode(breakdown, fallback_unit_price, mode)
    return unit_price * quantity
