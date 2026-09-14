"""Use case `RunPriceBookIngestUseCase` — ingesta del libro nuevo a staging.

Fase 4c del asistente de actualización. Corre DENTRO del Cloud Run Job worker
(enrutado por `JOB_TYPE=price-book-extract` en `worker_main`), NO en el Service
HTTP: la extracción del libro completo son ~73s + embeddings, demasiado para una
request síncrona (timeout + OOM — misma razón por la que el pipeline de budget
se sacó a un job).

Flujo:
  1. Reclama el job (queued→running) + descarga el PDF de GCS.
  2. Extrae SOLO las páginas confirmadas (`extract_catalog(page_filter=...)`).
  3. Mapea la extracción al formato del `CatalogTransformer`.
  4. `ReindexPriceBookUseCase` → transforma + embeda (Vertex 768) + escribe a
     `price_book_{year}_staging` (wipe previo — es una colección scratch, NUNCA
     toca el libro activo).
  5. Diff COMPLETO extraído↔activo (reutiliza `diff_items`) para la compuerta 2.
  6. Marca completado. Progreso por fases a `pipeline_telemetry/{jobId}/events`
     (la UI se suscribe por SSE).
"""

from __future__ import annotations

import asyncio
import logging
import tempfile
from collections import OrderedDict
from pathlib import Path
from typing import Any

from src.budget.catalog.application.use_cases.reindex_price_book_uc import (
    ReindexPriceBookUseCase,
)
from src.budget.catalog.catalog_config import price_book_collection
from src.budget.catalog.infrastructure.adapters.firestore_price_book_repository import (
    FirestorePriceBookRepository,
)
from src.budget.catalog.pdf_extractor import extract_catalog
from src.budget.catalog.price_book_diff import diff_items

logger = logging.getLogger(__name__)


def staging_collection_for(year: int) -> str:
    return f"price_book_{year}_staging"


def _extraction_to_source_chapters(extraction: Any) -> list[dict]:
    """Extracción (Partida planas) → formato que espera CatalogTransformer
    (capítulos → items → breakdown)."""
    chapters: "OrderedDict[str, list[dict]]" = OrderedDict()
    for it in extraction.items:
        ch = it.chapter or "SIN CAPÍTULO"
        chapters.setdefault(ch, []).append(
            {
                "code": it.code,
                "description": it.description,
                "unit": it.unit,
                "section": it.subchapter or "",
                "priceTotal": it.price_total,
                "page": it.page_physical,
                "breakdown": [
                    {
                        "code": bk.code,
                        "description": bk.description,
                        "unit": bk.unit,
                        "quantity": bk.quantity,
                        "price_unit": bk.price_unit,
                        "price": bk.price_total,
                        "is_variable": False,
                    }
                    for bk in it.breakdowns
                ],
            }
        )
    return [{"chapter": ch, "items": items} for ch, items in chapters.items()]


