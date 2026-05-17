"""Unit tests for BudgetPipelineRunner.

The runner is the thin adapter that bridges `IPipelineRunner` (used by
RunPipelineJobUseCase) to the existing `RestructureBudgetUseCase` and
`GenerateBudgetFromNlUseCase`. In this first pass (P4.a) it does NOT yet
honour `resolved_partida_codes` or call `on_partida_resolved` — that
arrives in P4.b together with the SwarmPricingService refactor. What we
verify here is the routing + result mapping, which is what unblocks the
worker for end-to-end deployment.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.pipeline_jobs.application.ports.pipeline_runner import (
    PipelineRunResult,
)
from src.pipeline_jobs.domain.entities import JobType
from src.pipeline_jobs.infrastructure.budget_pipeline_runner import (
    BudgetPipelineRunner,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _fake_budget(*, budget_id="budget-1", num_partidas=3, total=300.0):
    """Build a Budget-shaped object (duck typed — the runner only reads
    .id, .chapters[*].items, .totalEstimated)."""
    items_per_chapter = max(1, num_partidas)
    chapter = SimpleNamespace(items=[object()] * items_per_chapter)
    return SimpleNamespace(
        id=budget_id, chapters=[chapter], totalEstimated=total
    )


@pytest.fixture
def restructure_uc():
    uc = MagicMock()
    uc.execute = AsyncMock(
        return_value=_fake_budget(num_partidas=5, total=500.0)
    )
    return uc


@pytest.fixture
def nl_uc():
    uc = MagicMock()
    uc.execute = AsyncMock(
        return_value=_fake_budget(num_partidas=4, total=400.0)
    )
    return uc


@pytest.fixture
def fake_pdf_to_chunks():
    """Stub that converts pdf_bytes → predictable image-chunk list without
    invoking PyMuPDF. Lets us test pure routing without PDF parsing."""
    return lambda pdf_bytes: [
        {"image_base64": "BASE64A", "page_number": 0, "is_summatory": False},
        {"image_base64": "BASE64B", "page_number": 1, "is_summatory": True},
    ]


@pytest.fixture
def runner(restructure_uc, nl_uc, fake_pdf_to_chunks):
    return BudgetPipelineRunner(
        restructure_uc=restructure_uc,
        nl_uc=nl_uc,
        pdf_to_chunks=fake_pdf_to_chunks,
    )


async def _run(
    runner,
    *,
    job_type,
    payload,
    pdf_bytes=None,
    resume_partidas=None,
    cancel=None,
) -> PipelineRunResult:
    on_partida = AsyncMock()
    return await runner.run(
        job_type=job_type,
        payload=payload,
        budget_id="budget-1",
        lead_id="lead-1",
        pdf_bytes=pdf_bytes,
        resume_partidas=resume_partidas or [],
        on_partida_resolved=on_partida,
        cancellation_event=cancel or asyncio.Event(),
    )


# ---------------------------------------------------------------------------
# Routing per jobType
# ---------------------------------------------------------------------------


class TestRouting:
    async def test_measurements_calls_restructure_uc_with_inline_strategy(
        self, runner, restructure_uc
    ):
        result = await _run(
            runner,
            job_type=JobType.MEASUREMENTS,
            payload={"strategy": "INLINE", "gcsUri": "gs://b/x.pdf"},
            pdf_bytes=b"%PDF-fake",
        )
        restructure_uc.execute.assert_awaited_once()
        kwargs = restructure_uc.execute.call_args.kwargs
        assert kwargs["lead_id"] == "lead-1"
        assert kwargs["budget_id"] == "budget-1"
        assert kwargs["strategy"] == "INLINE"
        # raw_items came from our stub pdf_to_chunks.
        assert len(kwargs["raw_items"]) == 2
        assert kwargs["raw_items"][0]["image_base64"] == "BASE64A"
        # pdf_bytes still passed through for the fast-path heuristic.
        assert kwargs["pdf_bytes"] == b"%PDF-fake"
        # Result derives from the returned Budget.
        assert isinstance(result, PipelineRunResult)
        assert result.budgetId == "budget-1"
        assert result.partidasResolved == 5
        assert result.totalEstimated == 500.0

    async def test_measurements_defaults_to_inline_when_no_strategy(
        self, runner, restructure_uc
    ):
        await _run(
            runner,
            job_type=JobType.MEASUREMENTS,
            payload={"gcsUri": "gs://b/x.pdf"},
            pdf_bytes=b"%PDF-fake",
        )
        kwargs = restructure_uc.execute.call_args.kwargs
        assert kwargs["strategy"] == "INLINE"

    async def test_vision_extract_uses_annexed_strategy(
        self, runner, restructure_uc
    ):
        await _run(
            runner,
            job_type=JobType.VISION_EXTRACT,
            payload={"strategy": "ANNEXED", "pdf_url": "https://x"},
            pdf_bytes=b"%PDF-fake",
        )
        kwargs = restructure_uc.execute.call_args.kwargs
        assert kwargs["strategy"] == "ANNEXED"

    async def test_nl_budget_calls_nl_uc_with_narrative(
        self, runner, nl_uc, restructure_uc
    ):
        result = await _run(
            runner,
            job_type=JobType.NL_BUDGET,
            payload={"narrative": "Casa de 100m2"},
            pdf_bytes=None,
        )
        nl_uc.execute.assert_awaited_once()
        kwargs = nl_uc.execute.call_args.kwargs
        assert kwargs["narrative"] == "Casa de 100m2"
        assert kwargs["budget_id"] == "budget-1"
        assert kwargs["lead_id"] == "lead-1"
        # The PDF use case must NOT be invoked.
        restructure_uc.execute.assert_not_awaited()
        assert result.budgetId == "budget-1"
        assert result.partidasResolved == 4
        assert result.totalEstimated == 400.0


# ---------------------------------------------------------------------------
# Failure paths
# ---------------------------------------------------------------------------


class TestFailure:
    async def test_measurements_without_pdf_bytes_raises(self, runner):
        with pytest.raises(ValueError, match="pdf_bytes is required"):
            await _run(
                runner,
                job_type=JobType.MEASUREMENTS,
                payload={"strategy": "INLINE"},
                pdf_bytes=None,
            )

    async def test_nl_budget_without_narrative_raises(self, runner):
        with pytest.raises(ValueError, match="narrative"):
            await _run(
                runner,
                job_type=JobType.NL_BUDGET,
                payload={},
            )

    async def test_underlying_uc_exception_propagates(
        self, runner, restructure_uc
    ):
        restructure_uc.execute.side_effect = RuntimeError("OOM at chunk 42")
        with pytest.raises(RuntimeError, match="OOM at chunk 42"):
            await _run(
                runner,
                job_type=JobType.MEASUREMENTS,
                payload={"strategy": "INLINE"},
                pdf_bytes=b"%PDF",
            )


# ---------------------------------------------------------------------------
# Cancellation cooperation
# ---------------------------------------------------------------------------


class TestCancellation:
    async def test_already_canceled_before_call_raises_immediately(
        self, runner, restructure_uc
    ):
        cancel = asyncio.Event()
        cancel.set()
        with pytest.raises(asyncio.CancelledError):
            await _run(
                runner,
                job_type=JobType.MEASUREMENTS,
                payload={},
                pdf_bytes=b"%PDF",
                cancel=cancel,
            )
        # We never invoked the underlying UC.
        restructure_uc.execute.assert_not_awaited()


# ---------------------------------------------------------------------------
# Resume-from contract (P4.a stub: no-op; P4.b: real checkpointing)
# ---------------------------------------------------------------------------


class TestResumeFromIsForwardedAsBudgetPartidas:
    """P4.b: the runner reconstructs full BudgetPartida objects from the
    serialised checkpoint dicts and forwards them to RestructureBudgetUseCase
    as `resume_from`. The swarm then both filters items by these codes AND
    concatenates them into the final partida list, so the assembled Budget
    reflects everything resolved across all attempts."""

    async def test_forwards_resume_from_to_restructure_uc(
        self, runner, restructure_uc
    ):
        partida_dict = {
            "type": "PARTIDA",
            "id": "stub-1",
            "order": 1,
            "code": "P001",
            "description": "Demolición tabique",
            "unit": "m2",
            "quantity": 10.0,
            "unitPrice": 5.5,
            "totalPrice": 55.0,
        }
        await _run(
            runner,
            job_type=JobType.MEASUREMENTS,
            payload={"strategy": "INLINE"},
            pdf_bytes=b"%PDF",
            resume_partidas=[partida_dict],
        )
        restructure_uc.execute.assert_awaited_once()
        kwargs = restructure_uc.execute.call_args.kwargs
        assert "resume_from" in kwargs
        assert len(kwargs["resume_from"]) == 1
        # The dict was rehydrated into a BudgetPartida instance.
        assert kwargs["resume_from"][0].code == "P001"
        assert kwargs["resume_from"][0].totalPrice == 55.0
        # And the on_partida_resolved callback is wired.
        assert kwargs["on_partida_resolved"] is not None
        restructure_uc.execute.assert_awaited_once()
