"""S1-A-02 — HybridCatalogSearch (BM25 + Vector + RRF).

Combina:
  - BM25 in-memory sobre el catálogo (jerga técnica española exacta).
  - Vector search existente (semántica; usa el adapter de Firestore).
  - Reciprocal Rank Fusion (RRF) para unificar los rankings.

Tests:
  1. ``tokenize_es`` produce tokens lowercased/strippeados/stemmed-light.
  2. RRF de dos rankings simples combina correctamente.
  3. ``search`` con keyword técnica exacta coloca el item correcto top-1
     gracias a BM25 (vector solo no lo encuentra).
  4. ``search`` con query semántica suelta coloca el item correcto top-1
     gracias a vector (BM25 solo no lo encuentra).
  5. ``search`` con query mixta deja al item correcto top-1.
  6. Capítulo y unidad son SEÑALES BLANDAS (bonus / penalización) sobre el
     score fusionado — ya no filtran el pool (antes S1-A-05 los aplicaba
     como filtros duros con reintento "sin filtro").
  7. Latencia <100ms sobre dataset de 50 items sintético (smoke).
  8. Dedupe por ranking, descarte de códigos ajenos y corte a top_k.
"""
from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

import pytest

from src.budget.application.ports.ports import IVectorSearch
from src.budget.catalog.application.services.hybrid_catalog_search import (
    CHAPTER_MATCH_BONUS_FACTOR,
    UNIT_MISMATCH_PENALTY_FACTOR,
    HybridCatalogSearch,
    normalize_chapter_name,
    reciprocal_rank_fusion,
    tokenize_es,
)
from src.budget.catalog.domain.price_book_entry import PriceBookItemEntry


# ---- Tokenization --------------------------------------------------------


def test_tokenize_es_lowercases_and_strips_punctuation():
    toks = tokenize_es("Solera de Hormigón HM-20, fratasada, e=15cm.")
    # Debe partir por puntuación y minusculizar; no es exhaustivo.
    assert "solera" in toks
    assert "hormigón" in toks or "hormigon" in toks
    assert "fratasada" in toks


def test_tokenize_es_handles_unicode():
    toks = tokenize_es("Hormigón M³ con piedra natural")
    assert all(t == t.lower() for t in toks)
    assert "hormigón" in toks or "hormigon" in toks


def test_tokenize_es_empty_string_returns_empty_list():
    assert tokenize_es("") == []
    assert tokenize_es(None) == []  # type: ignore[arg-type]


# ---- RRF -----------------------------------------------------------------


def test_rrf_combines_two_rankings():
    """RRF score = sum(1/(k+rank_i)). Item presente en ambos tops gana."""
    bm25 = ["A", "B", "C"]
    vec = ["B", "A", "D"]
    fused = reciprocal_rank_fusion([bm25, vec], rrf_k=60)
    # A está #1 y #2 → score 1/61 + 1/62; B está #2 y #1 → score 1/62 + 1/61.
    # Empate teórico → debemos ver A y B por delante de C/D.
    top2 = [item for item, _ in fused[:2]]
    assert "A" in top2 and "B" in top2


def test_rrf_single_ranking_preserves_order():
    fused = reciprocal_rank_fusion([["A", "B", "C"]], rrf_k=60)
    assert [item for item, _ in fused] == ["A", "B", "C"]


def test_rrf_handles_empty_rankings():
    assert reciprocal_rank_fusion([], rrf_k=60) == []
    assert reciprocal_rank_fusion([[], []], rrf_k=60) == []


def test_rrf_handles_disjoint_rankings():
    fused = reciprocal_rank_fusion([["A"], ["B"]], rrf_k=60)
    # Ambos tienen rank=0 (top-1) en su lista → mismo score; el orden es estable.
    items = [item for item, _ in fused]
    assert set(items) == {"A", "B"}


# ---- Search end-to-end ---------------------------------------------------


def _make_item(
    code: str,
    description: str,
    chapter: str = "01 DEMOLICIONES",
    unit: str = "m2",
    unit_dim: Optional[str] = "surface_area",
) -> PriceBookItemEntry:
    return PriceBookItemEntry(
        code=code,
        chapter=chapter,
        section="",
        description=description,
        unit_raw=unit,
        unit_normalized=unit,
        unit_dimension=unit_dim,
        priceTotal=100.0,
        breakdown_ids=[],
    )


