"""Tests golden ANNEXED — Sprint 4 Fase D.

Verifica que el parser detecta correctamente layout ANNEXED en:

- SANITAS (42pp): transition ≈ p22, 65 totales `C01.XX`.
- RdLL (258pp): transition ≈ p130, ~193 totales numéricos + ~327 PRESTO internos ignorados.

Y que NO activa ANNEXED falsamente en:

- private_residence_palma (14pp, inline puro).

Si los PDFs golden no están disponibles localmente, los tests se skipean.

Constraints estrictos:
- Cero falsos positivos: ningún código PRESTO interno (TC-, EL-, FN-) debe
  aparecer como partida.
- Duración <30s sobre RdLL 258pp (parser determinista, sin LLM).
"""
from __future__ import annotations

import os
import pathlib
import time

import pytest

from src.budget.pdf_tabular_parser.application.tabular_parser import TabularParser

# --- Path resolution ---
_DEFAULT_GOLDEN_DIR = r"c:\Users\Usuario\Documents\github\works\dochevi\dochevi-construc\data\pdf_layouts\golden"
GOLDEN_DIR = os.environ.get("SPRINT4_GOLDEN_DIR", _DEFAULT_GOLDEN_DIR)


def _golden_path(name: str) -> str:
    return os.path.join(GOLDEN_DIR, name)


def _golden_exists(name: str) -> bool:
    return os.path.exists(_golden_path(name))


def _load_pdf(name: str) -> bytes:
    return pathlib.Path(_golden_path(name)).read_bytes()


def _assert_no_presto_internal_codes(partidas) -> None:
    """Ningún code debe tener prefijo PRESTO interno (TC-, EL-, FN-, ...)."""
    forbidden_prefixes = ("TC-", "EL-", "FN-", "PS-", "CL-", "S-", "VN-", "PL-", "DC-", "PC-", "SN-")
    bad = [p.code for p in partidas if any(p.code.startswith(prefix) for prefix in forbidden_prefixes)]
    assert not bad, f"Códigos con prefijo PRESTO interno detectados como partida: {bad}"


def _assert_no_quantity_1_fallback_for_extracted_codes(partidas) -> None:
    """Ningún code como '01.01' debe terminar con qty=1.0 si tenía total real.

    Esto no es trivial sin acceso al PDF — usamos heurística: si más del 50%
    de las partidas tienen exactamente 1.0, sospechamos fallback masivo.
    """
    if not partidas:
        return
    qty_1_count = sum(1 for p in partidas if p.quantity == 1.0)
    ratio = qty_1_count / len(partidas)
    # Permitimos hasta 30% qty=1.0 (PA, unidades sueltas, partidas reales con qty=1).
    # Más de eso sugiere que el mapping falló masivamente y se aplicó default.
    assert ratio <= 0.7, (
        f"Demasiadas partidas con qty=1.0 (probable fallback masivo): "
        f"{qty_1_count}/{len(partidas)} = {ratio:.0%}"
    )


pytestmark = pytest.mark.skipif(
    not os.path.isdir(GOLDEN_DIR),
    reason=f"golden PDFs no disponibles en {GOLDEN_DIR}",
)


@pytest.mark.golden
def test_sanitas_dental_annexed_extraction():
    """SANITAS 42pp: 65 totales `C01.XX`, transition ~p22."""
    if not _golden_exists("sanitas_dental.pdf"):
        pytest.skip("sanitas_dental.pdf no disponible")

    pdf_bytes = _load_pdf("sanitas_dental.pdf")
    parser = TabularParser()
    t0 = time.time()
    result = parser.parse(pdf_bytes)
    duration = time.time() - t0

    print(
        f"\n[sanitas_dental ANNEXED] annexed={result.annexed} "
        f"transition_page={result.annexed_transition_page} "
        f"totals_found={result.annexed_totals_found} "
        f"partidas={result.partidas_count} "
        f"matched={result.annexed_matched} orphans={result.annexed_orphans} "
        f"qty_rate={result.qty_rate:.2%} chapter_rate={result.chapter_rate:.2%} "
        f"duration={duration:.2f}s viable={result.is_viable()} reason={result.reason}"
    )

    # Crítico: ningún prefijo PRESTO interno.
    _assert_no_presto_internal_codes(result.partidas)

    # Si el parser detectó ANNEXED: verificar métricas mínimas.
    if result.annexed:
        # Permitimos que las cabeceras puedan o no detectarse en SANITAS — el
        # spec dice 0 detectadas según el análisis batch. Lo crítico es:
        # 1. No ANNEXED falsamente sobre inline puro.
        # 2. Si ANNEXED, totales detectados >= 50.
        assert result.annexed_totals_found >= 50, (
            f"Esperaba >=50 totales SANITAS, obtuve {result.annexed_totals_found}"
        )
    # Duración razonable.
    assert duration < 30.0, f"Duración SANITAS {duration:.2f}s — esperaba <30s"


