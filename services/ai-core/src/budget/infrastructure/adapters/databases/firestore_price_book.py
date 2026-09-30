import logging
import math
from typing import Any, Dict, List, Optional

from firebase_admin import firestore
from google.cloud.firestore_v1.base_query import FieldFilter
from google.cloud.firestore_v1.base_vector_query import DistanceMeasure
from google.cloud.firestore_v1.vector import Vector

from src.budget.application.ports.ports import IVectorSearch
from src.budget.catalog.application.services.hybrid_catalog_search import tokenize_es
from src.budget.catalog.catalog_config import price_book_collection
from src.budget.catalog.domain.unit import dimension_mismatch

logger = logging.getLogger(__name__)

# Factor de degradación aplicado al `matchScore` cuando la unidad del
# candidato no es compatible dimensionalmente con la partida. No se excluye
# el candidato — el Judge aguas abajo decide; solo se le baja el ranking.
# La compatibilidad es la "blanda" de `unit.dimension_mismatch` (no penaliza
# pares puenteables ni partidas pa/%/h).
_DIMENSIONAL_MISMATCH_FACTOR = 0.3

# P2 — Down-weight de procedencia. Las partidas from_scratch que el constructor
# guarda en su libro desde el editor se etiquetan `source == "ai_generated"` en
# la MISMA colección del libro (con `kind="item"` y embedding 768). El vector
# search las surfacea junto al catálogo oficial COAATMCA. Hasta estar validadas
# NO deben competir de igual a igual: se degrada su `matchScore` por este factor
# para que, ante scores similares, gane el match oficial. NO se excluyen — el
# Judge/rerank aguas abajo sigue viéndolas; solo se relegan.
# 0.85 = penalización suave (~15%), suficiente para romper empates sin enterrar
# un buen match de IA cuando no hay alternativa oficial cercana.
_AI_GENERATED_SOURCE_FACTOR = 0.85

# Peso del boost léxico: matchScore = coseno × (1 + _LEXICAL_BOOST_WEIGHT × cobertura),
# con cobertura = fracción de tokens de la query presentes en el candidato.
_LEXICAL_BOOST_WEIGHT = 0.5
# Longitud mínima de token (tras plegar tildes y quitar stopwords) para contar
# en el boost léxico — descarta ruido tipo "m2", "de", "hm".
_LEXICAL_MIN_TOKEN_LEN = 3

# Solo partidas: los ~10.6k docs `kind="breakdown"` (86 % del índice) repiten
# la descripción de su partida padre y antes ocupaban el top-K del vector, que
# luego se descartaba aguas abajo (pedíamos 15 y llegaban 8-14). El pre-filtro
# usa el índice vectorial compuesto `kind ASC + embedding` (READY).
_KIND_FIELD = "kind"
_KIND_ITEM = "item"

# Campo donde Firestore devuelve la DISTANCIA calculada por `find_nearest`.
# Con COSINE, distancia = 1 − similitud coseno → no hace falta descargar el
# embedding de cada candidato para recalcular el coseno.
_DISTANCE_FIELD = "_vector_distance"

# Proyección (`select`) de los campos que consume el pipeline aguas abajo
# (híbrido, reranker, Judge, herencia de descompuesto). Excluye `embedding`
# (768 floats × hasta 90 docs por consulta). Si el backend rechazara la
# proyección junto a `find_nearest`, el adapter reintenta sin ella (ver
# `_run_vector_query`) y recalcula el coseno desde el embedding.
_PROJECTED_FIELDS: List[str] = [
    "code",
    "description",
    "unit",
    "unit_raw",
    "unit_normalized",
    "unit_dimension",
    "chapter",
    "section",
    "priceTotal",
    "priceLabor",
    "priceMaterial",
    "kind",
    "source",
    "search_aliases",
    "breakdown",
    "breakdown_ids",
    "is_variable",
    "year",
    "source_book",
    "matchKind",
]


