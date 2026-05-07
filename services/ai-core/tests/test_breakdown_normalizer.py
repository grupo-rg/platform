"""Phase 17.8 — Tests para normalize_breakdown_quantities."""
from __future__ import annotations

from src.budget.application.services.breakdown_normalizer import (
    normalize_breakdown_quantities,
)
from src.budget.domain.entities import BudgetBreakdownComponent


def _make(price: float, total: float, yield_amount: float | None = None, code: str = "X") -> BudgetBreakdownComponent:
    kwargs = {
        "code": code,
        "concept": f"comp {code}",
        "type": "OTHER",
        "price": price,
        "total": total,
    }
    if yield_amount is not None:
        kwargs["yield"] = yield_amount  # alias de yield_amount
    return BudgetBreakdownComponent(**kwargs)


def test_qty_missing_is_derived_from_total_over_price():
    # Caso 01.07 DRT010: total=211.32, price=11.51, yield ausente → debe derivar 18.36.
    b = _make(price=11.51, total=211.32, yield_amount=None, code="DRT010")
    result = normalize_breakdown_quantities([b])
    assert result.fixed_count == 1
    assert "DRT010" in result.suspicious_codes
    assert abs(b.yield_amount - 18.36) < 0.01


def test_qty_coherent_within_tolerance_is_skipped():
    # qty=2, price=10, total=20.05 → implied=2.005 → diff 0.25% < 1% → no se toca.
    b = _make(price=10, total=20.05, yield_amount=2.0, code="OK")
    result = normalize_breakdown_quantities([b])
    assert result.fixed_count == 0
    assert b.yield_amount == 2.0  # sin cambio


def test_qty_diverges_more_than_tolerance_is_fixed():
    # qty=1 declarado, pero total/price=5 → diverge 400% → fix.
    b = _make(price=10, total=50, yield_amount=1.0, code="BAD")
    result = normalize_breakdown_quantities([b])
    assert result.fixed_count == 1
    assert b.yield_amount == 5.0


def test_zero_price_or_total_skipped():
    b1 = _make(price=0, total=10, code="ZP")
    b2 = _make(price=10, total=0, code="ZT")
    result = normalize_breakdown_quantities([b1, b2])
    assert result.fixed_count == 0
    assert result.skipped_count == 2


def test_idempotent_after_first_normalization():
    b = _make(price=11.51, total=211.32, yield_amount=None, code="X")
    result1 = normalize_breakdown_quantities([b])
    assert result1.fixed_count == 1
    # Re-correr con el mismo objeto: yield ya está en 18.36, total/price = 18.36 → no-op.
    result2 = normalize_breakdown_quantities([b])
    assert result2.fixed_count == 0
    assert b.yield_amount > 18.0  # se mantiene


def test_multiple_components_partial_fix():
    components = [
        _make(price=10, total=10, yield_amount=1.0, code="OK"),         # ya cuadra
        _make(price=20, total=200, yield_amount=None, code="DERIVE"),   # falta yield
        _make(price=5, total=15, yield_amount=2.0, code="FIX"),         # diverge (debería ser 3)
    ]
    result = normalize_breakdown_quantities(components)
    assert result.fixed_count == 2
    assert "OK" not in result.suspicious_codes
    assert "DERIVE" in result.suspicious_codes
    assert "FIX" in result.suspicious_codes
