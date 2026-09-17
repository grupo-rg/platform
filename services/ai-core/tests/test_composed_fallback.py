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


# ---------------------------------------------------------------------------
# Fix del pricing cache: alinear identidad/medición del item actual, no la stale
# ---------------------------------------------------------------------------

from src.budget.domain.entities import BudgetPartida, OriginalItem, AIResolution  # noqa: E402


def _cached_partida_stale():
    """Partida como vendría del cache: matcheada 1:1 (DRA010, 16.43 €/m²) pero con
    el code+quantity STALE de otro run (NL-2, 15 m²)."""
    return BudgetPartida.model_validate({
        "id": "old-uuid",
        "order": 3,
        "original_item": OriginalItem(code="NL-2", description="Demolición de alicatado",
                                      quantity=15.0, unit="m2", chapter="DEMOLICIONES").model_dump(),
        "ai_resolution": AIResolution(reasoning_trace="DRA010 match", calculated_unit_price=16.43,
                                      calculated_total_price=246.45, confidence_score=95,
                                      is_estimated=False, needs_human_review=False).model_dump(),
        "code": "NL-2", "description": "Demolición de alicatado", "unit": "m2",
        "quantity": 15.0, "unitPrice": 16.43, "totalPrice": 246.45,
        "match_kind": "1:1", "matchConfidence": 95.0, "isRealCost": True,
    })


def test_align_cached_partida_overrides_identity_and_recomputes_total():
    cached = _cached_partida_stale()
    current = RestructuredItem(code="NL-1", description="Demolición de alicatado existente en paredes",
                              quantity=10.0, unit="m2", chapter="DEMOLICIONES")
    p = SwarmPricingService._align_cached_partida(cached, current)
    # identidad = la del item ACTUAL
    assert p.code == "NL-1"
    assert p.quantity == 10.0
    assert p.original_item.code == "NL-1"
    # PRECIO unitario reutilizado del cache; total RECALCULADO con la cantidad actual
    assert p.unitPrice == 16.43
    assert p.totalPrice == 164.30  # 16.43 × 10, NO 246.45 (15 stale)
    assert p.ai_resolution.calculated_total_price == 164.30
    # pricing preservado
    assert p.match_kind == "1:1"
    assert p.matchConfidence == 95.0
    assert p.id != "old-uuid"  # id fresco