def _lexical_tokens(text: Optional[str]) -> set:
    """Tokens para el boost léxico: mismo tokenizador que el BM25 (tildes
    plegadas, stopwords fuera, singular/plural ligero) y longitud ≥ 3."""
    return {t for t in tokenize_es(text) if len(t) >= _LEXICAL_MIN_TOKEN_LEN}


class FirestorePriceBookAdapter(IVectorSearch):
    """Adapter de vector search sobre la colección activa del libro de precios.

    La colección contiene documentos de dos `kind`:
      - `item`: la partida padre del libro (LVC010, etc.).
      - `breakdown`: un componente individual de una partida.

    El vector search se restringe a `kind == "item"` (pre-filtro nativo con
    índice compuesto). Los breakdowns ya no compiten por el top-K.

    Scores en cada resultado:
      - `_cosine_raw`: similitud coseno PURA query↔partida (1 − distancia).
      - `matchScore`: coseno con boosts/penalizaciones (léxico, dimensional,
        procedencia). Es el que ordena la lista devuelta.

    Filtro dimensional opcional: cuando el caller pasa la
    `partida_unit_dimension`, los candidatos con dimensión incompatible ven su
    `matchScore` degradado por `_DIMENSIONAL_MISMATCH_FACTOR`. Nunca se
    excluyen. Los candidatos sin `unit_dimension` no se degradan.

    `chapter_filters` se acepta por compatibilidad del puerto pero YA NO se
    aplica como pre-filtro: no existe índice `kind + chapter + embedding` y el
    capítulo del presupuesto casi nunca coincide con la taxonomía del libro.
    El capítulo es ahora una señal blanda en `HybridCatalogSearch`.
    """

    def __init__(self, db: Optional[Any] = None) -> None:
        # db inyectable para tests; en producción default al cliente de
        # firebase_admin inicializado globalmente.
        self.db = db if db is not None else firestore.client()
        # None = desconocido; False = el backend rechazó la proyección con
        # find_nearest → no volver a intentarla en este proceso.
        self._projection_supported: Optional[bool] = None

    def _cosine_similarity(self, vec_a: List[float], vec_b: List[float]) -> float:
        if len(vec_a) != len(vec_b):
            return 0.0
        dot_product = sum(a * b for a, b in zip(vec_a, vec_b))
        norm_a = math.sqrt(sum(a * a for a in vec_a))
        norm_b = math.sqrt(sum(b * b for b in vec_b))
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return dot_product / (norm_a * norm_b)

    def _build_vector_query(
        self, query_vector: List[float], limit: int, *, project: bool
    ):
        query = self.db.collection(price_book_collection()).where(
            filter=FieldFilter(_KIND_FIELD, "==", _KIND_ITEM)
        )
        if project and hasattr(query, "select"):
            # El campo de distancia debe ir en la proyección (patrón de la doc
            # oficial: `select([..., "vector_distance"]).find_nearest(...)`).
            query = query.select(_PROJECTED_FIELDS + [_DISTANCE_FIELD])
        return query.find_nearest(
            vector_field="embedding",
            query_vector=Vector(query_vector),
            distance_measure=DistanceMeasure.COSINE,
            limit=limit,
            distance_result_field=_DISTANCE_FIELD,
        )

    def _run_vector_query(self, query_vector: List[float], limit: int) -> List[Any]:
        """Ejecuta el find_nearest (kind==item) intentando primero la versión
        proyectada (sin embeddings). Si el backend la rechaza, o si la
        respuesta llega sin distancia NI embedding (no podríamos calcular el
        coseno), reintenta sin proyección y memoriza la decisión."""
        if self._projection_supported is not False:
            try:
                docs = list(
                    self._build_vector_query(query_vector, limit, project=True).get()
                )
                if docs:
                    sample = docs[0].to_dict() or {}
                    if _DISTANCE_FIELD not in sample and not sample.get("embedding"):
                        raise ValueError("respuesta proyectada sin distancia ni embedding")
                self._projection_supported = True
                return docs
            except Exception as e:
                logger.warning(
                    "[price_book_vector] proyección con find_nearest no disponible "
                    f"({type(e).__name__}: {e}); se usa la consulta completa."
                )
                self._projection_supported = False
        return list(self._build_vector_query(query_vector, limit, project=False).get())

    def search_similar_items(
        self,
        query_vector: List[float],
        query_text: str = "",
        limit: int = 3,
        score_threshold: float = 0.5,
        chapter_filters: Optional[List[str]] = None,
        partida_unit_dimension: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Firestore vector search (solo partidas) con reranking léxico +
        degradación dimensional + down-weight de procedencia.

        Args:
          query_vector: embedding de la query (se trunca a 768 por compat).
          query_text: texto original — habilita reranking léxico si no vacío.
          limit: número de candidatos a devolver tras reranking.
          score_threshold: umbral (actualmente informativo, no filtra).
          chapter_filters: IGNORADO (compat del puerto) — ver docstring de clase.
          partida_unit_dimension: si se pasa, degradamos candidatos con
            `unit_dimension` incompatible para que queden al final del ranking.
        """
        try:
            # Firestore vector length safety truncation.
            query_vector = query_vector[:768]
            if chapter_filters:
                logger.debug(
                    "[price_book_vector] chapter_filters=%r ignorado (señal blanda "
                    "en el híbrido; no hay índice kind+chapter+embedding).",
                    chapter_filters,
                )

            # Pool más amplio para el reranking léxico.
            candidate_limit = limit * 3 if query_text else limit
            docs = self._run_vector_query(query_vector, candidate_limit)

            candidates: List[Dict[str, Any]] = []
            for doc in docs:
                data = doc.to_dict() or {}
                # Defensa: si algún doc sin `kind` o con otro kind se colara
                # (fakes / datos legacy), lo descartamos aquí también.
                kind = data.get(_KIND_FIELD)
                if kind is not None and kind != _KIND_ITEM:
                    continue

                distance = data.pop(_DISTANCE_FIELD, None)
                stored_embedding = data.pop("embedding", None)
                if distance is not None:
                    cosine = 1.0 - float(distance)
                elif stored_embedding:
                    cosine = self._cosine_similarity(query_vector, list(stored_embedding))
                else:
                    cosine = 0.0

                data["_cosine_raw"] = cosine
                data["matchScore"] = cosine
                data["id"] = doc.id
                candidates.append(data)

            # Boost léxico (tokens sin stopwords, tildes plegadas, len ≥ 3).
            if query_text:
                keywords = _lexical_tokens(query_text)
                if keywords:
                    for candidate in candidates:
                        aliases = candidate.get("search_aliases") or []
                        if not isinstance(aliases, list):
                            aliases = []
                        cand_tokens = _lexical_tokens(
                            f"{candidate.get('description') or ''} {' '.join(map(str, aliases))}"
                        )
                        coverage = len(keywords & cand_tokens) / len(keywords)
                        candidate["_lexical_coverage"] = round(coverage, 4)
                        candidate["matchScore"] *= (1 + _LEXICAL_BOOST_WEIGHT * coverage)

            # Degradación dimensional blanda.
            if partida_unit_dimension:
                for candidate in candidates:
                    if dimension_mismatch(
                        partida_unit_dimension, candidate.get("unit_dimension")
                    ):
                        candidate["matchScore"] *= _DIMENSIONAL_MISMATCH_FACTOR

            # P2 — Down-weight de procedencia `ai_generated` (siempre).
            for candidate in candidates:
                if candidate.get("source") == "ai_generated":
                    candidate["matchScore"] *= _AI_GENERATED_SOURCE_FACTOR

            candidates.sort(key=lambda x: x.get("matchScore", 0), reverse=True)
            return candidates[:limit]

        except Exception as e:
            logger.error(f"Failed to execute native Firestore hybrid search: {str(e)}")
            return []
