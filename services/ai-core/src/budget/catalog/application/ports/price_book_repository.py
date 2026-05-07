"""Port `IPriceBookRepository` — persistencia del price_book v005.

Separado de `ICatalogRepository` (que maneja `LaborRate`) para seguir
Single Responsibility. Ambos ports se implementan sobre Firestore por
sus respectivos adapters.

El repo trabaja con la colección `price_book_2025` que guarda ambos
tipos de documentos (item padre + breakdown hijo) distinguidos por
el campo `kind`.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Union

from src.budget.catalog.domain.price_book_entry import (
    PriceBookBreakdownEntry,
    PriceBookItemEntry,
)

PriceBookEntry = Union[PriceBookItemEntry, PriceBookBreakdownEntry]
EntryWithEmbedding = tuple[PriceBookEntry, list[float]]


class IPriceBookRepository(ABC):
    @abstractmethod
    async def save_price_book_entries_batch(
        self, entries_with_embeddings: list[EntryWithEmbedding]
    ) -> None:
        """Upsert atómico en batch. Cada tuple es (entry, embedding_vector).
        Doc_id = entry.code (determinista → seed idempotente).
        """

    @abstractmethod
    async def wipe_price_book(self) -> None:
        """Borra TODOS los docs de la colección. Usado por reindex --wipe."""

    @abstractmethod
    async def find_breakdowns_by_parent(
        self, parent_code: str
    ) -> list[PriceBookBreakdownEntry]:
        """Phase 17.8 — Carga los componentes (kind='breakdown') hijos de un
        item padre del catálogo. Usado para heredar el descompuesto del
        catálogo cuando el agente devuelve un match 1:1 sin breakdown propio.
        Retorna lista vacía si el padre no tiene breakdowns asociados.
        """
