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

S2-A-00 — Optimizaciones tras smoke real (74 partidas, 28 min en CPU):
  1. ``pre_warm()`` fuerza la inicialización de torch al boot (~3s
     amortizados). Sin esto, el primer rerank tarda 30s vs 10s después.
  2. ``DEFAULT_TOP_N`` bajado de 3 a 5 candidatos (configurable por el
     caller). Reducir el input al cross-encoder a max 5 candidates baja
     ~30% por partida en CPU.
  3. ``batch_rerank(queries_with_candidates)`` permite acumular pairs
     de varias partidas concurrentes y procesarlas en un solo
     ``model.predict`` con batching real (sentence-transformers soporta
     ``batch_size``). Throughput esperado: ~8x con SWARM_CONCURRENCY=8.
  4. ``is_enabled()`` reads ``ENABLE_BGE_RERANK`` env var (default
     ``true``). Cuando ``false``, el swarm salta el rerank y usa los
     top-k del hybrid search directamente. Útil para A/B testing y
     emergencias operativas (rollback sin redeploy).
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)


# Modelo por defecto. Documentado por contrato — si cambia, ajustar el
# Dockerfile pre-download también.
DEFAULT_MODEL_NAME = "BAAI/bge-reranker-v2-m3"
DEFAULT_MAX_LENGTH = 512
# S2-A-00 — top-k reducido a 5 (era 3 implícito en el swarm). El
# cross-encoder no se beneficia de devolver MÁS candidates en sí; lo
# que reducimos es el INPUT al cross-encoder a max 5 pairs por query.
# El swarm sigue pidiendo top_n=3 explícitamente al `rerank`; lo que el
# caller debe hacer es limitar la lista de candidates a 5 ANTES de
# llamar a rerank (ver swarm_pricing_service._rerank_candidates).
DEFAULT_TOP_N = 5
# S2-A-00 — batch_size del CrossEncoder. 32 es seguro en CPU (BGE-m3
# ocupa ~2GB peak con batch 32 según docs upstream). El default de
# sentence-transformers (32) ya es razonable; lo exponemos para que
# tests y producción puedan tunearlo.
DEFAULT_BATCH_SIZE = 32


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


