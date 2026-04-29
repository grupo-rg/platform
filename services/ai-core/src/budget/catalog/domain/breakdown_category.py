"""Fase 11.D — Categorización de componentes del breakdown.

Cada `BudgetBreakdownComponent` puede pertenecer a una de cinco categorías
(LABOR, MATERIAL_FIXED, MATERIAL_VARIABLE, MACHINERY, INDIRECT, OTHER) que
determinan en qué modo del editor se incluye o excluye:

  - Modo "Sólo mano de obra"        → solo LABOR.
  - Modo "Mano de obra + fijos"     → LABOR + MATERIAL_FIXED + MACHINERY + INDIRECT.
  - Modo "Completo"                 → todo.

La categorización cruza tres señales independientes para ser robusta a
errores del LLM (que a veces emite `type='OTHER'` por defecto):

  1. **code prefix** del catálogo COAATMCA — autoritativo: `mo*` (mano de obra),
     `mt*` (material), `mq*` (maquinaria), `%` o `ci*` (costes indirectos).
  2. **type** emitido por el LLM (LABOR / MATERIAL / MACHINERY / OTHER) — fallback
     cuando no hay code prefix reconocible.
  3. **is_variable** — refina MATERIAL en FIXED vs VARIABLE.

Si las señales discrepan, prevalece el code prefix (los códigos del catálogo
son inmutables, los emitidos por el LLM son interpretativos).
"""

from __future__ import annotations

from enum import Enum
from typing import Optional


class BreakdownCategory(str, Enum):
    LABOR = "labor"                    # mo*
    MATERIAL_FIXED = "material_fixed"  # mt* with is_variable=False (consumibles)
    MATERIAL_VARIABLE = "material_variable"  # mt* with is_variable=True (suministro)
    MACHINERY = "machinery"            # mq*
    INDIRECT = "indirect"              # %, ci*
    OTHER = "other"


_CODE_PREFIX_TO_CATEGORY: dict[str, BreakdownCategory] = {
    "mo": BreakdownCategory.LABOR,
    "mt": BreakdownCategory.MATERIAL_FIXED,  # refinable a VARIABLE si is_variable=True
    "mq": BreakdownCategory.MACHINERY,
    "%": BreakdownCategory.INDIRECT,
    "ci": BreakdownCategory.INDIRECT,
}


_TYPE_FALLBACK: dict[str, BreakdownCategory] = {
    "LABOR": BreakdownCategory.LABOR,
    "MATERIAL": BreakdownCategory.MATERIAL_FIXED,  # refinable
    "MACHINERY": BreakdownCategory.MACHINERY,
    "OTHER": BreakdownCategory.OTHER,
}


def _prefix_lookup(code: Optional[str]) -> Optional[BreakdownCategory]:
    if not code:
        return None
    code_lower = code.strip().lower()
    # Prefijos de 1 char primero (%, etc.) para evitar conflictos con 2 chars.
    if code_lower.startswith("%"):
        return BreakdownCategory.INDIRECT
    for prefix, category in _CODE_PREFIX_TO_CATEGORY.items():
        if len(prefix) >= 2 and code_lower.startswith(prefix):
            return category
    return None


def categorize_component(
    code: Optional[str],
    type_: Optional[str],
    is_variable: Optional[bool],
) -> BreakdownCategory:
    """Devuelve la categoría de un componente cruzando 3 señales.

    Reglas:
      1. Si `code` empieza por un prefijo conocido (mo/mt/mq/%/ci), prevalece.
      2. Si no, se usa `type` como fallback.
      3. Si la categoría base es MATERIAL_FIXED y `is_variable=True`, refina a MATERIAL_VARIABLE.
      4. Si todo falla, devuelve OTHER.
    """
    base = _prefix_lookup(code)
    if base is None and type_:
        base = _TYPE_FALLBACK.get(type_.strip().upper())
    if base is None:
        return BreakdownCategory.OTHER

    if base == BreakdownCategory.MATERIAL_FIXED and is_variable is True:
        return BreakdownCategory.MATERIAL_VARIABLE

    return base
