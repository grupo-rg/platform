"""Adapter Firestore del `IPriceBookRepository` — colección `price_book_2025`.

Guarda ambos kinds (item y breakdown) en la misma colección, diferenciados
por el campo `kind`. Usa `doc_id = entry.code` para idempotencia: re-seed
del mismo JSON no duplica docs.

En producción el embedding se persiste con `Vector()` de Firestore. En
tests se guarda como lista (el fake client no conoce Vector). La serialización
detecta si el cliente soporta Vector y se adapta.
"""

from __future__ import annotations

import logging
from typing import Any

from src.budget.catalog.application.ports.price_book_repository import (
    EntryWithEmbedding,
    IPriceBookRepository,
)
from src.budget.catalog.domain.price_book_entry import (
    PriceBookBreakdownEntry,
    PriceBookItemEntry,
)

logger = logging.getLogger(__name__)

PRICE_BOOK_COLLECTION = "price_book_2025"

# Firestore limita batches a 500 OPERACIONES **y** a ~10 MiB de PAYLOAD.
# Con embeddings de 768 dims (~30KB serialized per doc), el límite real
# que nos ata es el de payload: 400 docs ≈ 11MB → 400 INVALID_ARGUMENT.
# 100 docs ≈ 3MB nos deja margen holgado.
_FIRESTORE_BATCH_LIMIT = 100


def _embedding_for_firestore(vector: list[float]) -> Any:
    """Convierte a `Vector` de Firestore si la librería está disponible.

    En tests unitarios (sin firebase_admin en el entorno o con fake client)
    devolvemos la lista tal cual — Firestore real la rechazaría, pero en
    tests nos sirve para verificar que el valor llega entero.
    """
    try:
        from google.cloud.firestore_v1.vector import Vector
        return Vector(vector)
    except ImportError:
        return vector


class FirestorePriceBookRepository(IPriceBookRepository):
    def __init__(self, db: Any) -> None:
        self.db = db

    async def save_price_book_entries_batch(
        self, entries_with_embeddings: list[EntryWithEmbedding]
    ) -> None:
        if not entries_with_embeddings:
            return

        col = self.db.collection(PRICE_BOOK_COLLECTION)
        # Trocear si excede el límite de batch de Firestore.
        for i in range(0, len(entries_with_embeddings), _FIRESTORE_BATCH_LIMIT):
            chunk = entries_with_embeddings[i : i + _FIRESTORE_BATCH_LIMIT]
            batch = self.db.batch()
            for entry, embedding in chunk:
                # Fase 12 — `doc_id` (compound `{parent}#{idx:02d}`) si existe
                # garantiza unicidad en Firestore aunque el `code` original del
                # COAATMCA se repita entre items (ej. `mo055` aparece en cientos).
                # Fallback: `entry.code` (items padre y entries legacy sin doc_id).
                doc_id = getattr(entry, "doc_id", None) or entry.code
                doc_ref = col.document(doc_id)
                payload = entry.model_dump()
                payload["embedding"] = _embedding_for_firestore(embedding)
                batch.set(doc_ref, payload)
            batch.commit()

    async def wipe_price_book(self) -> None:
        col = self.db.collection(PRICE_BOOK_COLLECTION)
        deleted = 0
        batch = self.db.batch()
        ops_in_batch = 0
        for snap in col.stream():
            ref = col.document(snap.id)
            batch.delete(ref)
            ops_in_batch += 1
            deleted += 1
            if ops_in_batch >= _FIRESTORE_BATCH_LIMIT:
                batch.commit()
                batch = self.db.batch()
                ops_in_batch = 0
        if ops_in_batch > 0:
            batch.commit()
        if deleted:
            logger.info(f"Wiped {deleted} docs from {PRICE_BOOK_COLLECTION}")
