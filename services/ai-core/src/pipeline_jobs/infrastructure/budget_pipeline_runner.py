"""Adapter that bridges `IPipelineRunner` to the existing budget use cases.

P4.a (this PR): thin wrapper. Routes to `RestructureBudgetUseCase` for
PDF-based jobs and `GenerateBudgetFromNlUseCase` for NL jobs. Does NOT
honour `resolved_partida_codes` or call `on_partida_resolved` yet — those
hooks land in P4.b together with the SwarmPricingService refactor.

The signature still accepts them so the worker (`RunPipelineJobUseCase`)
can be deployed today without API churn. When P4.b ships, the same call
sites start emitting checkpoints with zero code changes upstream.
"""

from __future__ import annotations

import asyncio
import base64
import logging
from typing import Any, Awaitable, Callable, Optional

from src.budget.application.use_cases.generate_budget_from_nl_uc import (
    GenerateBudgetFromNlUseCase,
)
from src.budget.application.use_cases.restructure_budget_uc import (
    RestructureBudgetUseCase,
)
from src.pipeline_jobs.application.ports.pipeline_runner import (
    IPipelineRunner,
    OnPartidaResolved,
    PipelineRunResult,
)
from src.pipeline_jobs.domain.entities import JobType

logger = logging.getLogger(__name__)


# A PDF-bytes-to-image-chunks function. We accept it as a constructor seam
# so tests don't need a real PDF — they pass a stub.
PdfToChunksFn = Callable[[bytes], list[dict[str, Any]]]


# Resolution used by the existing pipeline. 150 DPI hits the sweet spot for
# Gemini Vision in the legacy code; we keep parity.
_DEFAULT_DPI = 150


def _pdf_bytes_to_image_chunks(pdf_bytes: bytes) -> list[dict[str, Any]]:
    """Lifted verbatim from the legacy `download_and_convert_pdf` / the
    `/api/v1/jobs/measurements` endpoint. Identical shape so the existing
    extractors work without modification.

    is_summatory heuristic: the second half of the PDF is treated as
    summary pages (BC3/Presto totals). The extractor uses this to pick
    different prompts. Preserved exactly for parity with production.
    """
    import fitz  # lazy import — pymupdf install isn't required for unit tests

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        total_pages = doc.page_count
        chunks: list[dict[str, Any]] = []
        zoom = _DEFAULT_DPI / 72
        matrix = fitz.Matrix(zoom, zoom)
        for p in range(total_pages):
            page = doc.load_page(p)
            pix = page.get_pixmap(matrix=matrix)
            img_bytes = pix.tobytes("png")
            b64 = base64.b64encode(img_bytes).decode("utf-8")
            chunks.append(
                {
                    "image_base64": b64,
                    "page_number": p,
                    "is_summatory": p >= (total_pages / 2),
                }
            )
        return chunks
    finally:
        doc.close()