class _FakeVectorSearch(IVectorSearch):
    """Vector search controlable para tests: devuelve resultados predefinidos."""

    def __init__(self, ranked_codes: List[str], all_items: List[PriceBookItemEntry]):
        self._ranked_codes = ranked_codes
        self._by_code = {it.code: it for it in all_items}

    def search_similar_items(
        self,
        query_vector,
        query_text="",
        limit=3,
        score_threshold=0.5,
        chapter_filters=None,
        partida_unit_dimension=None,
    ):
        # Devolvemos dicts con la forma que produce el adapter real.
        out: List[Dict[str, Any]] = []
        for rank, code in enumerate(self._ranked_codes[:limit]):
            it = self._by_code.get(code)
            if not it:
                continue
            out.append({
                "id": it.code,
                "code": it.code,
                "description": it.description,
                "unit": it.unit_raw,
                "unit_normalized": it.unit_normalized,
                "unit_dimension": it.unit_dimension,
                "chapter": it.chapter,
                "priceTotal": it.priceTotal,
                "matchScore": 1.0 - rank * 0.1,
            })
        return out


@pytest.fixture
def synthetic_catalog() -> List[PriceBookItemEntry]:
    """50 items sintéticos cubriendo demoliciones + albañilería."""
    items: List[PriceBookItemEntry] = []
    for i in range(20):
        items.append(_make_item(
            code=f"D{i:03d}",
            description=f"Demolición de tabique de ladrillo {i}",
            chapter="01 DEMOLICIONES",
        ))
    for i in range(20):
        items.append(_make_item(
            code=f"A{i:03d}",
            description=f"Tabique de pladur acústico {i}",
            chapter="02 ALBAÑILERIA",
        ))
    # Tarjetas dorada/única.
    items.append(_make_item(
        code="GOLDEN_KW",
        description="Solera de hormigón HM-20 fratasada e=15cm",
        chapter="03 HORMIGONES",
        unit="m2",
    ))
    items.append(_make_item(
        code="GOLDEN_SEM",
        description="Pavimento continuo de mortero autonivelante",
        chapter="04 PAVIMENTOS",
    ))
    return items


@pytest.mark.asyncio
async def test_search_returns_keyword_match_via_bm25(synthetic_catalog):
    """Query con keyword técnica exacta — BM25 lo coloca top-1 aunque
    el vector search devuelva otros items primero."""
    # Vector search devuelve cosas irrelevantes primero.
    fake_vec = _FakeVectorSearch(
        ranked_codes=["D000", "D001", "D002"],  # no contiene GOLDEN_KW
        all_items=synthetic_catalog,
    )
    svc = HybridCatalogSearch(synthetic_catalog, fake_vec, rrf_k=60)
    results = await svc.search(
        query="solera hormigón HM-20 fratasada",
        query_vector=[0.0] * 768,
        top_k=5,
    )
    codes = [c["code"] for c in results]
    assert "GOLDEN_KW" in codes
    # Top-1 debe ser el de keywords coincidentes.
    assert codes[0] == "GOLDEN_KW"


@pytest.mark.asyncio
async def test_search_returns_semantic_match_via_vector(synthetic_catalog):
    """Query semántica suelta — vector lo coloca top-1 aunque BM25 no
    tenga match léxico fuerte."""
    fake_vec = _FakeVectorSearch(
        ranked_codes=["GOLDEN_SEM", "D000", "A000"],  # GOLDEN_SEM top
        all_items=synthetic_catalog,
    )
    svc = HybridCatalogSearch(synthetic_catalog, fake_vec, rrf_k=60)
    results = await svc.search(
        query="suelo autonivelante",  # léxicamente débil
        query_vector=[0.0] * 768,
        top_k=5,
    )
    codes = [c["code"] for c in results]
    assert codes[0] == "GOLDEN_SEM"


