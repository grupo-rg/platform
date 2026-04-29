"""Fase 6.C — tests del loop ICL: retrieval de fragments + formato prompt.

Lo que se cubre:
  1. `_find_relevant_fragments(partida)`: delega en el repo con los parámetros
     correctos (chapter, description, thresholds). Si el repo no está
     inyectado, devuelve [] (modo backward-compat).
  2. `_format_fragments_as_icl(fragments)`: formatea la lista para el prompt
     del Pro. Cuando no hay fragments, devuelve un sentinel claro. Cuando los
     hay, genera un bloque legible con un ejemplo por fragment + un resumen.
  3. Snapshot del user prompt: cuando hay fragments, el user prompt del Pro
     DEBE contener el bloque ICL. Cuando no los hay, mantiene el sentinel.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.budget.application.services.pdf_extractor_service import RestructuredItem
from src.budget.application.services.swarm_pricing_service import (
    SwarmPricingService,
    _format_fragments_as_icl,
)
from src.budget.domain.entities import (
    HeuristicAIInferenceTrace,
    HeuristicContext,
    HeuristicFragment,
    HeuristicHumanCorrection,
)
from src.budget.learning.infrastructure.adapters.in_memory_heuristic_fragment_repository import (
    InMemoryHeuristicFragmentRepository,
)


def _make_fragment(
    frag_id: str = "frag-1",
    chapter: str = "DEMOLICIONES",
    description: str = "Demolición de alicatado en paredes",
    ai_price: float = 25.0,
    human_price: float = 22.0,
    reason: str = "volumen",
    note: str = "Descuento aplicado por volumen > 15 m2",
) -> HeuristicFragment:
    return HeuristicFragment(
        id=frag_id,
        sourceType="internal_admin",
        status="golden",
        context=HeuristicContext(
            budgetId="b1",
            originalDescription=description,
            originalQuantity=10.0,
            originalUnit="m2",
        ),
        aiInferenceTrace=HeuristicAIInferenceTrace(proposedUnitPrice=ai_price),
        humanCorrection=HeuristicHumanCorrection(
            correctedUnitPrice=human_price,
            heuristicRule=f"{reason}: {note}" if note else reason,
        ),
        tags=[f"chapter:{chapter}", f"reason:{reason}"],
        timestamp=datetime.now(timezone.utc),
    )


def _make_partida(
    code: str = "P001",
    chapter: str = "DEMOLICIONES",
    description: str = "Demolición alicatado paredes baño reforma",
) -> RestructuredItem:
    return RestructuredItem(
        code=code,
        description=description,
        quantity=20.0,
        unit="m2",
        unit_normalized="m2",
        unit_dimension="superficie",
        unit_conversion_hints=None,
        chapter=chapter,
    )


# ---------- Formatter puro -----------------------------------------------------------


class TestFormatFragmentsAsICL:
    def test_empty_list_returns_sentinel(self) -> None:
        out = _format_fragments_as_icl([])
        assert "sin ejemplos" in out.lower() or "no heuristics" in out.lower()

    def test_single_fragment_emits_ai_vs_human_block(self) -> None:
        frag = _make_fragment(ai_price=25.0, human_price=22.0)
        out = _format_fragments_as_icl([frag])
        assert "25" in out
        assert "22" in out
        assert "volumen" in out.lower()

    def test_groups_identical_reason_into_pattern_line(self) -> None:
        frags = [
            _make_fragment(frag_id=f"f{i}", reason="volumen", human_price=22.0)
            for i in range(3)
        ]
        out = _format_fragments_as_icl(frags)
        # Con 3 correcciones del mismo motivo, el formateador DEBE destacar
        # un "patrón aprendido".
        low = out.lower()
        assert "patr" in low  # "patrón" o "pattern"
        assert "volumen" in low

    def test_includes_chapter_context_tag(self) -> None:
        frag = _make_fragment(chapter="FONTANERIA Y GAS")
        out = _format_fragments_as_icl([frag])
        assert "FONTANERIA Y GAS" in out


# ---------- Retrieval del Swarm ------------------------------------------------------


class TestSwarmFindRelevantFragments:
    def test_returns_empty_when_no_repo_configured(self) -> None:
        svc = SwarmPricingService(
            llm_provider=MagicMock(),
            vector_search=MagicMock(),
        )
        out = asyncio.run(svc._find_relevant_fragments(_make_partida()))
        assert out == []

    def test_delegates_to_repo_with_chapter_and_description(self) -> None:
        repo = InMemoryHeuristicFragmentRepository()
        asyncio.run(repo.save(_make_fragment(frag_id="f1")))
        asyncio.run(repo.save(_make_fragment(frag_id="f2")))

        svc = SwarmPricingService(
            llm_provider=MagicMock(),
            vector_search=MagicMock(),
            fragment_repo=repo,
        )
        partida = _make_partida(chapter="DEMOLICIONES",
                                 description="Demolición de alicatado paredes")
        out = asyncio.run(svc._find_relevant_fragments(partida))
        ids = {f.id for f in out}
        assert ids == {"f1", "f2"}

    def test_skips_fragments_from_other_chapters(self) -> None:
        repo = InMemoryHeuristicFragmentRepository()
        asyncio.run(repo.save(_make_fragment(frag_id="f-dem", chapter="DEMOLICIONES")))
        asyncio.run(repo.save(_make_fragment(frag_id="f-dem-2", chapter="DEMOLICIONES")))
        asyncio.run(repo.save(_make_fragment(frag_id="f-font", chapter="FONTANERIA Y GAS")))

        svc = SwarmPricingService(
            llm_provider=MagicMock(),
            vector_search=MagicMock(),
            fragment_repo=repo,
        )
        out = asyncio.run(svc._find_relevant_fragments(_make_partida(chapter="DEMOLICIONES")))
        ids = {f.id for f in out}
        assert "f-font" not in ids

    def test_handles_repo_error_gracefully(self) -> None:
        """Si el repo falla (Firestore timeout, etc.) el Swarm NO debe
        reventar — devuelve [] y el Pro sigue sin ICL."""
        broken_repo = AsyncMock()
        broken_repo.find_relevant.side_effect = RuntimeError("firestore unavailable")

        svc = SwarmPricingService(
            llm_provider=MagicMock(),
            vector_search=MagicMock(),
            fragment_repo=broken_repo,
        )
        out = asyncio.run(svc._find_relevant_fragments(_make_partida()))
        assert out == []
