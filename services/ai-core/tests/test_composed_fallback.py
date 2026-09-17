"""Tests del fallback VALORADO para partidas no resueltas por el swarm.

Antes: una partida omitida por el evaluador LLM (drop de lote/429) caía a
precio 0 (`_build_unresolved_fallback`). Ahora se intenta componer con el
`FromScratchCompositor` (`_build_composed_fallback`) → precio real; solo si el
compositor no da precio se cae al resguardo a 0.
"""

from __future__ import annotations

from unittest.mock import Mock

from src.budget.application.services.from_scratch_compositor import (
    ComposedResult,
    CompositionPlan,
)
from src.budget.application.services.pdf_extractor_service import RestructuredItem
from src.budget.application.services.swarm_pricing_service import SwarmPricingService


class _FakeCompositor:
    def __init__(self, unit_price, breakdown=None):
        self._up = unit_price
        self._bd = breakdown or []

    async def compose(self, *, description, unit, quantity=1.0):
        return ComposedResult(
            unit_price=self._up,
            breakdown=self._bd,
            plan=CompositionPlan(main_task=description),
        )


def _svc(compositor):
    return SwarmPricingService(
        llm_provider=Mock(), vector_search=Mock(), compositor=compositor
    )


def _item():
    return RestructuredItem(
        code="NL-15", description="Grifería para lavabo y ducha",
        unit="ud", quantity=2.0, chapter="FONTANERIA Y GAS",
    )


async def test_composed_fallback_prices_unresolved_partida():
    bd = [
        {"code": "mo001", "concept": "Oficial 1ª", "type": "LABOR", "price": 31.11,
         "unit": "h", "quantity": 1.5, "yield": 1.5, "waste": 0.0, "total": 46.67,
         "is_variable": False},
    ]
    p = await _svc(_FakeCompositor(50.0, bd))._build_composed_fallback(_item())
    assert p is not None
    assert p.unitPrice == 50.0
    assert p.totalPrice == 100.0  # 50 × 2
    assert p.match_kind == "from_scratch"
    assert p.isRealCost is False
    assert p.ai_resolution.needs_human_review is True
    assert p.breakdown and p.breakdown[0].code == "mo001"
    assert p.breakdown[0].type == "LABOR"
    assert "fallback_composed" in (p.reasoning or "")


async def test_composed_fallback_none_when_price_zero():
    # compositor sin precio → None (el caller cae al resguardo a 0)
    p = await _svc(_FakeCompositor(0.0))._build_composed_fallback(_item())
    assert p is None


async def test_composed_fallback_none_without_compositor():
    p = await _svc(None)._build_composed_fallback(_item())
    assert p is None