@pytest.mark.asyncio
async def test_search_mixed_query_top1_is_correct(synthetic_catalog):
    """Query que tanto BM25 como vector marcan como top → fusion lo
    confirma top-1."""
    fake_vec = _FakeVectorSearch(
        ranked_codes=["GOLDEN_KW", "D000"],
        all_items=synthetic_catalog,
    )
    svc = HybridCatalogSearch(synthetic_catalog, fake_vec, rrf_k=60)
    results = await svc.search(
        query="solera hormigón HM-20",
        query_vector=[0.0] * 768,
        top_k=3,
    )
    assert results[0]["code"] == "GOLDEN_KW"


@pytest.mark.asyncio
async def test_search_latency_under_100ms_on_50_items(synthetic_catalog):
    """Smoke perf: el search debe responder en <100ms con 50 items."""
    fake_vec = _FakeVectorSearch(
        ranked_codes=["D000", "D001"],
        all_items=synthetic_catalog,
    )
    svc = HybridCatalogSearch(synthetic_catalog, fake_vec, rrf_k=60)
    start = time.monotonic()
    await svc.search(
        query="solera hormigón",
        query_vector=[0.0] * 768,
        top_k=10,
    )
    elapsed_ms = (time.monotonic() - start) * 1000
    # Sobre 50 items debe ser <100ms holgadamente. Si CI es lento, x10 margin.
    assert elapsed_ms < 500, f"Latencia {elapsed_ms:.1f}ms > 500ms"


@pytest.mark.asyncio
async def test_search_empty_query_returns_empty(synthetic_catalog):
    """Una query vacía no debe romper; devuelve lista vacía."""
    fake_vec = _FakeVectorSearch(
        ranked_codes=[],
        all_items=synthetic_catalog,
    )
    svc = HybridCatalogSearch(synthetic_catalog, fake_vec, rrf_k=60)
    results = await svc.search(
        query="",
        query_vector=[0.0] * 768,
        top_k=5,
    )
    assert results == []


@pytest.mark.asyncio
async def test_search_zero_catalog_is_safe():
    """Catálogo vacío no debe romper; devuelve lista vacía."""
    fake_vec = _FakeVectorSearch(ranked_codes=[], all_items=[])
    svc = HybridCatalogSearch([], fake_vec, rrf_k=60)
    results = await svc.search(
        query="any query",
        query_vector=[0.0] * 768,
        top_k=5,
    )
    assert results == []



# ---- Señales blandas: capítulo (bonus) y unidad (penalización) -------------
#
# CAMBIO (arreglos de recuperación 2026-09): antes `chapter_filter` y
# `unit_dimension_filter` eran FILTROS DUROS (BM25 y vector excluían otros
# capítulos/dimensiones, con un reintento "sin filtro" si quedaba vacío). En
# producción la taxonomía de capítulos del cliente casi nunca casa con la del
# libro y el filtro dejaba pools cortos o vacíos. Ahora son SEÑALES BLANDAS
# sobre el score fusionado: nunca excluyen y siempre salen `top_k` si existen.


@pytest.mark.asyncio
async def test_chapter_hint_is_soft_bonus_not_filter(synthetic_catalog):
    """Con chapter_filter='03 HORMIGONES' los candidatos de otros capítulos
    SIGUEN apareciendo (antes se excluían); el del capítulo casado recibe el
    bonus y queda el primero."""
    fake_vec = _FakeVectorSearch(
        ranked_codes=["D000", "D001", "GOLDEN_KW"],
        all_items=synthetic_catalog,
    )
    svc = HybridCatalogSearch(synthetic_catalog, fake_vec, rrf_k=60)
    results = await svc.search(
        query="solera hormigón fratasada",
        query_vector=[0.0] * 768,
        top_k=5,
        chapter_filter="03 HORMIGONES",
    )
    chapters = {r["chapter"] for r in results}
    assert "01 DEMOLICIONES" in chapters  # ya no se filtran
    assert results[0]["code"] == "GOLDEN_KW"
    assert results[0]["_soft_signals"].get("chapter_bonus") == CHAPTER_MATCH_BONUS_FACTOR
    # Los de otro capítulo no reciben bonus.
    other = next(r for r in results if r["code"] == "D000")
    assert "chapter_bonus" not in other["_soft_signals"]


