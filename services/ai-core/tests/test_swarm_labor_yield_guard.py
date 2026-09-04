"""P3 — Guard CONSERVADOR de rendimiento (yield) de MANO DE OBRA (matches 1:1/1:N).

El descompuesto de un match de catálogo puede traer un yield de M.O. absurdo
(caso real: 10,3 h de Oficial 1ª cristalero para colocar UNA mampara → 493 € de
M.O. sobre 1025 € de PEM) que infla el precio. Los guards de precio (WS-3,
regla 16, anomalía 100K) no miran el yield ya baked en el breakdown.

El guard marca `needs_human_review` + emite `labor_yield_warning` SOLO cuando se
cumplen DOS señales ORTOGONALES (AND):
  (1) horas de M.O. por unidad de partida > techo generoso de su familia de
      unidad (8 h/ud discreta, 4 h/u continua; tanto alzado excluido), y
  (2) la M.O. supera el 40% del PEM.

Estos tests cubren las funciones puras que encapsulan el criterio, verificando
que la anomalía real dispara y que las partidas legítimamente intensivas en M.O.
(alicatado) o dominadas por material (aparato caro) NO son falsos positivos.
"""

from __future__ import annotations

from src.budget.application.services.swarm_pricing_service import (
    _LABOR_YIELD_SHARE_MIN,
    _analyze_labor_yield,
    _labor_hours_ceiling_for_unit,
    _normalize_unit_token,
)
from src.budget.domain.entities import BudgetBreakdownComponent


def _comp(code, type_, price, yield_amount, total, is_variable=None):
    return BudgetBreakdownComponent(
        code=code,
        concept=code or type_,
        type=type_,
        price=price,
        **{"yield": yield_amount},
        total=total,
        is_variable=is_variable,
    )


def _fires(breakdown, unit, pem):
    """Reproduce el criterio AND del guard sobre las funciones puras."""
    ly = _analyze_labor_yield(breakdown, pem)
    if ly is None:
        return False
    ceiling = _labor_hours_ceiling_for_unit(_normalize_unit_token(unit))
    return (
        ceiling is not None
        and ly["labor_hours"] > ceiling
        and ly["labor_share"] > _LABOR_YIELD_SHARE_MIN
    )


# -------- Detección de la anomalía real ------------------------------------------------


def test_mampara_outlier_fires_guard():
    """Caso real: mampara (ud) con 10,3 h de M.O. ≈ 48% del PEM → marca."""
    breakdown = [
        # M.O. absurda: 10,3 h de Oficial cristalero a 47,86 €/h ≈ 493 €.
        _comp("mo011", "OTHER", 47.86, 10.3, 492.96),
        # Material (la mampara) — el resto del PEM.
        _comp("mt055", "OTHER", 532.04, 1.0, 532.04, is_variable=True),
    ]
    pem = 1025.0
    ly = _analyze_labor_yield(breakdown, pem)
    assert ly is not None
    assert ly["labor_hours"] == 10.3
    assert ly["labor_share"] > _LABOR_YIELD_SHARE_MIN  # ≈ 0.48
    assert _labor_hours_ceiling_for_unit(_normalize_unit_token("ud")) == 8.0
    assert _fires(breakdown, "ud", pem) is True


def test_labor_detected_by_code_prefix_even_when_type_is_other():
    """En el path heredado 1:1 el `type` llega como 'OTHER'; la M.O. se detecta
    por el prefijo de código (`mo*`/`labor-*`), no por el type."""
    breakdown = [_comp("labor-oficial-1a", "OTHER", 20.0, 9.0, 180.0)]
    ly = _analyze_labor_yield(breakdown, 300.0)
    assert ly is not None
    assert ly["n_labor"] == 1
    assert ly["labor_hours"] == 9.0


# -------- No falsos positivos ----------------------------------------------------------


def test_alicatado_high_labor_share_but_low_hours_does_not_fire():
    """Alicatado (m²): M.O. es mayoría del PEM pero ~1 h/m² < techo 4 h → NO marca.
    Protegido por la señal (1)."""
    breakdown = [
        _comp("mo004", "OTHER", 22.0, 1.0, 22.0),   # 1 h/m² de oficial
        _comp("mt018", "OTHER", 8.0, 1.05, 8.4, is_variable=True),  # azulejo
    ]
    pem = 30.4
    ly = _analyze_labor_yield(breakdown, pem)
    assert ly["labor_share"] > 0.5  # M.O. domina el PEM…
    assert ly["labor_hours"] == 1.0  # …pero las horas/m² son bajas
    assert _fires(breakdown, "m2", pem) is False


def test_material_dominated_install_with_many_hours_does_not_fire():
    """Instalación cara dominada por material (p.ej. caldera, ud): aunque tenga
    12 h de M.O. (> techo 8 h/ud), la M.O. es minoría del PEM → NO marca.
    Protegido por la señal (2)."""
    breakdown = [
        _comp("mo002", "OTHER", 40.0, 12.0, 480.0),               # 12 h de M.O.
        _comp("mt900", "OTHER", 3120.0, 1.0, 3120.0, is_variable=True),  # caldera
    ]
    pem = 3600.0
    ly = _analyze_labor_yield(breakdown, pem)
    assert ly["labor_hours"] == 12.0  # cruza el techo de horas…
    assert ly["labor_share"] < _LABOR_YIELD_SHARE_MIN  # …pero M.O. ≈ 13% del PEM
    assert _fires(breakdown, "ud", pem) is False


def test_lumpsum_unit_is_excluded():
    """Partida a tanto alzado (PA): la M.O. no es 'por unidad' → guard NO aplica."""
    assert _labor_hours_ceiling_for_unit(_normalize_unit_token("PA")) is None
    breakdown = [_comp("mo002", "OTHER", 40.0, 30.0, 1200.0)]
    assert _fires(breakdown, "PA", 1500.0) is False


def test_no_labor_components_returns_none():
    """Sin componentes de M.O. no hay nada que evaluar."""
    breakdown = [_comp("mt001", "OTHER", 10.0, 2.0, 20.0, is_variable=True)]
    assert _analyze_labor_yield(breakdown, 20.0) is None


def test_zero_or_missing_pem_returns_none():
    breakdown = [_comp("mo002", "OTHER", 40.0, 10.0, 400.0)]
    assert _analyze_labor_yield(breakdown, 0.0) is None
    assert _analyze_labor_yield([], 100.0) is None
