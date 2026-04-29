"""Fase 3.5 — tests del `ReindexPriceBookUseCase`.

El use case orquesta:
  1. `CatalogTransformer.transform(source)` → (items, breakdowns).
  2. `embedder.embed_batch(texts)` para items en batches, luego para breakdowns.
  3. `repo.save_price_book_entries_batch(entries_with_embeddings)`.

Contrato:
  - Llama a `embed_batch` tantas veces como batches quepan en el límite.
  - Llama a `save_price_book_entries_batch` con tuples `(entry, embedding)`.
  - Cada embedding corresponde al texto exacto de `EmbeddingTextBuilder`.
  - Flag `wipe=True` llama primero a `repo.wipe_price_book()` y luego ingesta.
  - Flag `dry_run=True` NO escribe ni llama al embedder — solo cuenta.
  - El report es honesto: `items_saved + breakdowns_saved + len(errors)` coincide.
"""

from __future__ import annotations

import asyncio

import pytest

from src.budget.catalog.application.use_cases.reindex_price_book_uc import (
    ReindexPriceBookUseCase,
    ReindexReport,
)


# -------- Fakes ----------------------------------------------------------------


class _FakeEmbeddingProvider:
    """Devuelve un vector determinista por texto (para tests reproducibles)."""

    def __init__(self, dim: int = 4):
        self.dim = dim
        self.batches_called: list[list[str]] = []

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        self.batches_called.append(texts)
        # Vector "identidad": longitud del texto, seguido de ceros.
        # Es determinista y permite verificar que los textos no se mezclan.
        return [[float(len(t))] + [0.0] * (self.dim - 1) for t in texts]


class _FakePriceBookRepo:
    def __init__(self):
        self.wiped: bool = False
        self.saved_batches: list[list[tuple]] = []

    async def wipe_price_book(self) -> None:
        self.wiped = True

    async def save_price_book_entries_batch(
        self, entries_with_embeddings: list[tuple]
    ) -> None:
        self.saved_batches.append(entries_with_embeddings)


def _source_fixture() -> list[dict]:
    return [
        {
            "chapter": "ACRISTALAMIENTOS",
            "items": [
                {
                    "code": "LVC010",
                    "description": "Doble acristalamiento 4/12/4",
                    "unit": "m2",
                    "priceTotal": 75.02,
                    "chapter": "ACRISTALAMIENTOS",
                    "section": "Vidrios dobles",
                    "breakdown": [
                        {"code": "x", "description": "Vidrio 4mm", "unit": "m2",
                         "quantity": 1.01, "price_unit": 39.58, "price": 39.98},
                        {"code": "y", "description": "Oficial 1ª cristalero", "unit": "h",
                         "quantity": 0.41, "price_unit": 35.2, "price": 14.43},
                    ],
                },
            ],
        },
    ]


# -------- Happy path -----------------------------------------------------------


