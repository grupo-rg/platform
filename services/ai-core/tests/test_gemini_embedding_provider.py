"""Tests del `GeminiEmbeddingProvider` — batch embeddings vía API key.

Usa el cliente `google.genai` con `GOOGLE_GENAI_API_KEY` (no requiere
IAM permissions de Vertex). Batch nativo: `embed_content(contents=[...])`
devuelve una `embeddings` list con un vector por texto.

Modelo: `gemini-embedding-001` — 768 dims, consistente con el modelo que
usa el flujo de query en `gemini_adapter.get_embedding`.

Los tests mockean `genai_client.models.embed_content` para no hacer
llamadas reales. El adapter está marcado `pragma: no cover` en producción
parcialmente (el I/O), pero la lógica de batch y parsing SÍ se testea.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest


# Patch del env ANTES de importar el adapter: el constructor lee
# GOOGLE_GENAI_API_KEY del entorno al instanciarse.
@pytest.fixture(autouse=True)
def _set_api_key(monkeypatch):
    monkeypatch.setenv("GOOGLE_GENAI_API_KEY", "dummy-key-for-tests")


def _mock_embed_response(vectors: list[list[float]]):
    """Forma mínima compatible con la respuesta real:
    `response.embeddings[i].values` → list[float].
    """
    return SimpleNamespace(embeddings=[SimpleNamespace(values=v) for v in vectors])


class TestGeminiEmbeddingProviderConstruction:
    def test_raises_when_api_key_missing(self, monkeypatch):
        monkeypatch.delenv("GOOGLE_GENAI_API_KEY", raising=False)
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        from src.budget.catalog.infrastructure.adapters.gemini_embedding_provider import (
            GeminiEmbeddingProvider,
        )
        with pytest.raises(RuntimeError, match="API key"):
            GeminiEmbeddingProvider()


class TestGeminiEmbeddingProviderBatchBehavior:
    def test_returns_one_vector_per_text_in_same_order(self):
        from src.budget.catalog.infrastructure.adapters.gemini_embedding_provider import (
            GeminiEmbeddingProvider,
        )
        provider = GeminiEmbeddingProvider()
        fake_client = MagicMock()
        fake_client.models.embed_content.return_value = _mock_embed_response([
            [0.1, 0.2, 0.3],
            [0.4, 0.5, 0.6],
            [0.7, 0.8, 0.9],
        ])
        provider._client = fake_client  # type: ignore[attr-defined]

        result = asyncio.run(provider.embed_batch(["a", "b", "c"]))
        assert len(result) == 3
        assert result[0] == [0.1, 0.2, 0.3]
        assert result[2] == [0.7, 0.8, 0.9]

    def test_empty_input_returns_empty_without_api_call(self):
        from src.budget.catalog.infrastructure.adapters.gemini_embedding_provider import (
            GeminiEmbeddingProvider,
        )
        provider = GeminiEmbeddingProvider()
        fake_client = MagicMock()
        provider._client = fake_client  # type: ignore[attr-defined]

        result = asyncio.run(provider.embed_batch([]))
        assert result == []
        fake_client.models.embed_content.assert_not_called()

    def test_uses_gemini_embedding_001_model(self):
        from src.budget.catalog.infrastructure.adapters.gemini_embedding_provider import (
            GeminiEmbeddingProvider,
        )
        provider = GeminiEmbeddingProvider()
        fake_client = MagicMock()
        fake_client.models.embed_content.return_value = _mock_embed_response([[1.0]])
        provider._client = fake_client  # type: ignore[attr-defined]

        asyncio.run(provider.embed_batch(["hola"]))
        call = fake_client.models.embed_content.call_args
        assert call.kwargs.get("model") == "gemini-embedding-001"

    def test_truncates_vectors_to_768_dims_for_firestore_compatibility(self):
        """gemini-embedding-001 usa MRL y devuelve 3072 dims por defecto.
        Firestore rechaza vectores > 2048 dims → truncamos a 768 para:
          - Entrar en el ceiling de Firestore.
          - Ser consistente con el adapter de búsqueda
            (`firestore_price_book.py` trunca la query a 768 también).
        Truncar MRL es válido: los primeros N dims son un embedding
        autónomo por construcción del modelo.
        """
        from src.budget.catalog.infrastructure.adapters.gemini_embedding_provider import (
            GeminiEmbeddingProvider,
        )
        provider = GeminiEmbeddingProvider()
        fake_client = MagicMock()
        # SDK devuelve 3072-dim (valor por defecto del modelo)
        long_vec = [0.1] * 3072
        fake_client.models.embed_content.return_value = _mock_embed_response([long_vec, long_vec])
        provider._client = fake_client  # type: ignore[attr-defined]

        result = asyncio.run(provider.embed_batch(["a", "b"]))

        assert len(result) == 2
        assert all(len(v) == 768 for v in result), (
            f"Expected 768-dim vectors, got {[len(v) for v in result]}"
        )

    def test_preserves_shorter_vectors_as_is(self):
        """Si el modelo ya devuelve ≤ 768 dims, no se altera."""
        from src.budget.catalog.infrastructure.adapters.gemini_embedding_provider import (
            GeminiEmbeddingProvider,
        )
        provider = GeminiEmbeddingProvider()
        fake_client = MagicMock()
        short_vec = [0.2] * 500
        fake_client.models.embed_content.return_value = _mock_embed_response([short_vec])
        provider._client = fake_client  # type: ignore[attr-defined]

        result = asyncio.run(provider.embed_batch(["a"]))
        assert len(result[0]) == 500

    def test_response_count_mismatch_raises(self):
        """Si el provider devuelve menos vectores que textos, falla ruidosamente."""
        from src.budget.catalog.infrastructure.adapters.gemini_embedding_provider import (
            GeminiEmbeddingProvider,
        )
        provider = GeminiEmbeddingProvider()
        fake_client = MagicMock()
        # Mandamos 2 textos pero el mock devuelve solo 1 embedding
        fake_client.models.embed_content.return_value = _mock_embed_response([[0.0]])
        provider._client = fake_client  # type: ignore[attr-defined]

        with pytest.raises(RuntimeError, match="embeddings returned"):
            asyncio.run(provider.embed_batch(["a", "b"]))


class TestGeminiEmbeddingProviderRateLimitRetry:
    """Gemini free tier: 100 RPM. Cuando burstamos (muchos batches seguidos)
    el SDK devuelve 429 RESOURCE_EXHAUSTED. El provider reintenta con
    backoff exponencial; no deja caer el job completo por un 429 transitorio.
    """

    def test_retries_on_429_and_succeeds(self):
        from src.budget.catalog.infrastructure.adapters.gemini_embedding_provider import (
            GeminiEmbeddingProvider,
        )
        # Tiempo de sueño minúsculo para que el test sea rápido
        provider = GeminiEmbeddingProvider(max_retries=3, base_delay=0.001)
        fake_client = MagicMock()
        success_resp = _mock_embed_response([[0.1] * 10, [0.2] * 10])
        fake_client.models.embed_content.side_effect = [
            Exception("429 RESOURCE_EXHAUSTED: Resource exhausted"),  # burst
            Exception("429 RESOURCE_EXHAUSTED: try again"),            # burst otra vez
            success_resp,                                              # ahora sí
        ]
        provider._client = fake_client  # type: ignore[attr-defined]

        result = asyncio.run(provider.embed_batch(["a", "b"]))
        assert len(result) == 2
        assert fake_client.models.embed_content.call_count == 3

    def test_raises_after_exhausting_retries(self):
        from src.budget.catalog.infrastructure.adapters.gemini_embedding_provider import (
            GeminiEmbeddingProvider,
        )
        provider = GeminiEmbeddingProvider(max_retries=2, base_delay=0.001)
        fake_client = MagicMock()
        fake_client.models.embed_content.side_effect = Exception("429 RESOURCE_EXHAUSTED")
        provider._client = fake_client  # type: ignore[attr-defined]

        with pytest.raises(Exception, match="RESOURCE_EXHAUSTED"):
            asyncio.run(provider.embed_batch(["a"]))
        assert fake_client.models.embed_content.call_count == 2

    def test_does_not_retry_on_non_rate_limit_errors(self):
        """Errores que no son 429 (e.g. validación) NO se reintentan — fallan rápido."""
        from src.budget.catalog.infrastructure.adapters.gemini_embedding_provider import (
            GeminiEmbeddingProvider,
        )
        provider = GeminiEmbeddingProvider(max_retries=5, base_delay=0.001)
        fake_client = MagicMock()
        fake_client.models.embed_content.side_effect = ValueError("bad input")
        provider._client = fake_client  # type: ignore[attr-defined]

        with pytest.raises(ValueError):
            asyncio.run(provider.embed_batch(["a"]))
        assert fake_client.models.embed_content.call_count == 1
