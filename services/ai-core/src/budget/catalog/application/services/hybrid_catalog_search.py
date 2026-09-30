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

Arreglos de recuperación (2026-09):
  - El vector search solo devuelve partidas (`kind == "item"`); antes el top-K
    se llenaba de breakdowns que se descartaban después del corte.
  - Cada ranking se deduplica antes del RRF y se descartan códigos ajenos al
    catálogo en memoria ANTES de cortar a `top_k` → siempre `top_k` si existen.
  - Capítulo y unidad son señales BLANDAS (bonus/penalización multiplicativa
    sobre el score fusionado), no filtros → desaparece el reintento "sin filtro".
  - Tokenización con plegado de tildes y singular/plural ligero.
"""
from __future__ import annotations

import inspect
import logging
import re
import unicodedata
from typing import Any, Dict, List, Optional

from rank_bm25 import BM25Okapi

from src.budget.application.ports.ports import IVectorSearch
from src.budget.catalog.domain.price_book_entry import PriceBookItemEntry
from src.budget.catalog.domain.unit import dimension_mismatch

logger = logging.getLogger(__name__)

# ---- Señales blandas sobre el score fusionado (RRF) ------------------------
#
# Escala de referencia: con rrf_k=60, el top-1 de UN ranking aporta 1/60≈0.0167
# y el top-1 de ambos ≈0.0333. Las señales son MULTIPLICATIVAS sobre el score
# RRF, se aplican ANTES del corte a top_k y nunca excluyen candidatos.

# BONUS de capítulo: el capítulo de la partida (normalizado, sin prefijo
# numérico) casa por prefijo con el capítulo del candidato en la taxonomía del
# libro. Pequeño (+8 %): desempata entre candidatos cercanos, no rescata
# candidatos lejanos. Si el capítulo de la partida no casa con ninguno del
# libro, la señal se ignora (taxonomías cliente ≠ libro son lo habitual).
CHAPTER_MATCH_BONUS_FACTOR = 1.08

# PENALIZACIÓN de unidad: la dimensión física del candidato es incompatible con
# la de la partida (`unit.dimension_mismatch`: no penaliza pares puenteables
# superficie↔volumen / lineal↔discreto ni partidas pa/%/h ni dimensiones
# desconocidas). ×0.5 ≈ baja un top-1-de-ambos al nivel de un top-1-de-uno: el
# candidato sigue en el pool (el Judge puede convertir) pero cede el sitio.
UNIT_MISMATCH_PENALTY_FACTOR = 0.5


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


def fold_accents(text: Optional[str]) -> str:
    """Minúsculas + plegado de tildes/diacríticos vía NFKD (hormigón→hormigon,
    ñ→n, m²→m2). Idéntico para índice y consulta."""
    if not text:
        return ""
    decomposed = unicodedata.normalize("NFKD", text.lower())
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


# Letras tras las que el plural español añade "-es" (pared-es, tablón-es,
# interior-es, red-es, reloj-es). En esos casos se quita "es" completo.
_PLURAL_ES_PRECEDING = frozenset("lnrdj")


def light_singular_es(token: str) -> str:
    """Singular/plural LIGERO (no es un stemmer): colapsa el plural regular.

      - len ≥ 5, termina en "es" y la letra anterior ∈ {l,n,r,d,j} → quita "es"
        (paredes→pared, tablones→tablon, interiores→interior).
      - si no, len ≥ 4 y termina en "s" (pero no "ss") → quita "s"
        (tabiques→tabique, baldosas→baldosa, morteros→mortero).

    Se aplica igual al indexar y al consultar, así que singular y plural casan.
    """
    if len(token) >= 5 and token.endswith("es") and token[-3] in _PLURAL_ES_PRECEDING:
        return token[:-2]
    if len(token) >= 4 and token.endswith("s") and not token.endswith("ss"):
        return token[:-1]
    return token


def tokenize_es(text: Optional[str]) -> List[str]:
    """Tokeniza texto en español para indexación BM25 (y boost léxico).

    - Minúsculas + plegado de tildes (NFKD): "Hormigón" → "hormigon".
    - Splits on no-word characters (incluye guiones, comas, =, %, etc.).
    - Filtra tokens < 2 caracteres (típicamente ruido como 'm', 's').
    - Filtra stopwords de la lista mínima `_SPANISH_STOPWORDS`.
    - Singular/plural ligero (`light_singular_es`).

    Sin stemming agresivo (Porter/Snowball): las partidas son muy
    específicas y un stemmer fuerte pierde discriminación técnica
    (ej: 'pintura' vs 'pintar').
    """
    if not text:
        return []
    tokens = _TOKEN_SPLIT_RE.split(fold_accents(text))
    return [
        light_singular_es(t)
        for t in tokens
        if len(t) >= 2 and t not in _SPANISH_STOPWORDS
    ]


# ---- Taxonomía de capítulos (señal blanda) ------------------------------

# Prefijos numéricos de capítulo en presupuestos de cliente: "01 ", "C01 ",
# "1.", "1. ", "01.02 ", "CAP. 3 ", "CAPITULO 04 - ".
_CHAPTER_NUM_PREFIX_RE = re.compile(
    r"^\s*(?:CAP(?:ITULO)?\.?\s*)?[A-Z]?\d+(?:[.\-]\d+)*\s*[.\-)]?\s*"
)
# Longitud mínima de la parte común para aceptar un casado por prefijo (evita
# que "C" o "OBRA" casen con medio catálogo).
_CHAPTER_PREFIX_MIN_LEN = 5


def normalize_chapter_name(chapter: Optional[str], *, strip_numeric_prefix: bool = True) -> str:
    """Normaliza un nombre de capítulo para compararlo con la taxonomía del
    libro: MAYÚSCULAS, sin tildes, sin «…»/«...» ni puntos finales, espacios
    colapsados y (opcional) sin prefijo numérico tipo "01 ", "C01 ", "1.".
    """
    if not chapter:
        return ""
    s = fold_accents(chapter).upper()
    s = s.replace("…", " ").replace("...", " ")
    s = re.sub(r"\s+", " ", s).strip()
    if strip_numeric_prefix:
        stripped = _CHAPTER_NUM_PREFIX_RE.sub("", s, count=1).strip()
        if stripped:
            s = stripped
    s = s.rstrip(" .").strip()
    return s


# ---- Código base CYPE / FIEBDC -------------------------------------------

# Los libros base (CYPE / Generador de Precios, COAATMCA) codifican las
# partidas como 3 letras + 3 dígitos (p.ej. `ADL010`, `EHS010`, `CAV010`). Las
# variantes de un mismo concepto añaden sufijo (`CAV010M2`, `EHM010M3`) o más
# dígitos (`EHS01044`). El "código base" recorta a la raíz LLL+NNN para poder
# casar variantes contra la entrada canónica del catálogo.
_CYPE_BASE_RE = re.compile(r"^([A-Za-z]{2,4}\d{3})")


def cype_base_code(code: Optional[str]) -> Optional[str]:
    """Raíz canónica de un código CYPE (`CAV010M2` → `CAV010`), o None si el
    código no sigue el patrón LLL+NNN (p.ej. códigos propios `04.03`, `ZTPB`)."""
    if not code:
        return None
    m = _CYPE_BASE_RE.match(code.strip())
    return m.group(1).upper() if m else None


# ---- Reciprocal Rank Fusion ----------------------------------------------


def dedupe_ranking(ranking: List[str]) -> List[str]:
    """Quita duplicados de un ranking conservando la PRIMERA aparición (mejor
    rango). Un código debe contar una sola vez por ranking en el RRF."""
    seen: set = set()
    out: List[str] = []
    for item_id in ranking:
        if item_id and item_id not in seen:
            seen.add(item_id)
            out.append(item_id)
    return out


def reciprocal_rank_fusion(
    rankings: List[List[str]],
    *,
    rrf_k: int = 60,
    weights: Optional[List[float]] = None,
) -> List[tuple[str, float]]:
    """Combina varios rankings de IDs en uno solo con RRF.

    Fórmula clásica (Cormack et al. 2009), con peso opcional por ranking:
        score(d) = sum_i  w_i / (k + rank_i(d))

    donde ``rank_i(d)`` es la posición (0-based) del item ``d`` en el
    i-ésimo ranking (ya deduplicado: un id cuenta UNA vez por ranking, en su
    mejor posición). Items ausentes en un ranking no contribuyen score desde
    ese ranking. ``weights`` por defecto = 1.0 para todos.

    ``rrf_k`` = 60 es el valor original del paper; típicamente robusto.

    Devuelve lista de (item_id, score) ordenada por score descendente.
    """
    if not rankings:
        return []
    scores: Dict[str, float] = {}
    for i, ranking in enumerate(rankings):
        w = 1.0 if weights is None or i >= len(weights) else float(weights[i])
        for rank, item_id in enumerate(dedupe_ranking(ranking)):
            scores[item_id] = scores.get(item_id, 0.0) + w / (rrf_k + rank)
    # Stable sort: empates preservan el orden de descubrimiento.
    return sorted(scores.items(), key=lambda kv: -kv[1])


# ---- HybridCatalogSearch -------------------------------------------------
class HybridCatalogSearch:
    """Search híbrido BM25 + Vector + RRF sobre el catálogo del libro.

    El catálogo (solo `kind="item"`) se carga una sola vez al boot. El BM25
    vive en memoria; el vector search delega al ``IVectorSearch`` adapter
    inyectado (Firestore en producción, fake en tests).

    Capítulo y unidad son SEÑALES BLANDAS (bonus/penalización sobre el score
    fusionado), nunca filtros: así siempre salen ``top_k`` partidas si el
    catálogo las tiene.

    Uso típico:
        svc = HybridCatalogSearch(items, vector_search)
        candidates = await svc.search(
            query="solera hormigón HM-20",
            query_vector=embedding_de_la_query,
            top_k=15,
            chapter_filter="03 HORMIGONES",        # señal blanda (bonus)
            unit_dimension_filter="superficie",    # señal blanda (penalización)
        )
    """

    # Pool size de candidatos por fuente antes del RRF (~2 % del catálogo):
    # suficiente para que el RRF converja sin inflar memoria.
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
        # Índices para el matching CODE-FIRST (determinista, sin LLM): por código
        # exacto (case-insensitive) y por código base CYPE (LLL+NNN). El primero
        # visto gana cuando varias variantes comparten la misma raíz.
        self._items_by_code_ci: Dict[str, PriceBookItemEntry] = {}
        self._items_by_base_code: Dict[str, PriceBookItemEntry] = {}
        for it in self.catalog_items:
            self._items_by_code_ci.setdefault(it.code.strip().upper(), it)
            base = cype_base_code(it.code)
            if base:
                self._items_by_base_code.setdefault(base, it)
        # Taxonomía de capítulos del libro, normalizada una vez al boot (para la
        # señal blanda de capítulo). Hay capítulos truncados en origen
        # ("ELECTRICIDAD Y TELECOMUNICACI…") → se casa por prefijo.
        self._chapter_norm_by_code: Dict[str, str] = {
            it.code: normalize_chapter_name(it.chapter) for it in self.catalog_items
        }
        self._chapter_taxonomy: List[str] = sorted(
            {c for c in self._chapter_norm_by_code.values() if c}
        )
        self._chapter_match_cache: Dict[str, frozenset] = {}
        # Tokenizamos cada item con su descripción + unit_raw + search_aliases,
        # para que el BM25 (lado keyword del híbrido) también matchee la jerga
        # comercial/coloquial ("climalit", "riostra", "marés"…), no solo la
        # redacción técnica oficial.
        self._tokenized: List[List[str]] = [
            tokenize_es(
                f"{it.description} {it.unit_raw} "
                f"{' '.join(getattr(it, 'search_aliases', None) or [])}"
            )
            for it in self.catalog_items
        ]
        # BM25Okapi requires non-empty tokenization to avoid div-by-zero.
        if self._tokenized and any(self._tokenized):
            self._bm25: Optional[BM25Okapi] = BM25Okapi(self._tokenized)
        else:
            self._bm25 = None
        logger.info(
            f"[HybridCatalogSearch] indexed {len(self.catalog_items)} items "
            f"(bm25_built={self._bm25 is not None}, "
            f"chapters={len(self._chapter_taxonomy)})"
        )

    # ---- Code-first ------------------------------------------------------

    def lookup_by_code(self, code: Optional[str]) -> Optional[Dict[str, Any]]:
        """CODE-FIRST: resuelve una partida por su CÓDIGO contra el catálogo, sin
        LLM ni búsqueda semántica. Devuelve la entrada canónica (misma forma que
        un candidato de `search`, más `match_kind_code` ∈ {'exact','base'} y
        `catalog_code`) o None si el código no existe.

        Prioridad: coincidencia exacta (case-insensitive) → raíz base CYPE
        (`CAV010M2`→`CAV010`). Los códigos propios del autor (`04.03`, `ZTPB`)
        no tienen raíz CYPE → None → el pipeline cae a búsqueda semántica."""
        if not code:
            return None
        cu = code.strip().upper()
        item = self._items_by_code_ci.get(cu)
        match = "exact"
        if item is None:
            base = cype_base_code(cu)
            item = self._items_by_base_code.get(base) if base else None
            match = "base"
        if item is None:
            return None
        return {
            "id": item.code,
            "code": item.code,
            "catalog_code": item.code,
            "description": item.description,
            "unit": item.unit_raw,
            "unit_normalized": item.unit_normalized,
            "unit_dimension": item.unit_dimension,
            "chapter": item.chapter,
            "section": item.section,
            "priceTotal": item.priceTotal,
            "matchScore": 1.0,
            "match_kind_code": match,
            "_code_match": True,
        }

    # ---- Capítulo (señal blanda) ----------------------------------------

    def match_chapter(self, chapter: Optional[str]) -> frozenset:
        """Capítulos normalizados del LIBRO que casan con el capítulo de la
        partida: igualdad o prefijo en cualquier dirección (con una parte común
        de ≥ `_CHAPTER_PREFIX_MIN_LEN` caracteres). Vacío si no casa ninguno —
        en ese caso la señal de capítulo simplemente se ignora."""
        norm = normalize_chapter_name(chapter)
        if not norm:
            return frozenset()
        cached = self._chapter_match_cache.get(norm)
        if cached is not None:
            return cached
        matched = set()
        for cat in self._chapter_taxonomy:
            if cat == norm:
                matched.add(cat)
                continue
            shorter, longer = (cat, norm) if len(cat) <= len(norm) else (norm, cat)
            if len(shorter) >= _CHAPTER_PREFIX_MIN_LEN and longer.startswith(shorter):
                matched.add(cat)
        result = frozenset(matched)
        self._chapter_match_cache[norm] = result
        return result

    # ---- Fuentes ---------------------------------------------------------

    def _bm25_search(self, query_tokens: List[str], *, limit: int = 30) -> List[str]:
        """Devuelve los ``limit`` codes con mejor score BM25 para la query
        (sin filtros: capítulo/unidad son señales blandas posteriores).
        Items con score cero quedan fuera (no aportan información)."""
        if not self._bm25 or not query_tokens:
            return []
        scores = self._bm25.get_scores(query_tokens)
        scored: List[tuple[int, float]] = [
            (i, s) for i, s in enumerate(scores) if s > 0
        ]
        scored.sort(key=lambda x: -x[1])
        return dedupe_ranking(
            [self.catalog_items[i].code for i, _ in scored[: limit * 2]]
        )[:limit]

    async def _vector_search(
        self,
        query_vector: List[float],
        query_text: str,
        *,
        limit: int = 30,
    ) -> List[Dict[str, Any]]:
        """Wrap del IVectorSearch. Sin filtros de capítulo ni de unidad (son
        señales blandas del híbrido; pasarlos al adapter duplicaría la
        penalización). Devuelve los resultados COMPLETOS del adapter
        (``_cosine_raw`` + ``matchScore`` con boosts)."""
        try:
            res = self.vector_search.search_similar_items(
                query_vector=query_vector,
                query_text=query_text,
                limit=limit,
                chapter_filters=None,
                partida_unit_dimension=None,
            )
            # Backwards-compat: el port declara async pero el adapter
            # Firestore es sync. Aceptamos ambos.
            results = await res if inspect.isawaitable(res) else res
        except Exception as e:
            logger.warning(f"[HybridCatalogSearch] vector_search failed: {e}")
            return []
        return results or []

    # ---- Búsqueda --------------------------------------------------------

    async def search(
        self,
        query: str,
        query_vector: List[float],
        *,
        top_k: int = 15,
        chapter_filter: Optional[str] = None,
        unit_dimension_filter: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Búsqueda híbrida BM25 + vector + RRF con señales blandas.

        Args:
          query: texto de la query (BM25 + boost léxico del vector).
          query_vector: embedding de la query.
          top_k: número final de candidatos (siempre ``top_k`` si existen).
          chapter_filter: capítulo de la PARTIDA. Señal blanda: si casa con la
            taxonomía del libro, los candidatos de ese capítulo reciben
            ``CHAPTER_MATCH_BONUS_FACTOR``; si no casa, se ignora. Ya NO filtra
            (ni hay reintento "sin filtro": no hace falta).
          unit_dimension_filter: dimensión física de la PARTIDA. Señal blanda:
            ``UNIT_MISMATCH_PENALTY_FACTOR`` a los candidatos incompatibles
            (ver ``unit.dimension_mismatch``). Nunca excluye.

        Pipeline:
          1. BM25 y vector (solo partidas) → rankings deduplicados, restringidos
             a códigos presentes en el catálogo en memoria.
          2. RRF → score fusionado.
          3. Señales blandas multiplicativas sobre el score fusionado.
          4. Orden por score final (fusión + señales; NO por coseno) y corte a
             ``top_k``.

        Cada candidato lleva trazas: ``_cosine_raw``, ``_hybrid_rrf_score``,
        ``_bm25_rank``, ``_vector_rank`` (0-based o None), ``_final_score`` y
        ``_soft_signals``. ``matchScore`` = coseno PURO si el candidato vino del
        vector (señal de confianza para el tier Flash/Pro); si solo vino de
        BM25, el score RRF (queda por debajo de cualquier match vectorial).
        """
        if not query or not query.strip():
            return []
        if not self.catalog_items:
            return []

        query_tokens = tokenize_es(query)

        # 1a. BM25 (no I/O).
        bm25_codes = [
            c for c in self._bm25_search(query_tokens, limit=self._PER_SOURCE_CANDIDATES)
            if c in self._items_by_code
        ]

        # 1b. Vector (I/O contra Firestore en producción).
        vector_results = await self._vector_search(
            query_vector, query_text=query, limit=self._PER_SOURCE_CANDIDATES
        )
        vector_codes: List[str] = []
        vector_cosine: Dict[str, float] = {}
        vector_match: Dict[str, float] = {}
        for r in vector_results:
            c = r.get("code") or r.get("id")
            if not c or c not in self._items_by_code or c in vector_cosine:
                continue  # desconocido en el catálogo o duplicado
            vector_codes.append(c)
            raw = r.get("_cosine_raw")
            if raw is None:
                raw = r.get("matchScore")
            vector_cosine[c] = float(raw or 0.0)
            vector_match[c] = float(r.get("matchScore") or 0.0)

        bm25_rank = {c: i for i, c in enumerate(bm25_codes)}
        vector_rank = {c: i for i, c in enumerate(vector_codes)}

        # 2. RRF.
        fused = reciprocal_rank_fusion(
            [bm25_codes, vector_codes], rrf_k=self.rrf_k
        )

        # 3. Señales blandas ANTES del corte.
        chapter_matches = self.match_chapter(chapter_filter) if chapter_filter else frozenset()
        scored: List[tuple[float, int, str, float, Dict[str, Any]]] = []
        for order, (code, rrf_score) in enumerate(fused):
            item = self._items_by_code[code]
            signals: Dict[str, Any] = {}
            final = rrf_score
            if chapter_matches and self._chapter_norm_by_code.get(code) in chapter_matches:
                final *= CHAPTER_MATCH_BONUS_FACTOR
                signals["chapter_bonus"] = CHAPTER_MATCH_BONUS_FACTOR
            if unit_dimension_filter and dimension_mismatch(
                unit_dimension_filter, item.unit_dimension
            ):
                final *= UNIT_MISMATCH_PENALTY_FACTOR
                signals["unit_penalty"] = UNIT_MISMATCH_PENALTY_FACTOR
                signals["unit_dimensions"] = f"{unit_dimension_filter}->{item.unit_dimension}"
            scored.append((final, order, code, rrf_score, signals))

        # 4. Orden por score final (estable respecto al orden de fusión) + corte.
        scored.sort(key=lambda t: (-t[0], t[1]))

        logger.debug(
            f"[HybridCatalogSearch] q={query[:60]!r} bm25={len(bm25_codes)} "
            f"vec={len(vector_codes)} fused={len(fused)} "
            f"chapter_hint={chapter_filter!r} matched={sorted(chapter_matches)}"
        )

        out: List[Dict[str, Any]] = []
        for final, _order, code, rrf_score, signals in scored[:top_k]:
            item = self._items_by_code[code]
            cosine = vector_cosine.get(code)
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
                "matchScore": cosine if cosine is not None else rrf_score,
                "_cosine_raw": cosine,
                # Compat: consumidores antiguos leen `_cosine`.
                "_cosine": cosine,
                "_vector_match_score": vector_match.get(code),
                "_hybrid_rrf_score": rrf_score,
                "_bm25_rank": bm25_rank.get(code),
                "_vector_rank": vector_rank.get(code),
                "_final_score": final,
                "_soft_signals": signals,
            })
        return out