class TestReindexHappyPath:
    def test_transforms_embeds_and_saves(self) -> None:
        repo = _FakePriceBookRepo()
        embedder = _FakeEmbeddingProvider()
        uc = ReindexPriceBookUseCase(repo=repo, embedder=embedder)

        report = asyncio.run(uc.execute(source=_source_fixture()))

        # Transformación: 1 item + 2 breakdowns = 3 entries
        assert isinstance(report, ReindexReport)
        assert report.items_saved == 1
        assert report.breakdowns_saved == 2
        assert report.errors == []

        # Embedder fue llamado al menos una vez
        assert len(embedder.batches_called) >= 1

        # Repo recibió batches con tuples (entry, embedding)
        assert len(repo.saved_batches) >= 1
        all_saved = [pair for batch in repo.saved_batches for pair in batch]
        assert len(all_saved) == 3

        # Cada pair es (entry, embedding_list)
        for entry, emb in all_saved:
            assert hasattr(entry, "kind")
            assert isinstance(emb, list)
            assert len(emb) == embedder.dim

    def test_embeds_exactly_the_text_builder_output(self) -> None:
        """El texto embedded debe coincidir con `EmbeddingTextBuilder.for_*`."""
        from src.budget.catalog.domain.price_book_entry import EmbeddingTextBuilder

        repo = _FakePriceBookRepo()
        embedder = _FakeEmbeddingProvider()
        uc = ReindexPriceBookUseCase(repo=repo, embedder=embedder)
        asyncio.run(uc.execute(source=_source_fixture()))

        # Juntar todos los textos que el embedder recibió
        all_texts = [t for batch in embedder.batches_called for t in batch]
        # Reconstruir los textos esperados
        from src.budget.catalog.application.services.catalog_transformer import (
            CatalogTransformer,
        )
        items, bks = CatalogTransformer.transform(_source_fixture())
        expected_texts = [EmbeddingTextBuilder.for_item(i) for i in items]
        expected_texts += [EmbeddingTextBuilder.for_breakdown(b) for b in bks]

        assert set(all_texts) == set(expected_texts)

    def test_wipe_flag_wipes_before_write(self) -> None:
        repo = _FakePriceBookRepo()
        embedder = _FakeEmbeddingProvider()
        uc = ReindexPriceBookUseCase(repo=repo, embedder=embedder)
        asyncio.run(uc.execute(source=_source_fixture(), wipe=True))
        assert repo.wiped is True

    def test_no_wipe_by_default(self) -> None:
        repo = _FakePriceBookRepo()
        embedder = _FakeEmbeddingProvider()
        uc = ReindexPriceBookUseCase(repo=repo, embedder=embedder)
        asyncio.run(uc.execute(source=_source_fixture()))
        assert repo.wiped is False


# -------- Dry-run --------------------------------------------------------------


class TestReindexDryRun:
    def test_dry_run_does_not_call_embedder_nor_repo(self) -> None:
        repo = _FakePriceBookRepo()
        embedder = _FakeEmbeddingProvider()
        uc = ReindexPriceBookUseCase(repo=repo, embedder=embedder)
        report = asyncio.run(uc.execute(source=_source_fixture(), dry_run=True))

        assert report.items_saved == 0
        assert report.breakdowns_saved == 0
        assert report.dry_run is True
        # Pero report.items_transformed/breakdowns_transformed reflejan el trabajo
        assert report.items_transformed == 1
        assert report.breakdowns_transformed == 2

        assert embedder.batches_called == []
        assert repo.saved_batches == []
        assert repo.wiped is False


# -------- Empty input ----------------------------------------------------------


class TestReindexEmptyInput:
    def test_empty_source_is_noop(self) -> None:
        repo = _FakePriceBookRepo()
        embedder = _FakeEmbeddingProvider()
        uc = ReindexPriceBookUseCase(repo=repo, embedder=embedder)
        report = asyncio.run(uc.execute(source=[]))

        assert report.items_saved == 0
        assert report.breakdowns_saved == 0
        assert embedder.batches_called == []
        assert repo.saved_batches == []


# -------- Batching -------------------------------------------------------------


class TestReindexBatchesEmbeddings:
    def test_embedder_called_in_batches_of_configured_size(self) -> None:
        # 10 items → con batch_size=4, esperamos 3 llamadas (4, 4, 2)
        source = [{
            "chapter": "X",
            "items": [
                {
                    "code": f"I{i}",
                    "description": f"desc {i}",
                    "unit": "m2",
                    "priceTotal": 1.0,
                    "breakdown": [],
                }
                for i in range(10)
            ],
        }]
        repo = _FakePriceBookRepo()
        embedder = _FakeEmbeddingProvider()
        uc = ReindexPriceBookUseCase(repo=repo, embedder=embedder, embed_batch_size=4)
        asyncio.run(uc.execute(source=source))

        # 10 items → 3 batches de texts (4+4+2)
        sizes = [len(b) for b in embedder.batches_called]
        assert sum(sizes) == 10
        assert max(sizes) <= 4
