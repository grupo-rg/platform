"""Use case `ReindexPriceBookUseCase` — reindexa el libro al esquema v005.

Flujo:
  1. `CatalogTransformer.transform(source)` → (items, breakdowns) entries.
  2. Si `wipe=True`: `repo.wipe_price_book()` para partir de colección vacía.
  3. Para cada entry, construir el texto con `EmbeddingTextBuilder`.
  4. Agrupar los textos en batches (`embed_batch_size`, default 25 — límite
     de Vertex AI text-embedding-004).
  5. Llamar a `embedder.embed_batch(texts)` por cada batch.
  6. Emparejar cada entry con su embedding (preservando el orden).
  7. Persistir los pares en batches en el repo.

Modo `dry_run=True` salta los pasos 2-7: solo reporta qué se habría hecho,
útil para validar la transformación sin llamar a APIs caras.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Union

from src.budget.catalog.application.ports.embedding_provider import IEmbeddingProvider
from src.budget.catalog.application.ports.price_book_repository import (
    IPriceBookRepository,
)
from src.budget.catalog.application.services.catalog_transformer import (
    CatalogTransformer,
)
from src.budget.catalog.domain.price_book_entry import (
    EmbeddingTextBuilder,
    PriceBookBreakdownEntry,
    PriceBookItemEntry,
)


@dataclass
class ReindexReport:
    items_transformed: int
    breakdowns_transformed: int
    items_saved: int
    breakdowns_saved: int
    errors: list[str] = field(default_factory=list)
    dry_run: bool = False


class ReindexPriceBookUseCase:
    def __init__(
        self,
        repo: IPriceBookRepository,
        embedder: IEmbeddingProvider,
        embed_batch_size: int = 100,  # Gemini batchEmbedContents acepta ≥ 100
        save_batch_size: int = 400,  # el adapter re-trocea por payload ≤ 10MiB
    ) -> None:
        self.repo = repo
        self.embedder = embedder
        self.embed_batch_size = embed_batch_size
        self.save_batch_size = save_batch_size

    async def execute(
        self,
        source: list[dict],
        *,
        wipe: bool = False,
        dry_run: bool = False,
    ) -> ReindexReport:
        items, breakdowns = CatalogTransformer.transform(source)
        report = ReindexReport(
            items_transformed=len(items),
            breakdowns_transformed=len(breakdowns),
            items_saved=0,
            breakdowns_saved=0,
            dry_run=dry_run,
        )

        if dry_run or (not items and not breakdowns):
            return report

        if wipe:
            await self.repo.wipe_price_book()

        # Construir textos y embed-ear en batches por kind (ordenado).
        # Separamos items y breakdowns para no perder la asignación entry→emb.
        item_texts = [EmbeddingTextBuilder.for_item(i) for i in items]
        bk_texts = [EmbeddingTextBuilder.for_breakdown(b) for b in breakdowns]

        item_embeddings = await self._embed_all(item_texts)
        bk_embeddings = await self._embed_all(bk_texts)

        # Emparejar entry con su embedding y persistir en batches al repo.
        item_pairs: list[tuple[Union[PriceBookItemEntry, PriceBookBreakdownEntry], list[float]]] = list(
            zip(items, item_embeddings)
        )
        bk_pairs: list[tuple[Union[PriceBookItemEntry, PriceBookBreakdownEntry], list[float]]] = list(
            zip(breakdowns, bk_embeddings)
        )

        all_pairs = item_pairs + bk_pairs
        for i in range(0, len(all_pairs), self.save_batch_size):
            chunk = all_pairs[i : i + self.save_batch_size]
            await self.repo.save_price_book_entries_batch(chunk)

        report.items_saved = len(item_pairs)
        report.breakdowns_saved = len(bk_pairs)
        return report

    async def _embed_all(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        embeddings: list[list[float]] = []
        for i in range(0, len(texts), self.embed_batch_size):
            batch = texts[i : i + self.embed_batch_size]
            result = await self.embedder.embed_batch(batch)
            embeddings.extend(result)
        return embeddings
