"""Fake in-memory del `IPriceBookRepository` — para dry-run y tests.

Paralelo a `InMemoryCatalogRepository`. No es un adapter "de test" únicamente:
el script `vectorize_catalog_v005.py` lo usa en modo dry-run.
"""

from __future__ import annotations

from src.budget.catalog.application.ports.price_book_repository import (
    EntryWithEmbedding,
    IPriceBookRepository,
)
from src.budget.catalog.domain.price_book_entry import (
    PriceBookBreakdownEntry,
    PriceBookItemEntry,
)


class InMemoryPriceBookRepository(IPriceBookRepository):
    def __init__(self) -> None:
        self._docs: dict[str, EntryWithEmbedding] = {}
        self._wiped: int = 0

    async def save_price_book_entries_batch(
        self, entries_with_embeddings: list[EntryWithEmbedding]
    ) -> None:
        for entry, embedding in entries_with_embeddings:
            self._docs[entry.code] = (entry, list(embedding))

    async def wipe_price_book(self) -> None:
        self._wiped += len(self._docs)
        self._docs.clear()

    async def find_breakdowns_by_parent(
        self, parent_code: str
    ) -> list[PriceBookBreakdownEntry]:
        """Devuelve breakdowns cuyo parent_code coincide (entries con kind='breakdown')."""
        if not parent_code:
            return []
        results: list[PriceBookBreakdownEntry] = []
        for entry, _embedding in self._docs.values():
            if (
                isinstance(entry, PriceBookBreakdownEntry)
                and entry.parent_code == parent_code
            ):
                results.append(entry)
        return results

    async def list_all_items(self) -> list[PriceBookItemEntry]:
        """S1-A-02 — Devuelve todos los entries `kind='item'`."""
        return [
            entry
            for entry, _embedding in self._docs.values()
            if isinstance(entry, PriceBookItemEntry)
        ]