class BudgetPipelineRunner(IPipelineRunner):
    def __init__(
        self,
        *,
        restructure_uc: RestructureBudgetUseCase,
        nl_uc: GenerateBudgetFromNlUseCase,
        pdf_to_chunks: Optional[PdfToChunksFn] = None,
    ) -> None:
        self._restructure_uc = restructure_uc
        self._nl_uc = nl_uc
        self._pdf_to_chunks = pdf_to_chunks or _pdf_bytes_to_image_chunks

    async def run(
        self,
        *,
        job_type: JobType,
        payload: dict[str, Any],
        budget_id: str,
        lead_id: str,
        pdf_bytes: Optional[bytes],
        resume_partidas: list[dict[str, Any]],
        on_partida_resolved: OnPartidaResolved,
        cancellation_event: asyncio.Event,
    ) -> PipelineRunResult:
        # Cooperative cancellation check before any expensive work. The use
        # case poller might already have set the event by the time we get here.
        if cancellation_event.is_set():
            raise asyncio.CancelledError(
                "BudgetPipelineRunner: canceled before start"
            )

        if job_type in (JobType.MEASUREMENTS, JobType.VISION_EXTRACT):
            budget = await self._run_pdf_pipeline(
                job_type=job_type,
                payload=payload,
                budget_id=budget_id,
                lead_id=lead_id,
                pdf_bytes=pdf_bytes,
                resume_partidas=resume_partidas,
                on_partida_resolved=on_partida_resolved,
                cancellation_event=cancellation_event,
            )
        elif job_type is JobType.NL_BUDGET:
            budget = await self._run_nl_pipeline(
                payload=payload,
                budget_id=budget_id,
                lead_id=lead_id,
                resume_partidas=resume_partidas,
                on_partida_resolved=on_partida_resolved,
                cancellation_event=cancellation_event,
            )
        else:  # pragma: no cover — defensive; the enum is closed
            raise ValueError(f"Unsupported jobType: {job_type!r}")

        partidas_total = sum(len(c.items) for c in budget.chapters)
        return PipelineRunResult(
            budgetId=budget.id,
            partidasResolved=partidas_total,
            totalEstimated=getattr(budget, "totalEstimated", 0.0) or 0.0,
        )

    # ------------------------------------------------------------------
    # PDF pipeline (measurements / vision-extract)
    # ------------------------------------------------------------------

    async def _run_pdf_pipeline(
        self,
        *,
        job_type: JobType,
        payload: dict[str, Any],
        budget_id: str,
        lead_id: str,
        pdf_bytes: Optional[bytes],
        resume_partidas: list[dict[str, Any]],
        on_partida_resolved: OnPartidaResolved,
        cancellation_event: asyncio.Event,
    ) -> Any:
        if not pdf_bytes:
            raise ValueError(
                f"pdf_bytes is required for jobType={job_type.value}"
            )

        raw_items = self._pdf_to_chunks(pdf_bytes)
        # Default strategy mirrors the legacy endpoint defaults.
        strategy = (payload.get("strategy") or "INLINE").upper()
        logger.info(
            "budget_pipeline_runner: PDF pipeline starting",
            extra={
                "budgetId": budget_id,
                "jobType": job_type.value,
                "strategy": strategy,
                "chunks": len(raw_items),
                "resumePartidas": len(resume_partidas),
            },
        )

        # P4.b — reconstruct full BudgetPartida objects from the dicts that
        # were persisted to Firestore by a prior attempt. The swarm uses
        # `.code` to skip items AND concatenates these into the final list,
        # so the assembled Budget reflects everything resolved across
        # attempts.
        from src.budget.domain.entities import BudgetPartida

        resume_from_partidas = [
            BudgetPartida.model_validate(d) for d in resume_partidas
        ]

        async def _on_resolved(partida: Any) -> None:
            await on_partida_resolved(
                partida.code or "",
                partida.model_dump(mode="json"),
                # Token cost isn't surfaced by the swarm yet — pass 0 so the
                # checkpoint records the partida even without accounting.
                0.0,
            )

        client_name = (payload.get("clientName") or "").strip() or None
        budget_title = (payload.get("budgetTitle") or "").strip() or None
        return await self._restructure_uc.execute(
            raw_items=raw_items,
            lead_id=lead_id,
            budget_id=budget_id,
            strategy=strategy,
            pdf_bytes=pdf_bytes,
            resume_from=resume_from_partidas,
            on_partida_resolved=_on_resolved,
            client_name=client_name,
            budget_title=budget_title,
        )

    # ------------------------------------------------------------------
    # NL pipeline (nl-budget)
    # ------------------------------------------------------------------

    async def _run_nl_pipeline(
        self,
        *,
        payload: dict[str, Any],
        budget_id: str,
        lead_id: str,
        resume_partidas: list[dict[str, Any]],
        on_partida_resolved: OnPartidaResolved,
        cancellation_event: asyncio.Event,
    ) -> Any:
        narrative = (payload.get("narrative") or "").strip()
        if not narrative:
            raise ValueError(
                "payload.narrative is required for jobType=nl-budget"
            )
        logger.info(
            "budget_pipeline_runner: NL pipeline starting",
            extra={
                "budgetId": budget_id,
                "narrativeLen": len(narrative),
                "resumePartidas": len(resume_partidas),
            },
        )
        # NL UC doesn't yet accept resume kwargs; the architect re-decomposes
        # the brief identically across retries, so practical effect is small.
        # Future P4.c can extend `GenerateBudgetFromNlUseCase` similarly.
        client_name = (payload.get("clientName") or "").strip() or None
        budget_title = (payload.get("budgetTitle") or "").strip() or None
        return await self._nl_uc.execute(
            narrative=narrative,
            lead_id=lead_id,
            budget_id=budget_id,
            client_name=client_name,
            budget_title=budget_title,
        )
