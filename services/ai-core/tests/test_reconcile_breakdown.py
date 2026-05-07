"""Phase 17 — Tests para reconcile_breakdown.

Cubre los 6 casos del plan:
1. Breakdown vacío → no-op.
2. Sum exactamente igual → no-op.
3. Divergencia 1% → auto-fix, sin flag.
4. Divergencia 5% → no auto-fix, flag, valores raw preservados.
5. Sum_breakdown == 0 → flag.
6. Componente con yield_amount > 1 → escalar total y derivar price.
"""
from __future__ import annotations

from src.budget.application.services.reconciliation import reconcile_breakdown
from src.budget.domain.entities import BudgetBreakdownComponent


def _make_component(price: float, total: float, yield_amount: float = 1.0, code: str = "X") -> BudgetBreakdownComponent:
    return BudgetBreakdownComponent(
        code=code,
        concept=f"comp {code}",
        type="OTHER",
        price=price,
        total=total,
        **{"yield": yield_amount},  # alias 'yield' for yield_amount
    )


def test_empty_breakdown_returns_noop():
    result = reconcile_breakdown(unit_price=230.0, breakdown=[])
    assert result.needs_review is False
    assert result.divergence_pct == 0.0
    assert result.divergence_amount == 0.0
    assert result.breakdown == []


def test_unit_price_zero_returns_noop():
    bd = [_make_component(price=10.0, total=10.0)]
    result = reconcile_breakdown(unit_price=0.0, breakdown=bd)
    assert result.needs_review is False
    assert result.breakdown[0].price == 10.0


def test_exact_sum_returns_noop():
    bd = [
        _make_component(price=82.21, total=82.21, code="A"),
        _make_component(price=20.92, total=20.92, code="B"),
        _make_component(price=59.61, total=59.61, code="C"),
        _make_component(price=21.26, total=21.26, code="D"),
    ]
    result = reconcile_breakdown(unit_price=184.00, breakdown=bd)
    assert result.needs_review is False
    assert abs(result.divergence_pct) < 0.001
    assert result.breakdown[0].price == 82.21


def test_divergence_one_percent_auto_fixes_silently():
    # sum = 100.0, unit_price = 99.0 → divergencia ~1.01% < 2%
    bd = [
        _make_component(price=50.0, total=50.0, code="A"),
        _make_component(price=50.0, total=50.0, code="B"),
    ]
    result = reconcile_breakdown(unit_price=99.0, breakdown=bd)
    assert result.needs_review is False
    new_sum = sum(b.total for b in result.breakdown)
    assert abs(new_sum - 99.0) < 0.05  # within rounding


def test_divergence_five_percent_flags_for_review():
    # sum = 184.0, unit_price = 230.0 → divergencia 25% (caso del usuario)
    bd = [
        _make_component(price=82.21, total=82.21, code="A"),
        _make_component(price=20.92, total=20.92, code="B"),
        _make_component(price=59.61, total=59.61, code="C"),
        _make_component(price=21.26, total=21.26, code="D"),
    ]
    result = reconcile_breakdown(unit_price=230.0, breakdown=bd)
    assert result.needs_review is True
    assert result.divergence_pct > 0.02
    assert abs(result.divergence_amount - (184.0 - 230.0)) < 0.1
    # Valores raw preservados (sin escalar)
    assert result.breakdown[0].price == 82.21
    assert result.breakdown[3].total == 21.26


def test_sum_zero_flags_for_review():
    bd = [
        _make_component(price=0.0, total=0.0, code="A"),
        _make_component(price=0.0, total=0.0, code="B"),
    ]
    result = reconcile_breakdown(unit_price=100.0, breakdown=bd)
    assert result.needs_review is True
    assert result.divergence_pct == 1.0


def test_yield_amount_greater_than_one_scales_correctly():
    # sum = 100.0 (yield 2 → total 100, price 50). unit_price = 99.0 → escalar.
    bd = [
        _make_component(price=50.0, total=100.0, yield_amount=2.0, code="A"),
    ]
    result = reconcile_breakdown(unit_price=99.0, breakdown=bd)
    assert result.needs_review is False
    # total escalado a 99.0; price = total/yield = 49.50
    assert abs(result.breakdown[0].total - 99.0) < 0.05
    assert abs(result.breakdown[0].price - 49.50) < 0.05
