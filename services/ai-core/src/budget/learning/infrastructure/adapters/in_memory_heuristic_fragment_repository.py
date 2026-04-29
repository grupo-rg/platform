"""In-memory `IHeuristicFragmentRepository` para tests + fallback local."""

from __future__ import annotations

from typing import Optional

from src.budget.domain.entities import HeuristicFragment
from src.budget.learning.application._retrieval import filter_and_rank_fragments
from src.budget.learning.application.ports.heuristic_fragment_repository import (
    IHeuristicFragmentRepository,
)


class InMemoryHeuristicFragmentRepository(IHeuristicFragmentRepository):
    def __init__(self) -> None:
        self._fragments: dict[str, HeuristicFragment] = {}

    async def save(self, fragment: HeuristicFragment) -> None:
        self._fragments[fragment.id] = fragment

    async def find_by_id(self, fragment_id: str) -> Optional[HeuristicFragment]:
        return self._fragments.get(fragment_id)

    async def find_relevant(
        self,
        chapter: str,
        description: str,
        similarity_threshold: float = 0.70,
        min_count: int = 2,
        max_age_months: int = 12,
        partida_code: str | None = None,
    ) -> list[HeuristicFragment]:
        return filter_and_rank_fragments(
            self._fragments.values(),
            chapter=chapter,
            description=description,
            similarity_threshold=similarity_threshold,
            min_count=min_count,
            max_age_months=max_age_months,
            partida_code=partida_code,
        )
