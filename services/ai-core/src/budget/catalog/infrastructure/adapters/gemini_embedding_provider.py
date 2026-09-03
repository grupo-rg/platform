"""Adapter `GeminiEmbeddingProvider` — batch embeddings vía Vertex AI.

Usa el SDK `google.genai` en modo Vertex (ADC del service-account de runtime,
pago por uso). Requiere el rol `roles/aiplatform.user` en el SA. Misma vía que
el resto del sistema (`gemini_adapter.py:get_embedding`).

Modelo: `gemini-embedding-001` (MRL, 3072 dims por defecto). Truncamos a
768 para:
  - Entrar en el ceiling de Firestore (vectores ≤ 2048 dims).
  - Coincidir con la query del adapter existente
    (`firestore_price_book.py` ya trunca a 768).

Rate limit: el free tier de Gemini es 100 RPM. Cuando burstamos batches
seguidos en la reindex, el SDK devuelve `429 RESOURCE_EXHAUSTED`. El
provider reintenta con backoff exponencial + jitter; opcionalmente se
añade un `inter_batch_delay` para throttle preventivo entre llamadas.
"""

from __future__ import annotations

import asyncio
import logging
import os
import random
from typing import Any

from src.budget.catalog.application.ports.embedding_provider import IEmbeddingProvider
from src.budget.infrastructure.config.model_registry import get_model

logger = logging.getLogger(__name__)

_MODEL = "gemini-embedding-001"

# gemini-embedding-001 es MRL (Matryoshka) y devuelve 3072 dims por defecto.
# Firestore acepta vectores de ≤ 2048 dims. Truncamos a 768 (coincide con
# `firestore_price_book.py:46` que trunca la query al mismo valor).
# Truncar MRL es válido por diseño: los primeros N dims son embedding
# auto-contenido.
_FIRESTORE_DIM_LIMIT = 768


def _is_rate_limit_error(exc: Exception) -> bool:
    """Heurística simple: detecta 429 / RESOURCE_EXHAUSTED en mensaje.

    Preferimos string matching a `isinstance` porque el SDK puede cambiar
    la jerarquía de excepciones entre versiones.
    """
    msg = str(exc).lower()
    return "429" in msg or "resource_exhausted" in msg or "rate limit" in msg


class GeminiEmbeddingProvider(IEmbeddingProvider):
    def __init__(
        self,
        *,
        max_retries: int = 5,
        base_delay: float = 4.0,
        inter_batch_delay: float = 0.7,
    ) -> None:
        project = (
            os.environ.get("GOOGLE_CLOUD_PROJECT")
            or os.environ.get("GCLOUD_PROJECT")
            or os.environ.get("FIREBASE_PROJECT_ID")
        )
        if not project:
            raise RuntimeError(
                "GeminiEmbeddingProvider requires GOOGLE_CLOUD_PROJECT / GCLOUD_PROJECT / "
                "FIREBASE_PROJECT_ID (Vertex AI)."
            )
        location = os.environ.get("GOOGLE_CLOUD_LOCATION", "europe-southwest1")
        from google import genai
        self._client: Any = genai.Client(vertexai=True, project=project, location=location)
        # Phase 0 — embedding model id from the configurable registry
        # (``model_registry/embedding``), TTL-cached + non-fatal; falls back to
        # ``_MODEL`` (``gemini-embedding-001``) with no doc present. Dims stay at
        # ``_FIRESTORE_DIM_LIMIT`` (768) — NEVER driven by the registry, since
        # changing dims would invalidate every stored vector.
        self._model = get_model("embedding", default_model_id=_MODEL).model_id
        self._max_retries = max_retries
        self._base_delay = base_delay
        # Throttle preventivo entre batches — 0.7s da <90 RPM, por debajo del
        # free tier de 100 RPM con algo de margen.
        self._inter_batch_delay = inter_batch_delay

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []

        last_exc: Exception | None = None
        for attempt in range(self._max_retries):
            try:
                from google.genai import types
                response = await asyncio.to_thread(
                    self._client.models.embed_content,
                    model=self._model,
                    contents=texts,
                    config=types.EmbedContentConfig(output_dimensionality=_FIRESTORE_DIM_LIMIT),
                )
                vectors = [emb.values for emb in response.embeddings]
                if len(vectors) != len(texts):
                    raise RuntimeError(
                        f"Unexpected embeddings returned: got {len(vectors)}, expected {len(texts)}"
                    )
                # Throttle preventivo en camino feliz — evita disparar el rate
                # limit en el siguiente batch.
                if self._inter_batch_delay > 0:
                    await asyncio.sleep(self._inter_batch_delay)
                return [v[:_FIRESTORE_DIM_LIMIT] for v in vectors]
            except Exception as e:
                last_exc = e
                if not _is_rate_limit_error(e) or attempt == self._max_retries - 1:
                    raise
                delay = self._base_delay * (2 ** attempt) + random.uniform(0, 1)
                logger.warning(
                    f"Rate limit on embed_batch (attempt {attempt + 1}/{self._max_retries}), "
                    f"sleeping {delay:.1f}s"
                )
                await asyncio.sleep(delay)

        raise RuntimeError(f"embed_batch exhausted retries: {last_exc}")
