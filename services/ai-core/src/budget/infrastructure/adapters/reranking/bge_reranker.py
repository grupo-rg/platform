"""S1-A-03 — Cross-encoder reranker `BAAI/bge-reranker-v2-m3` local.

Sustituye el `_rerank_candidates` actual del swarm (que invocaba Gemini
Flash en una llamada extra por partida con ≥4 candidatos) por un
cross-encoder que vive en RAM y corre en CPU.

Costes:
  - LLM Flash rerank: ~$0.01/partida × 876 partidas (caso incidente) = ~$8.76
  - BGE cross-encoder: $0 (CPU local).
  - Latencia BGE: ~50-200ms para 20 candidates en CPU del worker.

El modelo se pre-descarga al build de la imagen Docker (~280MB) para
evitar el cold-start de ~30s en el primer `predict`. Ver Dockerfile.

Patrón: este módulo NO importa `sentence_transformers` al top-level.
Lo hace lazy dentro de `_create_default_model` para que:
  1. Los tests puedan construir el reranker con un fake model.
  2. Los scripts offline (vectorize_catalog.py) no paguen el coste de
     cargar 280MB cuando solo necesitan otras partes del módulo.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


# Modelo por defecto. Documentado por contrato — si cambia, ajustar el
# Dockerfile pre-download también.
DEFAULT_MODEL_NAME = "BAAI/bge-reranker-v2-m3"
DEFAULT_MAX_LENGTH = 512


def _create_default_model(
    model_name: str = DEFAULT_MODEL_NAME,
    max_length: int = DEFAULT_MAX_LENGTH,
) -> Any:
    """Lazy-load the CrossEncoder. Aislado para que los tests no carguen
    el modelo real.

    Si `sentence-transformers` no está instalado (p.ej. en CI ligero o
    scripts offline), levanta `ImportError` con instrucción clara.
    """
    try:
        from sentence_transformers import CrossEncoder  # type: ignore
    except ImportError as e:
        raise ImportError(
            "BgeReranker requires `sentence-transformers`. "
            "Install via `pip install sentence-transformers==3.0.1` or "
            "skip BGE reranking by leaving it un-wired."
        ) from e
    logger.info(f"[BgeReranker] loading model {model_name!r} (max_length={max_length})")
    return CrossEncoder(model_name, max_length=max_length)


class BgeReranker:
    """Cross-encoder reranker singleton.

    Dos modos de uso:
      - Producción: ``BgeReranker.get()`` instancia el modelo real una vez
        en el worker. El modelo está pre-descargado en la imagen Docker.
      - Tests: ``BgeReranker(model=fake_model)`` construye una instancia
        con un fake controlable.

    El método ``rerank(query, candidates, top_n)`` toma una lista de dicts
    (de la forma producida por ``IVectorSearch`` /
    ``HybridCatalogSearch.search``) y devuelve los top-N por score
    descendente del cross-encoder, conservando los demás campos del dict.
    """

    _instance: Optional["BgeReranker"] = None

    def __init__(self, *, model: Any = None):
        # `model` puede ser cualquier objeto con un método
        # `predict(pairs) -> Sequence[float]`. En producción es
        # `sentence_transformers.CrossEncoder`; en tests es un fake.
        self.model = model

    @classmethod
    def get(cls, *, model: Any = None) -> "BgeReranker":
        """Devuelve el singleton, instanciándolo si no existe.

        Si se pasa ``model``, se usa para la construcción inicial; si el
        singleton YA existe, se devuelve sin reemplazar el modelo (idempotente).
        """
        if cls._instance is None:
            cls._instance = cls(model=model if model is not None else _create_default_model())
        return cls._instance

    @classmethod
    def _reset_singleton_for_tests(cls) -> None:
        """Resetea el singleton — solo para tests."""
        cls._instance = None

    def rerank(
        self,
        query: str,
        candidates: List[Dict[str, Any]],
        top_n: int = 3,
    ) -> List[Tuple[Dict[str, Any], float]]:
        """Rerankea los candidates con el cross-encoder.

        Args:
          query: descripción de la partida (RestructuredItem.description).
          candidates: lista de dicts con al menos ``id`` y ``description``.
            Candidates sin description se descartan silenciosamente.
          top_n: número de candidates a devolver. Si hay menos, devuelve
            todos.

        Returns:
          Lista de ``(candidate_dict, score)`` ordenada por score
          descendente, hasta ``top_n`` elementos. El candidate_dict es
          el mismo objeto pasado (sin mutar otras claves).
        """
        if not candidates:
            return []

        # Filtra candidatos sin descripción usable.
        valid: List[Dict[str, Any]] = [
            c for c in candidates if (c.get("description") or "").strip()
        ]
        if not valid:
            return []

        pairs: List[Tuple[str, str]] = [
            (query, c["description"]) for c in valid
        ]

        try:
            scores = self.model.predict(pairs)
        except Exception as e:
            # No queremos que un fallo del cross-encoder rompa el swarm.
            # Devolvemos los candidates en su orden original con score 0.0 —
            # el caller puede decidir si caer al passthrough.
            logger.warning(
                f"[BgeReranker] predict failed ({type(e).__name__}: {e}); "
                f"returning input order with score=0.0"
            )
            return [(c, 0.0) for c in valid[:top_n]]

        # `scores` puede ser numpy array, list, tensor — normalizamos a float.
        scored: List[Tuple[Dict[str, Any], float]] = list(
            zip(valid, [float(s) for s in scores])
        )
        scored.sort(key=lambda cs: -cs[1])
        return scored[:top_n]
