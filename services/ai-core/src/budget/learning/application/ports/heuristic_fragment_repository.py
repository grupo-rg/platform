"""Port `IHeuristicFragmentRepository` — persistencia y retrieval de fragments.

Fragments son ejemplos dorados aprobados por el aparejador (ICL + RLHF). El
Swarm los consulta en 6.C para inyectar "patrones aprendidos" al Pro cuando
encuentra evidencia repetida en el mismo capítulo para descripciones similares.

Retrieval semantics (decisión 2026-04-22):
  - min_count ≥ 2  → sin evidencia repetida, no se inyecta nada.
  - similarity ≥ 0.70 (difflib.SequenceMatcher sobre descripción).
  - max_age_months = 12 (alineado con ciclo anual del price_book).
  - Solo `status='golden'` cuenta como evidencia.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional

from src.budget.domain.entities import HeuristicFragment


class IHeuristicFragmentRepository(ABC):
    """Persistencia de `HeuristicFragment` + retrieval para el loop ICL."""

    @abstractmethod
    async def save(self, fragment: HeuristicFragment) -> None:
        """Upsert del fragment (idempotente por `fragment.id`)."""

    @abstractmethod
    async def find_by_id(self, fragment_id: str) -> Optional[HeuristicFragment]:
        """Devuelve el fragment con ese id, o None si no existe."""

    @abstractmethod
    async def find_relevant(
        self,
        chapter: str,
        description: str,
        similarity_threshold: float = 0.70,
        min_count: int = 2,
        max_age_months: int = 12,
        partida_code: str | None = None,
    ) -> list[HeuristicFragment]:
        """Devuelve fragments golden del mismo capítulo, recientes y
        semánticamente similares a `description`.

        `partida_code` (opcional, ej. '01.06'): si está presente, el filtro
        de capítulo prefiere `chapter_code:NN` (estable, leído del PDF) sobre
        `chapter:NAME` (variable según extractor LLM).

        Si el total de matches < `min_count` devuelve `[]` (sin evidencia
        suficiente para inyectar como patrón aprendido). El orden es por
        similitud descendente.
        """
