"""Port for the budget-generation work itself.

The point of this port is to keep `RunPipelineJobUseCase` (which owns the
lifecycle: claim → run → terminal status) decoupled from the concrete
budget pipelines (`RestructureBudgetUseCase`, `GenerateBudgetFromNlUseCase`).
The adapter that bridges those existing use cases lives in
`infrastructure/budget_pipeline_runner.py` and is the home of the
checkpoint-aware logic added in P4.

Why a runner port instead of injecting the budget UCs directly:
  - Lets P5 ship without touching `swarm_pricing_service.py` (the riskiest
    file). The use case is tested end-to-end with a fake runner today.
  - Cancellation, resume, and "partida resolved" callbacks live behind
    one contract; future job types only implement this port.
"""

from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod
from typing import Any, Awaitable, Callable, Optional

from pydantic import BaseModel

from src.pipeline_jobs.domain.entities import JobType


class PipelineRunResult(BaseModel):
    """Returned by IPipelineRunner.run when the work completes successfully."""

    budgetId: str
    partidasResolved: int
    totalEstimated: float = 0.0


# Callback signature: (partida_code, partida_dict, token_cost) -> awaitable
OnPartidaResolved = Callable[[str, dict[str, Any], float], Awaitable[None]]


class IPipelineRunner(ABC):
    @abstractmethod
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
        """Run the budget pipeline.

        Args:
            job_type: discriminator — selects the concrete pipeline.
            payload: jobType-specific dict (gcsUri/strategy, narrative, etc).
            budget_id: pre-assigned by the dispatcher so the Firestore doc
                id is stable across retries.
            lead_id: owner of the budget (used to populate the budget doc).
            pdf_bytes: already-downloaded PDF bytes, or None for nl-budget.
            resume_partidas: serialised BudgetPartida snapshots from prior
                attempts' checkpoints. The runner skips items whose `code`
                appears here AND concatenates these partidas into the final
                assembly so the Budget reflects everything that has been
                resolved across all attempts. Empty on a fresh run.
            on_partida_resolved: invoked after each partida is finalised,
                with `(partida_code, partida_dict, token_cost_for_this_partida)`.
                The use case turns each call into a Firestore checkpoint write.
            cancellation_event: set by the use case when the user requests
                cancellation. The runner MUST check this between expensive
                steps and raise asyncio.CancelledError to abort cleanly.

        Returns:
            PipelineRunResult on success.

        Raises:
            asyncio.CancelledError if cancellation_event fires.
            Any other exception bubbles up; the use case maps it to a
            `failed` status with the exception message.
        """
