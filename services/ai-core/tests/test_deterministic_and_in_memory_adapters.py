"""Tests cortos de los adapters determinista / in-memory del price_book.

Son de I/O mínimo (sin red), pero los cubrimos para que el coverage del
subdomain catalog se mantenga ≥ 90%. También verifican el contrato básico:
el determinista respeta `dim` + determinismo por longitud; el in-memory
preserva lo guardado y wipe limpia.
"""

from __future__ import annotations

import asyncio

import pytest

from src.budget.catalog.domain.price_book_entry import PriceBookItemEntry
from src.budget.catalog.infrastructure.adapters.deterministic_embedding_provider import (
    DeterministicEmbeddingProvider,
)
from src.budget.catalog.infrastructure.adapters.in_memory_price_book_repository import (
    InMemoryPriceBookRepository,
)


class TestDeterministicEmbeddingProvider:
    def test_returns_vector_per_text(self) -> None:
        p = DeterministicEmbeddingProvider(dim=8)
        result = asyncio.run(p.embed_batch(["hola", "mundo largo"]))
        assert len(result) == 2
        assert all(len(v) == 8 for v in result)

    def test_first_component_encodes_text_length(self) -> None:
        p = DeterministicEmbeddingProvider(dim=4)
        result = asyncio.run(p.embed_batch(["a", "abcd"]))
        assert result[0][0] == 1.0
        assert result[1][0] == 4.0

    def test_empty_input_returns_empty(self) -> None:
        p = DeterministicEmbeddingProvider()
        result = asyncio.run(p.embed_batch([]))
        assert result == []


class TestInMemoryPriceBookRepository:
    def _item(self, code: str) -> PriceBookItemEntry:
        return PriceBookItemEntry(
            code=code,
            chapter="X",
            section="",
            description="d",
            unit_raw="m2",
            unit_normalized="m2",
            unit_dimension="superficie",
            priceTotal=1.0,
        )

    def test_save_persists_entries_with_embeddings(self) -> None:
        repo = InMemoryPriceBookRepository()
        pair = (self._item("A"), [0.1, 0.2])
        asyncio.run(repo.save_price_book_entries_batch([pair]))
        stored = repo._docs["A"]
        assert stored[0].code == "A"
        assert stored[1] == [0.1, 0.2]

    def test_wipe_clears_all_docs_and_counts_them(self) -> None:
        repo = InMemoryPriceBookRepository()
        asyncio.run(repo.save_price_book_entries_batch([
            (self._item("A"), [0.0]),
            (self._item("B"), [0.1]),
        ]))
        assert len(repo._docs) == 2
        asyncio.run(repo.wipe_price_book())
        assert repo._docs == {}
        assert repo._wiped == 2

    def test_save_is_idempotent_on_same_code(self) -> None:
        repo = InMemoryPriceBookRepository()
        asyncio.run(repo.save_price_book_entries_batch([(self._item("A"), [0.0])]))
        asyncio.run(repo.save_price_book_entries_batch([(self._item("A"), [9.9])]))
        # Última escritura gana
        assert repo._docs["A"][1] == [9.9]
