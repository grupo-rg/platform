"""Use case `RunPriceBookIngestUseCase` — ingesta del libro nuevo a staging.

Fase 4c del asistente de actualización. Corre DENTRO del Cloud Run Job worker
(enrutado por `JOB_TYPE=price-book-extract` en `worker_main`), NO en el Service
HTTP.

**Streaming / memoria constante.** El libro completo son ~1.700 partidas +
~18k componentes. Cargarlo todo (extracción pdfplumber de todas las páginas +
acumular todos los embeddings antes de guardar) revienta la RAM y no escala con
el tamaño del PDF. En su lugar procesamos por **ventanas de páginas**: por cada
ventana extraemos → embebemos (Vertex 768) → escribimos a
`price_book_{year}_staging` → liberamos, antes de pasar a la siguiente. Solo se
acumula el resumen del diff (code→precio), que es ligero. Así la memoria es
plana sea cual sea el tamaño del libro, y el staging se va llenando en vivo.

Flujo:
  1. Reclama el job (queued→running) + descarga el PDF de GCS a un temp local.
  2. Wipe de la colección de staging (una vez — NUNCA toca el activo).
  3. Por cada ventana de páginas confirmadas: extraer → mapear → embed+save.
  4. Diff COMPLETO extraído↔activo (reutiliza `diff_items`) para la compuerta 2.
  5. Marca completado. Progreso por ventana a `pipeline_telemetry/{jobId}/events`
     (la UI se suscribe por polling).
"""

from __future__ import annotations

import asyncio
import gc
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

# Páginas por ventana de streaming. ~40 págs ≈ ~150 items + ~1.500 componentes
# por lote → pico de RAM de unos cientos de MB, no gigas. Ajustable.
_PAGE_WINDOW = 40


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


def _windows(pages: list[int], size: int) -> list[list[int]]:
    return [pages[i : i + size] for i in range(0, len(pages), size)]


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

    @staticmethod
    def _extract_window(tmp_path: Path, window: list[int]) -> Any:
        """Extrae SOLO las páginas de esta ventana (pdfplumber, bloqueante)."""
        return extract_catalog(tmp_path, page_filter=window or None)

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
        pages = sorted({int(p) for p in (payload.get("pages") or []) if int(p) >= 1})
        year = int(payload.get("year") or 0)
        gcs_uri = payload.get("gcsUri") or ""
        staging = staging_collection_for(year)

        tmp_path: Path | None = None
        try:
            self._emit(
                job_id,
                "price_book_ingest_started",
                {"pages": len(pages), "year": year, "staging": staging},
            )

            # 1. PDF desde GCS → temp local (se reusa en cada ventana).
            pdf_bytes = await self.storage.download_to_bytes(gcs_uri)

            def _write_temp() -> Path:
                with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                    tmp.write(pdf_bytes)
                    return Path(tmp.name)

            tmp_path = await asyncio.to_thread(_write_temp)
            del pdf_bytes  # ya está en disco; no lo mantengas en RAM

            # 2. Repo apuntando a staging + wipe (una vez). NUNCA toca el activo.
            staging_repo = FirestorePriceBookRepository(self.db, collection=staging)
            await staging_repo.wipe_price_book()
            reindex = ReindexPriceBookUseCase(staging_repo, self.embedder)

            windows = _windows(pages, _PAGE_WINDOW)
            diff_input: list[dict] = []
            items_saved = 0
            breakdowns_saved = 0

            # 3. Streaming por ventanas: extraer → embed → save → liberar.
            for wi, window in enumerate(windows):
                self._emit(
                    job_id,
                    "price_book_ingest_progress",
                    {
                        "phase": "embed_write",
                        "message": (
                            f"Lote {wi + 1}/{len(windows)} · págs {window[0]}–{window[-1]} · "
                            f"extrayendo + embeddings + escritura…"
                        ),
                        "window": wi + 1,
                        "windows": len(windows),
                        "items_saved": items_saved,
                    },
                )
                extraction = await asyncio.to_thread(self._extract_window, tmp_path, window)
                source_chapters = _extraction_to_source_chapters(extraction)
                for it in extraction.items:
                    diff_input.append(
                        {
                            "code": it.code,
                            "price_total": it.price_total,
                            "description": it.description,
                            "unit": it.unit,
                        }
                    )
                report = await reindex.execute(
                    source_chapters, wipe=False, source_book=f"COAATMCA_{year}"
                )
                items_saved += report.items_saved
                breakdowns_saved += report.breakdowns_saved

                # Liberar la ventana antes de la siguiente (memoria plana).
                extraction = None
                source_chapters = None
                await asyncio.to_thread(gc.collect)

            # 4. Diff COMPLETO extraído ↔ libro activo (compuerta 2).
            active_index = await asyncio.to_thread(self._load_active_index)
            diff = diff_items(diff_input, active_index)

            self._emit(
                job_id,
                "price_book_ingest_completed",
                {
                    "staging": staging,
                    "items_saved": items_saved,
                    "breakdowns_saved": breakdowns_saved,
                    "active_item_count": len(active_index),
                    "diff": diff.to_dict()["summary"],
                    "diff_samples": diff.to_dict()["samples"][:40],
                },
            )
            await self.job_repo.mark_completed(job_id, partidas_resolved=items_saved)
            logger.info(
                "price_book_ingest_completed",
                extra={
                    "jobId": job_id,
                    "staging": staging,
                    "itemsSaved": items_saved,
                    "breakdownsSaved": breakdowns_saved,
                    "windows": len(windows),
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
        finally:
            if tmp_path is not None:
                try:
                    tmp_path.unlink()
                except OSError:
                    pass
