"""Phase 17 — Tests para bake_markup_into_budget.

Cubre los 3 casos del plan:
1. GG=10, BI=15 (Grupo RG) → factor 1.25, partidas y componentes escalados,
   raw preservado en aiResolution.calculated_unit_price_raw y breakdown[].rawPrice/rawTotal.
2. GG=0, BI=0 → factor 1.0, no-op funcional pero stamp version.
3. Multi-chapter, multi-partida → todas escaladas independientemente.
"""
from __future__ import annotations

from datetime import datetime

from src.budget.application.services.markup_distributor import (
    bake_markup_into_budget,
    CALIBRATION_VERSION_PHASE17,
)
from src.budget.domain.entities import (
    AIResolution,
    Budget,
    BudgetBreakdownComponent,
    BudgetChapter,
    BudgetCostBreakdown,
    BudgetPartida,
    PersonalInfo,
    ProjectSpecs,
)


def _make_partida(unit_price: float, quantity: float, components: list[tuple[float, float]] | None = None) -> BudgetPartida:
    breakdown = None
    if components is not None:
        breakdown = [
            BudgetBreakdownComponent(
                code=f"C{i}",
                concept=f"comp {i}",
                type="OTHER",
                price=p,
                total=t,
            )
            for i, (p, t) in enumerate(components)
        ]
    return BudgetPartida(
        id=f"p-{unit_price}",
        order=1,
        code="01.01",
        description="test",
        unit="m",
        quantity=quantity,
        unitPrice=unit_price,
        totalPrice=unit_price * quantity,
        ai_resolution=AIResolution(
            reasoning_trace="t",
            calculated_unit_price=unit_price,
            calculated_total_price=unit_price * quantity,
            confidence_score=95,
            is_estimated=False,
            needs_human_review=False,
        ),
        breakdown=breakdown,
    )


def _make_budget(partidas_per_chapter: list[list[BudgetPartida]]) -> Budget:
    chapters = [
        BudgetChapter(
            id=f"ch-{i}",
            name=f"Capítulo {i}",
            order=i,
            items=ps,
            totalPrice=sum(p.totalPrice for p in ps),
        )
        for i, ps in enumerate(partidas_per_chapter, start=1)
    ]
    return Budget(
        id="test-budget",
        leadId="lead-1",
        clientSnapshot=PersonalInfo(),
        status="draft",
        createdAt=datetime.utcnow(),
        updatedAt=datetime.utcnow(),
        version=1,
        specs=ProjectSpecs(),
        chapters=chapters,
        costBreakdown=BudgetCostBreakdown(
            materialExecutionPrice=0.0, overheadExpenses=0.0,
            industrialBenefit=0.0, tax=0.0, globalAdjustment=0.0, total=0.0,
        ),
        totalEstimated=0.0,
    )


def test_grupo_rg_defaults_factor_125():
    # GG=10, BI=15 → factor 1.25 (caso del usuario)
    partida = _make_partida(
        unit_price=184.0,
        quantity=76.5,
        components=[(82.21, 82.21), (20.92, 20.92), (59.61, 59.61), (21.26, 21.26)],
    )
    budget = _make_budget([[partida]])
    budget, factor = bake_markup_into_budget(budget, gg_pct=10.0, bi_pct=15.0)

    assert factor == 1.25
    assert budget.calibrationVersion == CALIBRATION_VERSION_PHASE17

    p = budget.chapters[0].items[0]
    assert p.unitPrice == 230.0  # 184 × 1.25
    assert p.totalPrice == round(230.0 * 76.5, 2)
    assert p.ai_resolution.calculated_unit_price_raw == 184.0

    # Componentes escalados Y raw preservado
    assert p.breakdown[0].price == round(82.21 * 1.25, 2)
    assert p.breakdown[0].rawPrice == 82.21
    assert p.breakdown[0].rawTotal == 82.21

    # Sum components ≈ unit_price (within rounding)
    sum_total = sum(b.total for b in p.breakdown)
    assert abs(sum_total - 230.0) < 0.05


def test_zero_margins_factor_one_stamps_version():
    partida = _make_partida(
        unit_price=100.0,
        quantity=1.0,
        components=[(60.0, 60.0), (40.0, 40.0)],
    )
    budget = _make_budget([[partida]])
    budget, factor = bake_markup_into_budget(budget, gg_pct=0.0, bi_pct=0.0)

    assert factor == 1.0
    assert budget.calibrationVersion == CALIBRATION_VERSION_PHASE17
    assert budget.chapters[0].items[0].unitPrice == 100.0
    assert budget.chapters[0].items[0].breakdown[0].price == 60.0
    # raw preservado igualmente (snapshot completo siempre)
    assert budget.chapters[0].items[0].breakdown[0].rawPrice == 60.0


def test_multi_chapter_multi_partida_all_baked():
    p1 = _make_partida(unit_price=100.0, quantity=2.0, components=[(50.0, 50.0), (50.0, 50.0)])
    p2 = _make_partida(unit_price=200.0, quantity=1.0, components=[(120.0, 120.0), (80.0, 80.0)])
    p3 = _make_partida(unit_price=80.0, quantity=10.0, components=[(80.0, 80.0)])

    budget = _make_budget([[p1, p2], [p3]])
    budget, factor = bake_markup_into_budget(budget, gg_pct=10.0, bi_pct=15.0)

    assert factor == 1.25
    assert budget.chapters[0].items[0].unitPrice == 125.0
    assert budget.chapters[0].items[1].unitPrice == 250.0
    assert budget.chapters[1].items[0].unitPrice == 100.0

    # Chapter totals reflejan sum de partidas baked
    assert budget.chapters[0].totalPrice == round(125.0 * 2 + 250.0 * 1, 2)
    assert budget.chapters[1].totalPrice == round(100.0 * 10, 2)


def test_partida_without_breakdown_still_bakes_unit_price():
    partida = _make_partida(unit_price=100.0, quantity=1.0, components=None)
    budget = _make_budget([[partida]])
    budget, factor = bake_markup_into_budget(budget, gg_pct=10.0, bi_pct=15.0)

    p = budget.chapters[0].items[0]
    assert p.unitPrice == 125.0
    assert p.breakdown is None
    assert p.ai_resolution.calculated_unit_price_raw == 100.0
