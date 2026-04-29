"""Adapter determinista que devuelve embeddings por longitud del texto.

Sirve para el modo dry-run del script de reindex y para tests que necesitan
un embedder reproducible sin tocar Vertex AI. No es adecuado para producción:
los vectores no tienen significado semántico.
"""

from __future__ import annotations

from src.budget.catalog.application.ports.embedding_provider import IEmbeddingProvider


class DeterministicEmbeddingProvider(IEmbeddingProvider):
    def __init__(self, dim: int = 768) -> None:
        self.dim = dim

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        return [[float(len(t))] + [0.0] * (self.dim - 1) for t in texts]