class RunPriceBookIngestUseCase:
    def __init__(
        self,
        *,
        job_repo: Any,
        storage: Any,
        telemetry: Any,
        embedder: Any,
        db: Any,
    ) -> None:
        self.job_repo = job_repo
        # Alias para que el SIGTERM handler genérico de worker_main
        # (`use_case.repository.request_cancellation`) funcione sin cambios.
        self.repository = job_repo
        self.storage = storage
        self.telemetry = telemetry
        self.embedder = embedder
        self.db = db

    # ------------------------------------------------------------------

    def _emit(self, job_id: str, event_type: str, data: dict) -> None:
        try:
            self.telemetry.execute(job_id, event_type, data)
        except Exception:  # noqa: BLE001 — la telemetría nunca tumba el job
            logger.exception("price_book_ingest_emit_failed", extra={"jobId": job_id})

    def _extract(self, pdf_bytes: bytes, pages: list[int]) -> Any:
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(pdf_bytes)
            tmp_path = Path(tmp.name)
        try:
            return extract_catalog(tmp_path, page_filter=pages or None)
        finally:
            try:
                tmp_path.unlink()
            except OSError:
                pass

    def _load_active_index(self) -> dict[str, float]:
        idx: dict[str, float] = {}
        collection = price_book_collection()
        try:
            q = (
                self.db.collection(collection)
                .where("kind", "==", "item")
                .select(["code", "priceTotal"])
            )
            for snap in q.stream():
                d = snap.to_dict() or {}
                c = (str(d.get("code") or "")).strip()
                if not c:
                    continue
                try:
                    idx[c] = float(d.get("priceTotal") or 0.0)
                except (TypeError, ValueError):
                    idx[c] = 0.0
        except Exception:  # noqa: BLE001 — sin índice, el diff sale todo "new"
            logger.exception("price_book_ingest_active_index_failed")
        return idx

    # ------------------------------------------------------------------

    async def execute(self, *, job_id: str, attempt_id: str) -> None:
        job = await self.job_repo.get_by_id(job_id)
        await self.job_repo.claim_for_attempt(
            job_id,
            attempt_id=attempt_id,
            execution_name=job.currentExecutionName,
        )

        payload = job.payload or {}
        pages = [int(p) for p in (payload.get("pages") or []) if int(p) >= 1]
        year = int(payload.get("year") or 0)
        gcs_uri = payload.get("gcsUri") or ""
        staging = staging_collection_for(year)

        try:
            self._emit(
                job_id,
                "price_book_ingest_started",
                {"pages": len(pages), "year": year, "staging": staging},
            )

            # 1. PDF desde GCS.
            pdf_bytes = await self.storage.download_to_bytes(gcs_uri)

            # 2. Extracción (bloqueante → thread).
            self._emit(
                job_id,
                "price_book_ingest_progress",
                {"phase": "extract", "message": f"Extrayendo {len(pages)} páginas…"},
            )
            extraction = await asyncio.to_thread(self._extract, pdf_bytes, pages)
            source_chapters = _extraction_to_source_chapters(extraction)
            n_items = sum(len(c["items"]) for c in source_chapters)

            # 3. Transform + embed (Vertex) + escritura a staging (wipe previo).
            self._emit(
                job_id,
                "price_book_ingest_progress",
                {
                    "phase": "embed_write",
                    "message": f"{n_items} partidas · generando embeddings y escribiendo a staging…",
                    "items": n_items,
                },
            )
            staging_repo = FirestorePriceBookRepository(self.db, collection=staging)
            reindex = ReindexPriceBookUseCase(staging_repo, self.embedder)
            report = await reindex.execute(
                source_chapters, wipe=True, source_book=f"COAATMCA_{year}"
            )

            # 4. Diff COMPLETO extraído ↔ libro activo (compuerta 2).
            active_index = await asyncio.to_thread(self._load_active_index)
            diff = diff_items(
                [
                    {
                        "code": it.code,
                        "price_total": it.price_total,
                        "description": it.description,
                        "unit": it.unit,
                    }
                    for it in extraction.items
                ],
                active_index,
            )

            self._emit(
                job_id,
                "price_book_ingest_completed",
                {
                    "staging": staging,
                    "items_saved": report.items_saved,
                    "breakdowns_saved": report.breakdowns_saved,
                    "active_item_count": len(active_index),
                    "diff": diff.to_dict()["summary"],
                    "diff_samples": diff.to_dict()["samples"][:40],
                },
            )
            await self.job_repo.mark_completed(job_id, partidas_resolved=report.items_saved)
            logger.info(
                "price_book_ingest_completed",
                extra={
                    "jobId": job_id,
                    "staging": staging,
                    "itemsSaved": report.items_saved,
                    "breakdownsSaved": report.breakdowns_saved,
                },
            )

        except asyncio.CancelledError:
            logger.warning("price_book_ingest_canceled", extra={"jobId": job_id})
            try:
                await self.job_repo.mark_canceled(job_id)
            except Exception:
                logger.exception("price_book_ingest_mark_canceled_failed", extra={"jobId": job_id})
            raise
        except BaseException as e:  # noqa: BLE001 — registrar y re-lanzar
            error_message = str(e) or e.__class__.__name__
            error_type = e.__class__.__name__
            logger.exception("price_book_ingest_failed", extra={"jobId": job_id})
            self._emit(
                job_id,
                "price_book_ingest_failed",
                {"errorType": error_type, "errorMessage": error_message},
            )
            try:
                await self.job_repo.mark_failed(
                    job_id, error_message=error_message, error_type=error_type
                )
            except Exception:
                logger.exception("price_book_ingest_mark_failed_error", extra={"jobId": job_id})
            raise