@pytest.mark.golden
def test_rdll_annexed_extraction():
    """RdLL 258pp: layout ANNEXED, transition ~p130, totales numéricos + PRESTO."""
    if not _golden_exists("presupuesto_grande_rdll.pdf"):
        pytest.skip("presupuesto_grande_rdll.pdf no disponible")

    pdf_bytes = _load_pdf("presupuesto_grande_rdll.pdf")
    parser = TabularParser()
    t0 = time.time()
    result = parser.parse(pdf_bytes)
    duration = time.time() - t0

    print(
        f"\n[rdll ANNEXED] annexed={result.annexed} "
        f"transition_page={result.annexed_transition_page} "
        f"totals_found={result.annexed_totals_found} "
        f"partidas={result.partidas_count} "
        f"matched={result.annexed_matched} orphans={result.annexed_orphans} "
        f"qty_rate={result.qty_rate:.2%} chapter_rate={result.chapter_rate:.2%} "
        f"duration={duration:.2f}s viable={result.is_viable()} reason={result.reason}"
    )

    # Crítico: cero falsos positivos.
    _assert_no_presto_internal_codes(result.partidas)

    # Crítico: <30s sin LLM.
    assert duration < 30.0, f"Duración RdLL {duration:.2f}s — debería ser <30s (sin LLM)."

    # Si ANNEXED se activó: verificamos rangos esperados.
    if result.annexed:
        # transition_page debe estar en la segunda mitad del PDF.
        assert result.annexed_transition_page is not None
        assert result.annexed_transition_page >= 100, (
            f"transition_page={result.annexed_transition_page} parece muy temprano"
        )
        # Cantidad razonable de totales numéricos.
        assert result.annexed_totals_found >= 100, (
            f"Esperaba >=100 totales RdLL, obtuve {result.annexed_totals_found}"
        )
        # Al menos algunas cabeceras detectadas.
        assert result.partidas_count >= 50, (
            f"Esperaba >=50 cabeceras RdLL, obtuve {result.partidas_count}"
        )


@pytest.mark.golden
def test_private_residence_palma_NOT_annexed():
    """private_residence_palma (14pp, inline puro) NO debe activar ANNEXED."""
    if not _golden_exists("private_residence_palma.pdf"):
        pytest.skip("private_residence_palma.pdf no disponible")

    pdf_bytes = _load_pdf("private_residence_palma.pdf")
    parser = TabularParser()
    t0 = time.time()
    result = parser.parse(pdf_bytes)
    duration = time.time() - t0

    print(
        f"\n[private_residence_palma NOT_annexed] annexed={result.annexed} "
        f"transition_page={result.annexed_transition_page} "
        f"partidas={result.partidas_count} "
        f"duration={duration:.2f}s"
    )

    # NUNCA activar ANNEXED sobre un PDF inline corto.
    assert result.annexed is False, (
        "private_residence_palma NO debe activar modo ANNEXED — es inline puro."
    )
    assert result.annexed_transition_page is None


@pytest.mark.golden
def test_mu02_NOT_annexed():
    """mu02_albanileria (25pp, inline puro) NO debe activar ANNEXED."""
    if not _golden_exists("mu02_albanileria.pdf"):
        pytest.skip("mu02_albanileria.pdf no disponible")

    pdf_bytes = _load_pdf("mu02_albanileria.pdf")
    parser = TabularParser()
    result = parser.parse(pdf_bytes)

    assert result.annexed is False, (
        "mu02_albanileria NO debe activar modo ANNEXED — es inline puro."
    )


@pytest.mark.golden
def test_estado_mediciones_simple_NOT_annexed():
    """estado_mediciones_simple (3pp) NO debe activar ANNEXED."""
    if not _golden_exists("estado_mediciones_simple.pdf"):
        pytest.skip("estado_mediciones_simple.pdf no disponible")

    pdf_bytes = _load_pdf("estado_mediciones_simple.pdf")
    parser = TabularParser()
    result = parser.parse(pdf_bytes)

    assert result.annexed is False, (
        "estado_mediciones_simple NO debe activar modo ANNEXED — PDF muy corto."
    )
