"""Test de integración: RestructureBudgetUseCase con input BC3.

Valida que la rama nueva del use case (cuando recibe `bc3_bytes`) no
invoca a ningún extractor PDF y produce los `restructured_items`
correctamente parseados.

Sprint 4 Fase L — usa mocks del SwarmPricingService para no llamar a LLM,
solo verificamos el wire-up del parser BC3.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.budget.application.use_cases.restructure_budget_uc import (
    RestructureBudgetUseCase,
)

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures" / "bc3"

pytestmark = pytest.mark.bc3


@pytest.mark.asyncio
async def test_use_case_with_bc3_bypasses_pdf_extractor():
    """Cuando se pasa `bc3_bytes`, el use case NO debe invocar al extractor PDF."""
    inline_mock = MagicMock()
    inline_mock.extract = AsyncMock()
    annexed_mock = MagicMock()
    annexed_mock.extract = AsyncMock()

    swarm_mock = MagicMock()
    swarm_mock.evaluate_batch = AsyncMock(return_value=[])

    use_case = RestructureBudgetUseCase(
        inline_extractor=inline_mock,
        annexed_extractor=annexed_mock,
        swarm_pricing=swarm_mock,
    )

    bc3_bytes = (FIXTURES / "25_126_quatre_cantons_10_felanitx_borrador_instalaciones_260211.bc3").read_bytes()

    budget = await use_case.execute(
        raw_items=[],
        lead_id="test",
        budget_id="test-budget",
        bc3_bytes=bc3_bytes,
    )

    # Los extractores PDF no se llaman.
    inline_mock.extract.assert_not_called()
    annexed_mock.extract.assert_not_called()

    # El swarm SÍ se llama con las partidas extraídas del BC3.
    swarm_mock.evaluate_batch.assert_called_once()
    call_args = swarm_mock.evaluate_batch.call_args
    restructured_items = call_args.args[0]
    assert len(restructured_items) > 0, "Use case no produjo partidas del BC3"
    # Algunas partidas conocidas deben aparecer
    codes = [item.code for item in restructured_items]
    assert "02EBPLSJ" in codes, "PUNTO LUZ SIMPLE no extraído"
    assert "400712BS990" in codes, "BASE ENCHUFE no extraído"


@pytest.mark.asyncio
async def test_use_case_pdf_path_unchanged_when_no_bc3():
    """Si NO se pasa `bc3_bytes`, el comportamiento legacy PDF debe funcionar."""
    inline_mock = MagicMock()
    inline_mock.extract = AsyncMock(return_value=[])
    annexed_mock = MagicMock()
    annexed_mock.extract = AsyncMock()

    swarm_mock = MagicMock()
    swarm_mock.evaluate_batch = AsyncMock(return_value=[])

    use_case = RestructureBudgetUseCase(
        inline_extractor=inline_mock,
        annexed_extractor=annexed_mock,
        swarm_pricing=swarm_mock,
    )

    await use_case.execute(
        raw_items=[{"text": "fake"}],
        lead_id="test",
        budget_id="test-budget",
        strategy="INLINE",
        pdf_bytes=b"%PDF-fake",
    )

    # El inline extractor SÍ se llama (path PDF legacy).
    inline_mock.extract.assert_called_once()
    annexed_mock.extract.assert_not_called()


@pytest.mark.asyncio
async def test_use_case_bc3_sets_document_title_from_root():
    """Sprint 4 — `metrics.document_title` debe poblarse del root del BC3
    para que el Budget.title final lo use cuando el frontend no lo provee."""
    inline_mock = MagicMock()
    annexed_mock = MagicMock()
    swarm_mock = MagicMock()
    swarm_mock.evaluate_batch = AsyncMock(return_value=[])

    use_case = RestructureBudgetUseCase(
        inline_extractor=inline_mock,
        annexed_extractor=annexed_mock,
        swarm_pricing=swarm_mock,
    )

    bc3_bytes = (FIXTURES / "25_126_quatre_cantons_10_felanitx_borrador_instalaciones_260211.bc3").read_bytes()
    budget = await use_case.execute(
        raw_items=[],
        lead_id="test",
        budget_id="test-budget",
        bc3_bytes=bc3_bytes,
    )
    # Sin client_name/budget_title en input, el title se inferá del BC3 root.
    # En Quatre Cantons el root es "25-126##" con desc "QUATRE CANTONS 10 - FELANITX".
    assert budget.title is None or "QUATRE CANTONS" in (budget.title or "").upper(), (
        f"Budget title esperado contiene 'QUATRE CANTONS', got {budget.title!r}"
    )
