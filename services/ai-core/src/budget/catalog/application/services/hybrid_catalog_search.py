"""S1-A-02 — HybridCatalogSearch: BM25 in-memory + Vector search + RRF.

El catálogo COAATMCA 2025 contiene 1,661 items con jerga técnica española
densa. El vector search solo (Gemini embedding) tiene dos puntos débiles:

  1. Pierde keywords técnicas exactas (códigos, nomenclatura específica).
  2. Es caro de actualizar si el catálogo crece (recalcular embeddings).

BM25 in-memory complementa con coincidencia léxica clásica. La combinación
con Reciprocal Rank Fusion (RRF) saca lo mejor de ambos:

  - Si una keyword exacta está en una sola partida → BM25 la coloca top-1.
  - Si la query es semántica suelta → vector coloca el item top-1.
  - Items presentes en ambos tops ganan score combinado y se imponen.

Coste de memoria: ~1,661 items × ~100B de tokens = ~165KB; el BM25 index
añade ~2× sobre eso ≈ ~330KB. Es despreciable en el worker (2GiB RAM).

Latencia: el BM25 tarda <10ms para queries de 5-10 tokens sobre 1,661 docs.
El vector search es la pieza lenta (Firestore I/O ~50-100ms). Total <150ms.
"""
from __future__ import annotations

import inspect
import logging
import re
from typing import Any, Dict, List, Optional

from rank_bm25 import BM25Okapi

from src.budget.application.ports.ports import IVectorSearch
from src.budget.catalog.domain.price_book_entry import PriceBookItemEntry

logger = logging.getLogger(__name__)


# ---- Tokenization ---------------------------------------------------------

# Stopwords mínimas en español — palabras conectivas frecuentes que añaden
# ruido al BM25 sin mejorar discriminación. Mantenemos cortas porque algunas
# del construction-tech (en/de/con/por) sí cargan información a veces.
_SPANISH_STOPWORDS = {
    "a", "al", "de", "del", "el", "la", "los", "las",
    "un", "una", "y", "o", "u", "que", "se", "es",
    "con", "sin", "para", "por", "en", "lo",
}

# Splitter: cualquier secuencia de NO-word-character (puntuación, espacios,
# guiones, =, %, etc.). Preservamos caracteres unicode (acentos, ñ).
_TOKEN_SPLIT_RE = re.compile(r"[^\w]+", re.UNICODE)


def tokenize_es(text: Optional[str]) -> List[str]:
    """Tokeniza texto en español para indexación BM25.

    - Lowercase.
    - Splits on no-word characters (incluye guiones, comas, =, %, etc.).
    - Filtra tokens < 2 caracteres (típicamente ruido como 'm', 's').
    - Filtra stopwords de la lista mínima `_SPANISH_STOPWORDS`.

    No hace stemming todavía: las partidas son ya muy específicas y un
    stemmer agresivo (Porter/Snowball) puede perder discriminación
    técnica (ej: 'pintura' vs 'pintar'). Si Sprint 3 demuestra que sí
    ayuda, se incorporará entonces.
    """
    if not text:
        return []
    lowered = text.lower()
    tokens = _TOKEN_SPLIT_RE.split(lowered)
    return [t for t in tokens if len(t) >= 2 and t not in _SPANISH_STOPWORDS]


# ---- Reciprocal Rank Fusion ----------------------------------------------


def reciprocal_rank_fusion(
    rankings: List[List[str]],
    *,
    rrf_k: int = 60,
) -> List[tuple[str, float]]:
    """Combina varios rankings de IDs en uno solo con RRF.

    Fórmula clásica (Cormack et al. 2009):
        score(d) = sum_i  1 / (k + rank_i(d))

    donde ``rank_i(d)`` es la posición (0-based) del item ``d`` en el
    i-ésimo ranking. Items ausentes en un ranking simplemente no
    contribuyen score desde ese ranking.

    ``rrf_k`` = 60 es el valor original del paper; típicamente robusto.
    Valores más bajos enfatizan más los top-K; valores más altos suavizan
    el efecto de los rankings individuales.

    Devuelve lista de (item_id, score) ordenada por score descendente.
    """
    if not rankings:
        return []
    scores: Dict[str, float] = {}
    for ranking in rankings:
        for rank, item_id in enumerate(ranking):
            scores[item_id] = scores.get(item_id, 0.0) + 1.0 / (rrf_k + rank)
    # Stable sort: empates preservan el orden de descubrimiento.
    return sorted(scores.items(), key=lambda kv: -kv[1])


# ---- HybridCatalogSearch -------------------------------------------------


