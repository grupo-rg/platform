"""Adapter `GeminiEmbeddingProvider` — batch embeddings vía API key.

Usa el SDK `google.genai` con `GOOGLE_GENAI_API_KEY` del entorno. No
requiere IAM de Vertex AI — es la misma vía que usa el resto del sistema
(`gemini_adapter.py:get_embedding`).

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
        api_key = os.environ.get("GOOGLE_GENAI_API_KEY") or os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError(
                "GeminiEmbeddingProvider requires API key "
                "(GOOGLE_GENAI_API_KEY or GEMINI_API_KEY env)."
            )
        from google import genai
        self._client: Any = genai.Client(api_key=api_key)
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
                response = await asyncio.to_thread(
                    self._client.models.embed_content,
                    model=_MODEL,
                    contents=texts,
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
