"""Phase 17.8 — Garantiza invariante quantity × price ≈ total en breakdown.

Si el LLM devuelve un componente con `total` pero sin `yield` (o con `yield`
incoherente con `total/price`), se deriva `yield = total / price`. Esto cubre
el caso de dimensionamiento oculto + factor ICL embedded en `total`:

  Caso 01.07 budget 50280d27:
    DRT010 → price=11.51 €/m², total=211.32 € (= 9 m² × 2.04 ICL × 11.51)
    Sin normalización: yield=1, total/price=18.36 → suma frontend = 11.51 ≠ 211.32.
    Tras normalización: yield=18.36 → display total = 211.32 ✓

Threshold de tolerancia: 1% para detectar inconsistencias reales sin falsos
positivos por rounding (caso típico: yield=1.000 vs implied=1.003).

Idempotente: re-correr sobre breakdown ya normalizado es no-op.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class NormalizationResult:
    fixed_count: int = 0
    skipped_count: int = 0
    suspicious_codes: list[str] = field(default_factory=list)


def _get_yield(b: Any) -> float:
    """Lee yield_amount del componente (BudgetBreakdownComponent o dict-like)."""
    if hasattr(b, 'yield_amount'):
        v = getattr(b, 'yield_amount', None)
        if v is not None:
            return float(v)
    # fallback genérico para dicts o LLM raw schemas con 'yield' o 'yield_val'
    for key in ('yield_amount', 'yield_val', 'yield', 'quantity'):
        if isinstance(b, dict) and key in b and b[key] is not None:
            try:
                return float(b[key])
            except (TypeError, ValueError):
                continue
        if hasattr(b, key) and getattr(b, key, None) is not None:
            try:
                return float(getattr(b, key))
            except (TypeError, ValueError):
                continue
    return 0.0


def _set_yield(b: Any, value: float) -> None:
    """Asigna yield_amount al componente. Solo el campo canonical."""
    if hasattr(b, 'yield_amount'):
        b.yield_amount = value
    elif isinstance(b, dict):
        b['yield_amount'] = value
    else:
        setattr(b, 'yield_amount', value)


def normalize_breakdown_quantities(
    breakdown_components: list,
    tolerance: float = 0.01,
) -> NormalizationResult:
    """Normaliza yield_amount para que cumpla quantity × price ≈ total.

    Args:
        breakdown_components: lista de BudgetBreakdownComponent (o dicts).
        tolerance: 0.01 = 1%. Si la divergencia entre yield declarado y
            yield implícito es mayor, se reescribe.

    Returns:
        NormalizationResult con conteo de fixed/skipped y códigos sospechosos.
    """
    result = NormalizationResult()

    for b in breakdown_components:
        # Acceso defensivo: el componente puede ser BudgetBreakdownComponent o un dict del LLM.
        price = float(getattr(b, 'price', 0) if not isinstance(b, dict) else b.get('price', 0) or 0)
        total = float(getattr(b, 'total', 0) if not isinstance(b, dict) else b.get('total', 0) or 0)
        code = getattr(b, 'code', None) if not isinstance(b, dict) else b.get('code')

        if price <= 0 or total <= 0:
            result.skipped_count += 1
            continue

        qty_decl = _get_yield(b)
        qty_implied = total / price

        # Si yield_decl es 0/None/missing → derivar.
        # Si yield_decl declarado pero diverge > tolerance del implícito → derivar.
        needs_fix = (
            qty_decl <= 0
            or abs(qty_implied - qty_decl) / max(qty_implied, 1e-9) > tolerance
        )

        if needs_fix:
            _set_yield(b, round(qty_implied, 4))
            result.suspicious_codes.append(code or '?')
            result.fixed_count += 1

    return result