class HybridCatalogSearch:
    """Search híbrido BM25 + Vector + RRF sobre el catálogo COAATMCA.

    El catálogo se carga una sola vez al boot (1,661 items). El BM25 vive
    en memoria; el vector search delega al ``IVectorSearch`` adapter
    inyectado (Firestore en producción, fake en tests).

    Uso típico:
        svc = HybridCatalogSearch(items, vector_search)
        candidates = await svc.search(
            query="solera hormigón HM-20",
            query_vector=embedding_de_la_query,
            top_k=15,
            chapter_filter="03 HORMIGONES",
            unit_dimension_filter="surface_area",
        )
    """

    # Pool size de candidatos por fuente antes del RRF. El plan dice top-30;
    # con 1,661 items eso es ~2% del catálogo, suficiente para que el RRF
    # converja sin inflar memoria.
    _PER_SOURCE_CANDIDATES: int = 30

    def __init__(
        self,
        catalog_items: List[PriceBookItemEntry],
        vector_search: IVectorSearch,
        *,
        rrf_k: int = 60,
    ) -> None:
        self.catalog_items = list(catalog_items)
        self.vector_search = vector_search
        self.rrf_k = rrf_k
        self._items_by_code: Dict[str, PriceBookItemEntry] = {
            it.code: it for it in self.catalog_items
        }
        self._index_codes: List[str] = [it.code for it in self.catalog_items]
        # Tokenizamos cada item con su descripción + unit_raw para que tanto
        # texto descriptivo como unidad alimenten el BM25.
        self._tokenized: List[List[str]] = [
            tokenize_es(f"{it.description} {it.unit_raw}")
            for it in self.catalog_items
        ]
        # BM25Okapi requires non-empty tokenization to avoid div-by-zero.
        # En catálogo vacío saltamos la construcción del índice; las queries
        # devuelven lista vacía.
        if self._tokenized and any(self._tokenized):
            self._bm25: Optional[BM25Okapi] = BM25Okapi(self._tokenized)
        else:
            self._bm25 = None
        logger.info(
            f"[HybridCatalogSearch] indexed {len(self.catalog_items)} items "
            f"(bm25_built={self._bm25 is not None})"
        )

    def _bm25_search(
        self,
        query_tokens: List[str],
        *,
        chapter_filter: Optional[str] = None,
        unit_dimension_filter: Optional[str] = None,
        limit: int = 30,
    ) -> List[str]:
        """Devuelve los ``limit`` codes con mejor score BM25 para la query.

        Aplica filtros estructurales DESPUÉS de calcular scores (BM25Okapi
        no soporta filtros nativos). Para 1,661 items es despreciable.
        Items con score cero quedan fuera (no aportan información).
        """
        if not self._bm25 or not query_tokens:
            return []
        scores = self._bm25.get_scores(query_tokens)
        # Asociar score con index para luego filtrar.
        scored: List[tuple[int, float]] = [
            (i, s) for i, s in enumerate(scores) if s > 0
        ]
        # Filtrar por chapter/unit_dim si aplica.
        filtered: List[tuple[int, float]] = []
        for idx, score in scored:
            item = self.catalog_items[idx]
            if chapter_filter and item.chapter != chapter_filter:
                continue
            if (
                unit_dimension_filter
                and item.unit_dimension
                and item.unit_dimension != unit_dimension_filter
            ):
                continue
            filtered.append((idx, score))
        # Top-limit por score desc.
        filtered.sort(key=lambda x: -x[1])
        return [self.catalog_items[i].code for i, _ in filtered[:limit]]

    async def _vector_search(
        self,
        query_vector: List[float],
        query_text: str,
        *,
        chapter_filter: Optional[str] = None,
        unit_dimension_filter: Optional[str] = None,
        limit: int = 30,
    ) -> List[str]:
        """Wrap del IVectorSearch para extraer solo los codes."""
        chapter_filters = [chapter_filter] if chapter_filter else None
        try:
            res = self.vector_search.search_similar_items(
                query_vector=query_vector,
                query_text=query_text,
                limit=limit,
                chapter_filters=chapter_filters,
                partida_unit_dimension=unit_dimension_filter,
            )
            # Backwards-compat: el port declara async pero el adapter
            # Firestore es sync. Aceptamos ambos.
            results = await res if inspect.isawaitable(res) else res
        except Exception as e:
            logger.warning(f"[HybridCatalogSearch] vector_search failed: {e}")
            return []
        return [r.get("code") or r.get("id") for r in results if r.get("id") or r.get("code")]

    async def search(
        self,
        query: str,
        query_vector: List[float],
        *,
        top_k: int = 15,
        chapter_filter: Optional[str] = None,
        unit_dimension_filter: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Búsqueda híbrida combinada.

        Args:
          query: texto de la query (para BM25 y log).
          query_vector: embedding de la query (para vector search).
          top_k: número final de candidatos a devolver.
          chapter_filter: si se pasa, restringe BM25 al capítulo y empuja
            el filtro hacia el vector search adapter (que decide cómo
            aplicarlo).
          unit_dimension_filter: idem para la dimensión física de la unidad.

        Returns:
          Lista de dicts (forma equivalente a la del IVectorSearch adapter)
          ordenados por score combinado descendente. Cada dict incluye:
          ``code``, ``description``, ``unit``, ``chapter``, ``priceTotal``,
          ``unit_dimension``, ``matchScore`` (heredado del vector si está,
          si no 1.0 por sigo de BM25), y ``_hybrid_rrf_score`` para auditoría.
        """
        if not query.strip():
            return []
        if not self.catalog_items:
            return []

        # Sprint 4 Fase G — best-effort chapter_filter:
        #
        # Las taxonomías de capítulos del PDF cliente (`"1 ACTUACIONES PREVIAS"`,
        # `"C01 TRABAJOS PREVIOS"`, `"21 PATOLOGÍAS GRAVES"`) y del catálogo
        # COAATMCA (`"DEMOLICIONES"`, `"HORMIGONES"`, `"FORJADOS"`) son
        # sistemáticamente distintas — cliente organiza por orden de obra,
        # catálogo por familia técnica.
        #
        # Pre-Sprint 4 no afloró: el LLM Vision NO extraía capítulos (todos
        # `"Sin Capítulo"` → filter=None → search funcionaba sobre todo el
        # catálogo). Sprint 4 extrae chapter_rate=100% → activamos filter →
        # 0 docs match → cae a `from_scratch` masivamente.
        #
        # Best-effort: primero con chapter_filter (precisión si las taxonomías
        # coinciden — futuro-proof). Si vacío, retry SIN filter (cobertura
        # cuando no coinciden).
        results = await self._do_search(
            query=query,
            query_vector=query_vector,
            top_k=top_k,
            chapter_filter=chapter_filter,
            unit_dimension_filter=unit_dimension_filter,
        )
        if not results and chapter_filter:
            logger.info(
                "[HybridCatalogSearch] búsqueda vacía con chapter_filter=%r — "
                "retry sin filter (best-effort por mismatch taxonomía).",
                chapter_filter,
            )
            results = await self._do_search(
                query=query,
                query_vector=query_vector,
                top_k=top_k,
                chapter_filter=None,
                unit_dimension_filter=unit_dimension_filter,
            )
        return results

    async def _do_search(
        self,
        *,
        query: str,
        query_vector: List[float],
        top_k: int,
        chapter_filter: Optional[str],
        unit_dimension_filter: Optional[str],
    ) -> List[Dict[str, Any]]:
        """Una iteración de búsqueda híbrida BM25 + Vector + RRF.

        Separado de `search()` para permitir el retry best-effort sin
        duplicar lógica.
        """
        query_tokens = tokenize_es(query)

        # 1. BM25 candidates (no I/O, syncrono).
        bm25_codes = self._bm25_search(
            query_tokens,
            chapter_filter=chapter_filter,
            unit_dimension_filter=unit_dimension_filter,
            limit=self._PER_SOURCE_CANDIDATES,
        )

        # 2. Vector candidates (I/O contra Firestore en producción).
        vector_codes = await self._vector_search(
            query_vector,
            query_text=query,
            chapter_filter=chapter_filter,
            unit_dimension_filter=unit_dimension_filter,
            limit=self._PER_SOURCE_CANDIDATES,
        )

        logger.debug(
            f"[HybridCatalogSearch] q={query[:60]!r} bm25={len(bm25_codes)} "
            f"vec={len(vector_codes)} chap_filter={chapter_filter!r}"
        )

        # 3. RRF — fusiona ambos rankings en uno.
        fused = reciprocal_rank_fusion(
            [bm25_codes, vector_codes], rrf_k=self.rrf_k
        )

        # 4. Re-aplicar filtros estructurales (defensivo) y materializar
        # los items con sus metadatos. Solo top_k.
        out: List[Dict[str, Any]] = []
        for code, score in fused[:top_k]:
            item = self._items_by_code.get(code)
            if item is None:
                continue
            if chapter_filter and item.chapter != chapter_filter:
                continue
            if (
                unit_dimension_filter
                and item.unit_dimension
                and item.unit_dimension != unit_dimension_filter
            ):
                continue
            out.append({
                "id": item.code,
                "code": item.code,
                "description": item.description,
                "unit": item.unit_raw,
                "unit_normalized": item.unit_normalized,
                "unit_dimension": item.unit_dimension,
                "chapter": item.chapter,
                "section": item.section,
                "priceTotal": item.priceTotal,
                # matchScore: usamos el RRF score normalizado como proxy.
                # Si Sprint 1 demuestra que esto degrada el tier selector,
                # se reemplaza por el cross-encoder reranker (S1-A-03).
                "matchScore": score,
                "_hybrid_rrf_score": score,
            })

        return out
