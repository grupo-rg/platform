"""Cloud Storage adapter for IPdfStorage.

Wraps `google.cloud.storage.Client` for the worker. Synchronous SDK calls
go through `asyncio.to_thread` so a slow download doesn't block the worker's
event loop (the worker also runs the heartbeat task in parallel).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from google.api_core import exceptions as gcloud_exceptions

from src.pipeline_jobs.application.ports.pdf_storage import (
    InvalidGcsUriError,
    IPdfStorage,
    PdfMetadata,
    PdfNotFoundError,
    PdfStorageError,
)

logger = logging.getLogger(__name__)


class GcsPdfStorage(IPdfStorage):
    def __init__(self, *, storage_client: Any) -> None:
        self._client = storage_client

    @classmethod
    def from_env(cls) -> "GcsPdfStorage":
        from google.cloud import storage

        return cls(storage_client=storage.Client())

    # ------------------------------------------------------------------
    # download_to_bytes
    # ------------------------------------------------------------------

    async def download_to_bytes(
        self,
        gcs_uri: str,
        *,
        max_bytes: int = 100 * 1024 * 1024,
        strict_content_type: bool = False,
    ) -> bytes:
        bucket_name, object_path = self._parse_uri(gcs_uri)
        blob = self._client.bucket(bucket_name).blob(object_path)

        # Size + content type pre-check via blob.reload() (HEAD-like).
        try:
            await asyncio.to_thread(blob.reload)
        except gcloud_exceptions.NotFound as e:
            raise PdfNotFoundError(
                f"PDF not found at {gcs_uri}: {e}"
            ) from e
        except gcloud_exceptions.GoogleAPICallError as e:
            raise PdfStorageError(
                f"Failed to load metadata for {gcs_uri}: {e}"
            ) from e

        size = blob.size or 0
        if size > max_bytes:
            raise PdfStorageError(
                f"PDF size {size} bytes exceeds limit {max_bytes} "
                f"({gcs_uri})"
            )

        content_type = blob.content_type or ""
        if strict_content_type and content_type != "application/pdf":
            raise PdfStorageError(
                f"Unexpected content type '{content_type}' for {gcs_uri} "
                f"(expected application/pdf)"
            )

        try:
            data = await asyncio.to_thread(blob.download_as_bytes)
        except gcloud_exceptions.NotFound as e:
            raise PdfNotFoundError(
                f"PDF disappeared during download: {gcs_uri}"
            ) from e
        except gcloud_exceptions.GoogleAPICallError as e:
            raise PdfStorageError(
                f"download_as_bytes failed for {gcs_uri}: {e}"
            ) from e

        logger.info(
            "PDF downloaded",
            extra={"gcsUri": gcs_uri, "size": size, "contentType": content_type},
        )
        return data

    # ------------------------------------------------------------------
    # get_metadata
    # ------------------------------------------------------------------

    async def get_metadata(self, gcs_uri: str) -> PdfMetadata:
        bucket_name, object_path = self._parse_uri(gcs_uri)
        blob = self._client.bucket(bucket_name).blob(object_path)
        try:
            await asyncio.to_thread(blob.reload)
        except gcloud_exceptions.NotFound as e:
            raise PdfNotFoundError(f"PDF not found at {gcs_uri}: {e}") from e
        except gcloud_exceptions.GoogleAPICallError as e:
            raise PdfStorageError(
                f"Failed to load metadata for {gcs_uri}: {e}"
            ) from e

        return PdfMetadata(
            size=blob.size or 0,
            contentType=blob.content_type or "",
            generation=blob.generation or 0,
        )

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_uri(gcs_uri: str) -> tuple[str, str]:
        if not gcs_uri or not gcs_uri.startswith("gs://"):
            raise InvalidGcsUriError(
                f"Not a GCS URI: '{gcs_uri}' (expected gs://bucket/path)"
            )
        without_scheme = gcs_uri[len("gs://") :]
        if "/" not in without_scheme:
            raise InvalidGcsUriError(
                f"Missing object path in URI: '{gcs_uri}'"
            )
        bucket, _, path = without_scheme.partition("/")
        if not bucket or not path:
            raise InvalidGcsUriError(
                f"Empty bucket or path in URI: '{gcs_uri}'"
            )
        return bucket, path
