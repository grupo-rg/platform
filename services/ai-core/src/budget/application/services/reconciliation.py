"""
Phase 17 — Reconciliación de descompuesto contra unit_price.

Cuando el LLM devuelve `calculated_unit_price` y `breakdown[]` como dos campos
independientes, no garantiza que `sum(breakdown.total) == unit_price`. Esta
función corrige automáticamente desviaciones pequeñas (ruido del LLM,
rounding) y flagea desviaciones grandes para revisión humana en el editor.

Decisión arquitectónica (D1, opción 1A):
- Confiar en `unit_price` (el Judge ya lo validó contra fragmentos históricos).
- Escalar componentes proporcionalmente para que sumen el unit_price.
- Threshold auto-fix: 2%. Por encima se persiste sin tocar + flag.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List

from src.budget.domain.entities import BudgetBreakdownComponent


@dataclass
class ReconcileResult:
    breakdown: List[BudgetBreakdownComponent]
    needs_review: bool
    divergence_pct: float
    divergence_amount: float


def reconcile_breakdown(
    unit_price: float,
    breakdown: List[BudgetBreakdownComponent],
    tolerance: float = 0.02,
) -> ReconcileResult:
    """Reconcilia el breakdown contra el unit_price autoritativo.

    - Si breakdown está vacío o unit_price es 0: no-op, no flag.
    - Si sum(breakdown.total) == 0: flag (LLM devolvió componentes vacíos).
    - Si divergencia < tolerance: escala silenciosamente (auto-fix).
    - Si divergencia >= tolerance: no escala, persiste raw + flag para review.
    """
    if not breakdown or unit_price <= 0:
        return ReconcileResult(breakdown, False, 0.0, 0.0)

    sum_breakdown = sum((b.total or 0.0) for b in breakdown)
    if sum_breakdown == 0:
        return ReconcileResult(breakdown, True, 1.0, -unit_price)

    divergence_pct = abs(unit_price - sum_breakdown) / unit_price

    if divergence_pct < tolerance:
        scale = unit_price / sum_breakdown
        for b in breakdown:
            b.total = round((b.total or 0.0) * scale, 2)
            if b.yield_amount and b.yield_amount > 0:
                b.price = round(b.total / b.yield_amount, 2)
            else:
                b.price = round((b.price or 0.0) * scale, 2)
        return ReconcileResult(breakdown, False, divergence_pct, 0.0)

    return ReconcileResult(
        breakdown,
        True,
        divergence_pct,
        sum_breakdown - unit_price,
    )