@pytest.mark.asyncio
async def test_chapter_bonus_breaks_ties_between_equal_rrf(synthetic_catalog):
    """Dos candidatos con el MISMO score RRF: el del capítulo casado sube."""
    catalog = list(synthetic_catalog)
    # Vector: X_OTHER en rank 0, X_CHAP en rank 1; BM25 no aporta nada (query
    # sin tokens comunes) → sin bonus X_OTHER gana.
    catalog.append(_make_item("X_OTHER", "zzz uno", chapter="09 CUBIERTAS"))
    catalog.append(_make_item("X_CHAP", "zzz dos", chapter="HORMIGONES"))
    fake_vec = _FakeVectorSearch(ranked_codes=["X_OTHER", "X_CHAP"], all_items=catalog)
    svc = HybridCatalogSearch(catalog, fake_vec, rrf_k=60)

    no_hint = await svc.search(query="qqq", query_vector=[0.0] * 768, top_k=2)
    assert [r["code"] for r in no_hint] == ["X_OTHER", "X_CHAP"]

    # Rank 0 vs rank 1 difieren ~1.6 %; el bonus (+8 %) invierte el orden.
    with_hint = await svc.search(
        query="qqq", query_vector=[0.0] * 768, top_k=2, chapter_filter="C03 HORMIGONES",
    )
    assert [r["code"] for r in with_hint] == ["X_CHAP", "X_OTHER"]


@pytest.mark.asyncio
async def test_unmatched_chapter_is_ignored(synthetic_catalog):
    """Un capítulo de cliente que no casa con la taxonomía del libro no da
    bonus a nadie ni reduce el pool."""
    fake_vec = _FakeVectorSearch(ranked_codes=["GOLDEN_KW", "D000"], all_items=synthetic_catalog)
    svc = HybridCatalogSearch(synthetic_catalog, fake_vec, rrf_k=60)
    results = await svc.search(
        query="tabique", query_vector=[0.0] * 768, top_k=5,  # 40 items con "tabique"
        chapter_filter="1 ACTUACIONES PREVIAS",
    )
    assert len(results) == 5
    assert all("chapter_bonus" not in r["_soft_signals"] for r in results)


@pytest.mark.asyncio
async def test_unit_dimension_is_penalty_not_exclusion(synthetic_catalog):
    """Antes `unit_dimension_filter` EXCLUÍA el item de otra dimensión. Ahora
    se PENALIZA: sigue en el pool (el Judge puede convertir) pero cede el
    sitio frente a un compatible con score similar."""
    catalog = list(synthetic_catalog) + [
        _make_item("HOUR_ITEM", "Hora oficial 1ª", unit="h", unit_dim="tiempo"),
        _make_item("SURF_ITEM", "Oficial alicatado", unit="m2", unit_dim="superficie"),
    ]
    fake_vec = _FakeVectorSearch(ranked_codes=["HOUR_ITEM", "SURF_ITEM"], all_items=catalog)
    svc = HybridCatalogSearch(catalog, fake_vec, rrf_k=60)
    results = await svc.search(
        query="oficial", query_vector=[0.0] * 768, top_k=5,
        unit_dimension_filter="surface_area",  # alias → superficie
    )
    codes = [r["code"] for r in results]
    assert "HOUR_ITEM" in codes, "la penalización no debe excluir"
    assert codes.index("SURF_ITEM") < codes.index("HOUR_ITEM")
    hour = next(r for r in results if r["code"] == "HOUR_ITEM")
    assert hour["_soft_signals"]["unit_penalty"] == UNIT_MISMATCH_PENALTY_FACTOR
    assert hour["_final_score"] == pytest.approx(
        hour["_hybrid_rrf_score"] * UNIT_MISMATCH_PENALTY_FACTOR
    )


