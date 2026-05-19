"""Port for reading PDF blobs out of object storage.

The dispatcher receives a `gs://` URI from the client (the browser uploaded
the PDF straight to Firebase Storage). The worker uses this port to
materialise the PDF bytes when it starts processing — keeping the HTTP
dispatcher stateless and avoiding the 512MB Server-Actions body limit on
the Next.js side.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from pydantic import BaseModel


class PdfMetadata(BaseModel):
    size: int
    contentType: str
    generation: int


class IPdfStorage(ABC):
    @abstractmethod
    async def download_to_bytes(
        self,
        gcs_uri: str,
        *,
        max_bytes: int = 100 * 1024 * 1024,
        strict_content_type: bool = False,
    ) -> bytes:
        """Read the blob behind a `gs://bucket/path` URI into memory.

        max_bytes: enforced before downloading. The worker has 2GB so the
            soft cap of 100MB protects against runaway uploads. Raises
            PdfStorageError if exceeded.

        strict_content_type: if True, refuses to download anything whose
            stored contentType isn't `application/pdf`. The Storage rule
            already enforces this on upload; setting True is belt-and-suspenders
            for the worker.
        """

    @abstractmethod
    async def get_metadata(self, gcs_uri: str) -> PdfMetadata:
        """Cheap HEAD-like call. Used for sanity checks and logging."""

    @abstractmethod
    async def upload_pdf(
        self,
        *,
        uid: str,
        job_id: str,
        filename: str,
        pdf_bytes: bytes,
        content_type: str = "application/pdf",
    ) -> str:
        """Upload PDF bytes to the pipeline_uploads bucket and return its
        `gs://bucket/path` URI.

        The object path is `pipeline_uploads/{uid}/{job_id}/{filename}` to
        mirror the client-side uploader (`storage-uploader.ts`). Keeping the
        layout identical means the Storage rules apply uniformly whether the
        PDF was uploaded by the browser or by the dispatcher.

        Used by the HTTP dispatcher when the legacy endpoints
        (`/api/v1/jobs/measurements`, `/api/v1/budget/vision-extract`)
        receive a PDF synchronously and need to hand it off to the Cloud
        Run Job worker without keeping it in the Service's memory.
        """


class PdfStorageError(Exception):
    """Wraps any cloud-side failure (size cap exceeded, permission denied,
    transport error). The dispatcher maps to 500; the worker marks
    pipeline_jobs/{jobId} as failed with this message."""


class PdfNotFoundError(PdfStorageError):
    """The object does not exist. Distinct from generic storage failures so
    the dispatcher can return a clean 404 to the client."""


class InvalidGcsUriError(PdfStorageError):
    """Malformed URI. Almost always means a bug in the client — we treat it
    as a 400 at the dispatcher, not as a runtime failure of the worker."""
