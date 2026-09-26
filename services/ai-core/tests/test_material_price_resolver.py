"""Tests del resolver PURO `resolve_material_factor` (ajuste de precio por %).

8 casos de PARIDAD con el lado TypeScript. Regla base compartida:
  r1 global +5 · r2 category "Materiales de construcción" +10 ·
  r3 material sku "104562" +20 · r4 client leadId "L1" +8 ·
  r5 budget budgetId "B1" +3.

Verifica la regla "el más específico gana" (budget > client > material >
category > global), la coincidencia de categoría padre en texto libre
"Padre > Hijo", y el filtrado de reglas inactivas.
"""
from __future__ import annotations

import pytest

from src.budget.catalog.domain.material_price_rule import (
    MaterialPriceRule,
    MaterialPriceRuleTarget,
)
from src.budget.catalog.domain.material_price_resolver import resolve_material_factor


def _rule(
    id: str,
    scope: str,
    adjustment_pct: float,
    *,
    active: bool = True,
    category=None,
    sku=None,
    lead_id=None,
    budget_id=None,
) -> MaterialPriceRule:
    return MaterialPriceRule(
        id=id,
        scope=scope,
        target=MaterialPriceRuleTarget(
            category=category, sku=sku, leadId=lead_id, budgetId=budget_id
        ),
        adjustmentPct=adjustment_pct,
        active=active,
        createdBy="tester",
        createdAt="2026-01-01T00:00:00Z",
        updatedBy="tester",
        updatedAt="2026-01-01T00:00:00Z",
    )


def _base_rules(*, r3_active: bool = True) -> list[MaterialPriceRule]:
    return [
        _rule("r1", "global", 5.0),
        _rule("r2", "category", 10.0, category="Materiales de construcción"),
        _rule("r3", "material", 20.0, sku="104562", active=r3_active),
        _rule("r4", "client", 8.0, lead_id="L1"),
        _rule("r5", "budget", 3.0, budget_id="B1"),
    ]


def test_1_falls_back_to_global():
    factor, rule = resolve_material_factor(
        sku="999", category="Pinturas", budget_id=None, lead_id=None, rules=_base_rules()
    )
    assert rule is not None and rule.id == "r1"
    assert factor == pytest.approx(1.05)


def test_2_category_parent_match():
    factor, rule = resolve_material_factor(
        sku="999",
        category="Materiales de construcción > Ladrillos",
        budget_id=None,
        lead_id=None,
        rules=_base_rules(),
    )
    assert rule is not None and rule.id == "r2"
    assert factor == pytest.approx(1.10)


def test_3_material_beats_category():
    factor, rule = resolve_material_factor(
        sku="104562",
        category="Materiales de construcción > Ladrillos",
        budget_id=None,
        lead_id=None,
        rules=_base_rules(),
    )
    assert rule is not None and rule.id == "r3"
    assert factor == pytest.approx(1.20)


def test_4_client_beats_material():
    factor, rule = resolve_material_factor(
        sku="104562",
        category="Materiales de construcción",
        budget_id=None,
        lead_id="L1",
        rules=_base_rules(),
    )
    assert rule is not None and rule.id == "r4"
    assert factor == pytest.approx(1.08)


def test_5_budget_beats_all():
    factor, rule = resolve_material_factor(
        sku="104562",
        category="X",
        budget_id="B1",
        lead_id="L1",
        rules=_base_rules(),
    )
    assert rule is not None and rule.id == "r5"
    assert factor == pytest.approx(1.03)


def test_6_unknown_client_falls_back_to_global():
    factor, rule = resolve_material_factor(
        sku="999",
        category="Pinturas",
        budget_id=None,
        lead_id="L2",
        rules=_base_rules(),
    )
    assert rule is not None and rule.id == "r1"
    assert factor == pytest.approx(1.05)


def test_7_no_rules_returns_identity():
    factor, rule = resolve_material_factor(
        sku="104562", category="Pinturas", budget_id="B1", lead_id="L1", rules=[]
    )
    assert rule is None
    assert factor == pytest.approx(1.0)


def test_8_inactive_material_rule_skipped():
    factor, rule = resolve_material_factor(
        sku="104562",
        category="Materiales de construcción",
        budget_id=None,
        lead_id=None,
        rules=_base_rules(r3_active=False),
    )
    assert rule is not None and rule.id == "r2"
    assert factor == pytest.approx(1.10)
