"""Resolución PURA del factor de ajuste de precio de un material.

Regla "el más específico gana": de todas las reglas ACTIVAS que le aplican a
un material, se aplica UNA sola — la del scope más específico. Orden de
especificidad (mayor → menor):

    budget  >  client  >  material  >  category  >  global

Módulo determinista y sin I/O (espejo de la lógica del lado TypeScript, para
garantizar paridad de resultados). El adapter Firestore aporta las reglas;
esta función solo decide cuál gana y con qué factor.
"""

from __future__ import annotations

from typing import Optional

from src.budget.catalog.domain.material_price_rule import MaterialPriceRule


def _normalize_category(category: str) -> str:
    """Normaliza los espacios alrededor de '>' en una categoría "Padre > Hijo".

    "Materiales de construcción>Ladrillos"     → "Materiales de construcción > Ladrillos"
    "Materiales de construcción  >  Ladrillos" → "Materiales de construcción > Ladrillos"
    """
    return " > ".join(part.strip() for part in category.split(">"))


def _factor(rule: MaterialPriceRule) -> float:
    return 1.0 + rule.adjustmentPct / 100.0


def resolve_material_factor(
    *,
    sku: Optional[str],
    category: Optional[str],
    budget_id: Optional[str],
    lead_id: Optional[str],
    rules: list[MaterialPriceRule],
) -> tuple[float, Optional[MaterialPriceRule]]:
    """Devuelve ``(factor, regla_aplicada)`` para un material.

    Filtra reglas inactivas y devuelve la primera coincidencia en orden de
    especificidad decreciente. Sin coincidencia → ``(1.0, None)`` (precio sin
    ajustar).
    """
    active = [r for r in rules if r.active is True]

    # 1. budget — el presupuesto concreto (más específico).
    if budget_id is not None:
        for r in active:
            if r.scope == "budget" and r.target.budgetId == budget_id:
                return (_factor(r), r)

    # 2. client — el cliente/lead concreto.
    if lead_id is not None:
        for r in active:
            if r.scope == "client" and r.target.leadId == lead_id:
                return (_factor(r), r)

    # 3. material — el SKU concreto.
    if sku is not None:
        for r in active:
            if r.scope == "material" and r.target.sku == sku:
                return (_factor(r), r)

    # 4. category — categoría exacta o categoría padre (texto libre "Padre > Hijo").
    if category is not None:
        mat_cat = _normalize_category(category)
        for r in active:
            if r.scope != "category" or r.target.category is None:
                continue
            target_cat = _normalize_category(r.target.category)
            if mat_cat == target_cat or mat_cat.startswith(target_cat + " > "):
                return (_factor(r), r)

    # 5. global — aplica a todo (menos específico).
    for r in active:
        if r.scope == "global":
            return (_factor(r), r)

    return (1.0, None)