@pytest.mark.asyncio
async def test_bridgeable_and_unconstrained_units_not_penalized(synthetic_catalog):
    """superficie↔volumen y lineal↔discreto son puenteables; partidas pa/%/h
    o de dimensión desconocida no penalizan a nadie."""
    catalog = list(synthetic_catalog) + [
        _make_item("VOL", "Hormigón en masa relleno", unit="m3", unit_dim="volumen"),
    ]
    fake_vec = _FakeVectorSearch(ranked_codes=["VOL"], all_items=catalog)
    svc = HybridCatalogSearch(catalog, fake_vec, rrf_k=60)
    for partida_dim in ("superficie", "importe", "porcentaje", "tiempo", None, "desconocida_x"):
        res = await svc.search(
            query="relleno", query_vector=[0.0] * 768, top_k=3,
            unit_dimension_filter=partida_dim,
        )
        vol = next(r for r in res if r["code"] == "VOL")
        assert "unit_penalty" not in vol["_soft_signals"], partida_dim


# ---- Dedupe, catálogo desconocido y corte a top_k ---------------------------


class _DupeUnknownVectorSearch(IVectorSearch):
    """Devuelve duplicados y códigos que no están en el catálogo en memoria
    (p. ej. partidas guardadas después del boot)."""

    def __init__(self, items: List[PriceBookItemEntry]):
        self._items = items

    def search_similar_items(self, query_vector, query_text="", limit=3, **kwargs):
        out: List[Dict[str, Any]] = []
        for i, it in enumerate(self._items[:limit]):
            out.append({"id": "GHOST-%d" % i, "code": "GHOST-%d" % i, "matchScore": 0.99})
            out.append({"id": it.code, "code": it.code, "matchScore": 0.9 - i * 0.01,
                        "_cosine_raw": 0.8 - i * 0.01})
            out.append({"id": it.code, "code": it.code, "matchScore": 0.5})  # dup
        return out


@pytest.mark.asyncio
async def test_unknown_and_duplicate_codes_do_not_shrink_top_k(synthetic_catalog):
    svc = HybridCatalogSearch(
        synthetic_catalog, _DupeUnknownVectorSearch(synthetic_catalog), rrf_k=60
    )
    results = await svc.search(query="zzzz", query_vector=[0.0] * 768, top_k=15)
    codes = [r["code"] for r in results]
    assert len(results) == 15, "siempre top_k si el catálogo los tiene"
    assert len(set(codes)) == len(codes), "sin duplicados"
    assert not any(c.startswith("GHOST") for c in codes)
    # La primera aparición (mejor rango) es la que cuenta.
    assert results[0]["_vector_rank"] == 0
    assert results[0]["_cosine_raw"] == pytest.approx(0.8)


@pytest.mark.asyncio
async def test_rrf_counts_each_code_once_per_ranking():
    fused = reciprocal_rank_fusion([["A", "A", "B"], ["B"]], rrf_k=60)
    scores = dict(fused)
    # A solo cuenta en rank 0 del primer ranking (no 1/60 + 1/61).
    assert scores["A"] == pytest.approx(1 / 60)
    # B: rank 1 (tras dedupe) en el primero + rank 0 en el segundo.
    assert scores["B"] == pytest.approx(1 / 61 + 1 / 60)


def test_rrf_weights():
    fused = dict(reciprocal_rank_fusion([["A"], ["B"]], rrf_k=60, weights=[2.0, 1.0]))
    assert fused["A"] == pytest.approx(2 / 60)
    assert fused["B"] == pytest.approx(1 / 60)


@pytest.mark.asyncio
async def test_output_carries_traces_and_keeps_fusion_order(synthetic_catalog):
    """Trazas en cada candidato y orden = fusión (no coseno): un candidato
    con coseno altísimo pero solo en el vector (rank bajo) no adelanta a uno
    que está arriba en ambos rankings."""

    class _VS(IVectorSearch):
        def search_similar_items(self, query_vector, query_text="", limit=3, **kw):
            return [
                {"code": "GOLDEN_KW", "matchScore": 0.70, "_cosine_raw": 0.70},
                {"code": "D005", "matchScore": 1.40, "_cosine_raw": 0.99},  # inflado
            ]

    svc = HybridCatalogSearch(synthetic_catalog, _VS(), rrf_k=60)
    results = await svc.search(query="solera hormigón HM-20", query_vector=[0.0] * 768, top_k=5)
    assert results[0]["code"] == "GOLDEN_KW"
    top = results[0]
    for key in ("_cosine_raw", "_hybrid_rrf_score", "_bm25_rank", "_vector_rank",
                "_final_score", "_soft_signals"):
        assert key in top, key
    assert top["_bm25_rank"] == 0 and top["_vector_rank"] == 0
    # matchScore = coseno PURO (no el inflado por boosts del adapter).
    d005 = next(r for r in results if r["code"] == "D005")
    assert d005["matchScore"] == pytest.approx(0.99)
    assert d005["_bm25_rank"] is None