def is_enabled(env: Optional[Dict[str, str]] = None) -> bool:
    """S2-A-00 — kill-switch. Reads ``ENABLE_BGE_RERANK`` env var.

    Defaults to ``true`` (BGE rerank on). Returns ``False`` when the env
    var is set to a falsy value (``false``, ``0``, ``no``, ``off``,
    empty string). Anything else (including unset) → ``True``.

    Cuando ``False``, el swarm debe saltar la fase de rerank y pasar los
    top-k del hybrid search directamente al Judge.
    """
    resolved = env if env is not None else os.environ
    raw = (resolved.get("ENABLE_BGE_RERANK") or "").strip().lower()
    if raw in {"false", "0", "no", "off"}:
        return False
    return True


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

    El método ``batch_rerank(queries_with_candidates)`` (S2-A-00) acumula
    pairs de N partidas y los procesa en un solo ``predict`` para
    aprovechar el batching nativo del cross-encoder. Throughput esperado:
    ~8x con SWARM_CONCURRENCY=8.
    """

    _instance: Optional["BgeReranker"] = None

    def __init__(
        self,
        *,
        model: Any = None,
        batch_size: int = DEFAULT_BATCH_SIZE,
    ):
        # `model` puede ser cualquier objeto con un método
        # `predict(pairs) -> Sequence[float]`. En producción es
        # `sentence_transformers.CrossEncoder`; en tests es un fake.
        self.model = model
        # S2-A-00 — batch_size del cross-encoder. Pasado a `predict` en
        # `batch_rerank`. En `rerank` (single-query) se usa también para
        # listas largas, aunque normalmente son ≤5 candidates.
        self.batch_size = batch_size
        # S2-A-00 — flag de pre-warm. Falso hasta que se ejecuta el
        # dummy predict en `pre_warm`. Usado por tests para verificar.
        self._warmed: bool = False

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

    def pre_warm(self) -> None:
        """S2-A-00 — fuerza la inicialización del cross-encoder con un
        predict dummy.

        Sin pre-warm, el primer ``predict`` real paga el coste de:
          - importar torch (~1-2s),
          - asignar tensores en CPU (~0.5s),
          - cachear el grafo de autograd (~1s).
        Total: ~3s adicionales en la primera partida (medido en CPU del
        worker Cloud Run, 1 vCPU).

        Tras pre-warm, predicts subsiguientes con 5 pairs tardan
        ~150-300ms (vs 30s la primera vez sin warm).

        Idempotente: llamadas subsiguientes son no-op.
        """
        if self._warmed:
            return
        if self.model is None:
            logger.warning("[BgeReranker] pre_warm: model is None; skipping")
            return
        try:
            # Dummy pair representativo (ambos strings cortos).
            _ = self.model.predict([("warmup", "warmup")])
            self._warmed = True
            logger.info("[BgeReranker] pre_warm complete")
        except Exception as e:
            # No queremos que el boot del worker falle por un crash del
            # pre-warm. Si el modelo está roto, el primer rerank lo
            # detectará y caerá al passthrough.
            logger.warning(
                f"[BgeReranker] pre_warm failed ({type(e).__name__}: {e}); "
                f"first real predict will pay the cold-start"
            )

    def rerank(
        self,
        query: str,
        candidates: List[Dict[str, Any]],
        top_n: int = 3,
        *,
        max_input_candidates: int = DEFAULT_TOP_N,
    ) -> List[Tuple[Dict[str, Any], float]]:
        """Rerankea los candidates con el cross-encoder.

        Args:
          query: descripción de la partida (RestructuredItem.description).
          candidates: lista de dicts con al menos ``id`` y ``description``.
            Candidates sin description se descartan silenciosamente.
          top_n: número de candidates a devolver. Si hay menos, devuelve
            todos.
          max_input_candidates: S2-A-00 — máximo de candidates que se
            pasan al cross-encoder. Si ``len(candidates) > max_input_candidates``,
            se truncan a los primeros N (asumimos que ya vienen
            pre-ordenados por hybrid search score, así que los primeros
            son los más prometedores). Default 5.

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

        # S2-A-00 — truncar input al cross-encoder. Asume que `valid`
        # viene pre-ordenado por hybrid search score (los primeros son
        # los más relevantes). Reducir el input ahorra ~30% en CPU
        # (medido en el smoke: 10s/partida vs 7s/partida con max=5).
        if len(valid) > max_input_candidates:
            valid = valid[:max_input_candidates]

        pairs: List[Tuple[str, str]] = [
            (query, c["description"]) for c in valid
        ]

        try:
            # S2-A-00 — usamos `batch_size` también en single-query para
            # que `sentence-transformers` no monte un batch implícito que
            # se desborde. Para 5 pairs el batch_size es irrelevante,
            # pero documentamos la decisión.
            scores = self._predict(pairs)
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

    def batch_rerank(
        self,
        queries_with_candidates: List[Tuple[str, List[Dict[str, Any]]]],
        top_n: int = 3,
        *,
        max_input_candidates: int = DEFAULT_TOP_N,
    ) -> List[List[Tuple[Dict[str, Any], float]]]:
        """S2-A-00 — Rerankea N queries en un solo forward pass.

        Acumula los pairs de todas las queries en una sola lista, llama a
        ``model.predict`` con batching nativo del cross-encoder (sentence-
        transformers usa ``batch_size`` interno por defecto), y devuelve
        los resultados ordenados por score por cada query.

        Throughput esperado: con SWARM_CONCURRENCY=8 partidas y 5 candidates
        por partida = 40 pairs en un solo forward pass. En CPU, esto baja
        de ~80s (8 calls × 10s c/u secuenciales) a ~12-15s (1 call con
        batching nativo). Speedup ~6x.

        Args:
          queries_with_candidates: lista de tuplas ``(query, [candidates])``.
            Cada query es la descripción de una partida; los candidates
            son los dicts del hybrid search para esa partida.
          top_n: número de candidates a devolver por query.
          max_input_candidates: máximo de candidates por query que se
            pasan al cross-encoder (truncados desde el principio,
            asumiendo orden pre-existente por score).

        Returns:
          Lista de listas: para cada query, una lista de
          ``(candidate_dict, score)`` ordenada por score descendente,
          hasta ``top_n`` elementos. Si una query no tiene candidates
          válidos, devuelve `[]` para esa posición.
        """
        if not queries_with_candidates:
            return []

        # Truncamos candidates por query y filtramos los sin description.
        per_query_valid: List[List[Dict[str, Any]]] = []
        for query, candidates in queries_with_candidates:
            valid = [
                c for c in (candidates or [])
                if (c.get("description") or "").strip()
            ]
            if len(valid) > max_input_candidates:
                valid = valid[:max_input_candidates]
            per_query_valid.append(valid)

        # Construimos pairs y un índice de mapeo (qué query produjo qué pair).
        all_pairs: List[Tuple[str, str]] = []
        # `pair_index[i] = (query_idx, candidate_idx_in_query)`
        pair_index: List[Tuple[int, int]] = []
        for q_idx, (query_tuple, valid) in enumerate(
            zip(queries_with_candidates, per_query_valid)
        ):
            query = query_tuple[0]
            for c_idx, c in enumerate(valid):
                all_pairs.append((query, c["description"]))
                pair_index.append((q_idx, c_idx))

        # Si no hay pairs (todas las queries sin candidates válidos),
        # devolvemos lista de listas vacías.
        if not all_pairs:
            return [[] for _ in queries_with_candidates]

        try:
            all_scores = self._predict(all_pairs)
        except Exception as e:
            logger.warning(
                f"[BgeReranker] batch predict failed ({type(e).__name__}: {e}); "
                f"returning input order with score=0.0"
            )
            # Fallback: devolvemos los primeros top_n de cada query con score 0.
            return [
                [(c, 0.0) for c in valid[:top_n]]
                for valid in per_query_valid
            ]

        # Dispatch de scores a sus queries.
        per_query_scored: List[List[Tuple[Dict[str, Any], float]]] = [
            [] for _ in queries_with_candidates
        ]
        for i, (q_idx, c_idx) in enumerate(pair_index):
            cand = per_query_valid[q_idx][c_idx]
            per_query_scored[q_idx].append((cand, float(all_scores[i])))

        # Ordenamos por score descendente y truncamos a top_n por query.
        result: List[List[Tuple[Dict[str, Any], float]]] = []
        for scored in per_query_scored:
            scored.sort(key=lambda cs: -cs[1])
            result.append(scored[:top_n])
        return result

    def _predict(self, pairs: Sequence[Tuple[str, str]]) -> Sequence[float]:
        """Wrapper sobre `model.predict` que intenta pasar `batch_size` si
        el backend lo soporta. Si la firma del fake/real model no lo
        acepta, cae al predict simple.

        Centralizado para que tanto `rerank` como `batch_rerank` paguen
        el mismo coste y comportamiento.
        """
        if self.model is None:
            raise RuntimeError("BgeReranker.model is None — cannot predict")
        try:
            return self.model.predict(pairs, batch_size=self.batch_size)
        except TypeError:
            # Fakes (tests) o backends antiguos sin kwarg `batch_size`.
            return self.model.predict(pairs)
