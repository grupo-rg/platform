"""Unit tests for GcsPdfStorage.

The adapter downloads PDFs from Cloud Storage so the worker can hand them
to the existing extractor pipeline. Tests use injected mock clients —
they do NOT hit GCS — and verify:
  - `gs://bucket/path` URIs parse correctly.
  - The blob is read via `download_as_bytes()`.
  - Cloud SDK exceptions map to the domain `PdfStorageError`.
  - Metadata (size, content type, generation) is exposed for sanity checks.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from google.api_core import exceptions as gcloud_exceptions

from src.pipeline_jobs.application.ports.pdf_storage import (
    InvalidGcsUriError,
    PdfNotFoundError,
    PdfStorageError,
)
from src.pipeline_jobs.infrastructure.gcs_pdf_storage import GcsPdfStorage


@pytest.fixture
def storage_client():
    return MagicMock()


@pytest.fixture
def storage(storage_client):
    return GcsPdfStorage(storage_client=storage_client)


def _wire_blob(storage_client: MagicMock, content: bytes = b"%PDF-1.7..."):
    """Connect mock client → bucket → blob with predictable download bytes."""
    blob = MagicMock()
    blob.download_as_bytes.return_value = content
    blob.size = len(content)
    blob.content_type = "application/pdf"
    blob.generation = 1234567890
    blob.exists.return_value = True
    bucket = MagicMock()
    bucket.blob.return_value = blob
    storage_client.bucket.return_value = bucket
    return bucket, blob


# ---------------------------------------------------------------------------
# URI parsing
# ---------------------------------------------------------------------------


class TestUriParsing:
    async def test_parses_canonical_uri(self, storage, storage_client):
        _wire_blob(storage_client)
        await storage.download_to_bytes(
            "gs://grupo-rg-a9929-pipeline-uploads/user-1/job-abc/x.pdf"
        )
        storage_client.bucket.assert_called_once_with(
            "grupo-rg-a9929-pipeline-uploads"
        )
        storage_client.bucket.return_value.blob.assert_called_once_with(
            "user-1/job-abc/x.pdf"
        )

    async def test_parses_uri_with_nested_path(self, storage, storage_client):
        _wire_blob(storage_client)
        await storage.download_to_bytes("gs://my-bucket/a/b/c/d/e/file.pdf")
        storage_client.bucket.return_value.blob.assert_called_once_with(
            "a/b/c/d/e/file.pdf"
        )

    async def test_uri_without_gs_scheme_raises(self, storage):
        with pytest.raises(InvalidGcsUriError):
            await storage.download_to_bytes(
                "https://storage.googleapis.com/bucket/path"
            )

    async def test_uri_without_path_raises(self, storage):
        with pytest.raises(InvalidGcsUriError):
            await storage.download_to_bytes("gs://only-bucket")

    async def test_empty_uri_raises(self, storage):
        with pytest.raises(InvalidGcsUriError):
            await storage.download_to_bytes("")


# ---------------------------------------------------------------------------
# download_to_bytes
# ---------------------------------------------------------------------------


class TestDownload:
    async def test_returns_blob_content(self, storage, storage_client):
        _wire_blob(storage_client, content=b"%PDF-1.7\nhello world")
        data = await storage.download_to_bytes("gs://b/u/j/x.pdf")
        assert data == b"%PDF-1.7\nhello world"

    async def test_not_found_maps_to_pdf_not_found_error(
        self, storage, storage_client
    ):
        _, blob = _wire_blob(storage_client)
        blob.download_as_bytes.side_effect = gcloud_exceptions.NotFound(
            "no such object"
        )
        with pytest.raises(PdfNotFoundError):
            await storage.download_to_bytes("gs://b/u/j/x.pdf")

    async def test_permission_denied_maps_to_pdf_storage_error(
        self, storage, storage_client
    ):
        _, blob = _wire_blob(storage_client)
        blob.download_as_bytes.side_effect = (
            gcloud_exceptions.PermissionDenied("nope")
        )
        with pytest.raises(PdfStorageError):
            await storage.download_to_bytes("gs://b/u/j/x.pdf")

    async def test_size_limit_enforced(self, storage, storage_client):
        # 100MB limit — anything bigger raises before the actual download.
        _, blob = _wire_blob(storage_client)
        blob.reload = MagicMock()
        blob.size = 200 * 1024 * 1024  # 200MB
        with pytest.raises(PdfStorageError) as exc_info:
            await storage.download_to_bytes(
                "gs://b/u/j/x.pdf", max_bytes=100 * 1024 * 1024
            )
        assert "size" in str(exc_info.value).lower()
        blob.download_as_bytes.assert_not_called()

    async def test_content_type_validated_when_strict(
        self, storage, storage_client
    ):
        _, blob = _wire_blob(storage_client)
        blob.reload = MagicMock()
        blob.content_type = "text/html"
        with pytest.raises(PdfStorageError) as exc_info:
            await storage.download_to_bytes(
                "gs://b/u/j/x.pdf", strict_content_type=True
            )
        assert "content" in str(exc_info.value).lower()


# ---------------------------------------------------------------------------
# get_metadata
# ---------------------------------------------------------------------------


class TestGetMetadata:
    async def test_returns_size_and_content_type(self, storage, storage_client):
        _, blob = _wire_blob(storage_client, content=b"x" * 1024)
        meta = await storage.get_metadata("gs://b/u/j/x.pdf")
        assert meta.size == 1024
        assert meta.contentType == "application/pdf"
        assert meta.generation == 1234567890

    async def test_metadata_not_found_raises(self, storage, storage_client):
        bucket = MagicMock()
        blob = MagicMock()
        blob.reload.side_effect = gcloud_exceptions.NotFound("missing")
        bucket.blob.return_value = blob
        storage_client.bucket.return_value = bucket
        with pytest.raises(PdfNotFoundError):
            await storage.get_metadata("gs://b/u/j/x.pdf")
