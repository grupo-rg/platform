"""Port `IEmbeddingProvider` — abstrae el backend de embeddings.

Separado de `ILLMProvider` para permitir llamadas en batch (Vertex AI
text-embedding-004 acepta hasta 25 por request). Los tests inyectan un
fake determinista; en producción se usa el adapter de Vertex AI.
"""

from __future__ import annotations

from abc import ABC, abstractmethod


class IEmbeddingProvider(ABC):
    @abstractmethod
    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Devuelve un embedding por texto, EN EL MISMO ORDEN que la entrada."""