# ---- Sin reintento "sin filtro" ------------------------------------------
#
# CAMBIO: antes, si la búsqueda con chapter_filter salía vacía, se repetía
# sin filtro (2 llamadas al vector). Como el capítulo ya no filtra, el
# reintento desaparece: siempre UNA llamada, y el adapter NUNCA recibe
# `chapter_filters` ni `partida_unit_dimension` (el híbrido aplica las señales).


class _RecordingFakeVectorSearch(_FakeVectorSearch):
    def __init__(self, ranked_codes, all_items):
        super().__init__(ranked_codes, all_items)
        self.call_log: List[Dict[str, Any]] = []

    def search_similar_items(self, query_vector, query_text="", limit=3,
                             score_threshold=0.5, chapter_filters=None,
                             partida_unit_dimension=None):
        self.call_log.append({
            "chapter_filters": chapter_filters,
            "partida_unit_dimension": partida_unit_dimension,
            "limit": limit,
        })
        return super().search_similar_items(query_vector, query_text, limit)


@pytest.mark.asyncio
@pytest.mark.parametrize("chapter", ["1 ACTUACIONES PREVIAS", "03 HORMIGONES", None])
async def test_single_vector_call_without_hard_filters(synthetic_catalog, chapter):
    fake_vec = _RecordingFakeVectorSearch(["GOLDEN_KW", "D000"], synthetic_catalog)
    svc = HybridCatalogSearch(synthetic_catalog, fake_vec, rrf_k=60)
    results = await svc.search(
        query="solera hormigón tabiques", query_vector=[0.0] * 768, top_k=5,
        chapter_filter=chapter, unit_dimension_filter="superficie",
    )
    assert len(fake_vec.call_log) == 1
    assert fake_vec.call_log[0]["chapter_filters"] is None
    assert fake_vec.call_log[0]["partida_unit_dimension"] is None
    assert len(results) == 5


# ---- Taxonomía de capítulos ----------------------------------------------


def test_normalize_chapter_name_strips_prefix_accents_ellipsis():
    assert normalize_chapter_name("01 Demoliciones") == "DEMOLICIONES"
    assert normalize_chapter_name("C01 TRABAJOS PREVIOS") == "TRABAJOS PREVIOS"
    assert normalize_chapter_name("1.Fontanería") == "FONTANERIA"
    assert normalize_chapter_name("1. Fontanería.") == "FONTANERIA"
    assert normalize_chapter_name("ELECTRICIDAD Y TELECOMUNICACI…") == "ELECTRICIDAD Y TELECOMUNICACI"
    assert normalize_chapter_name("  Solados   y  alicatados ") == "SOLADOS Y ALICATADOS"
    assert normalize_chapter_name(None) == ""


def test_match_chapter_by_prefix_handles_truncated_catalog_chapters():
    catalog = [
        _make_item("E1", "Cuadro eléctrico", chapter="ELECTRICIDAD Y TELECOMUNICACI…"),
        _make_item("H1", "Solera", chapter="HORMIGONES"),
    ]
    svc = HybridCatalogSearch(catalog, _FakeVectorSearch([], catalog))
    assert svc.match_chapter("05 ELECTRICIDAD Y TELECOMUNICACIONES") == frozenset(
        {"ELECTRICIDAD Y TELECOMUNICACI"}
    )
    assert svc.match_chapter("C02 Hormigones") == frozenset({"HORMIGONES"})
    assert svc.match_chapter("1 ACTUACIONES PREVIAS") == frozenset()
    # Prefijos demasiado cortos no casan.
    assert svc.match_chapter("HOR") == frozenset()
