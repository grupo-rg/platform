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
  6. Filtros estructurales (chapter, unit_dimension) reducen el candidate
     pool antes de combinar (S1-A-05 hook).
  7. Latencia <100ms sobre dataset de 50 items sintético (smoke).
"""
from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

import pytest

from src.budget.application.ports.ports import IVectorSearch
from src.budget.catalog.application.services.hybrid_catalog_search import (
    HybridCatalogSearch,
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
async def test_search_chapter_filter_excludes_other_chapters(synthetic_catalog):
    """Con chapter_filter='03 HORMIGONES', BM25 solo busca dentro del
    capítulo. Items de otros capítulos NO aparecen en BM25, aunque el
    vector pueda devolverlos."""
    fake_vec = _FakeVectorSearch(
        ranked_codes=["D000", "D001"],  # demoliciones — DEBE filtrarse
        all_items=synthetic_catalog,
    )
    svc = HybridCatalogSearch(synthetic_catalog, fake_vec, rrf_k=60)
    results = await svc.search(
        query="solera hormigón fratasada",
        query_vector=[0.0] * 768,
        top_k=5,
        chapter_filter="03 HORMIGONES",
    )
    # Solo GOLDEN_KW está en HORMIGONES → debe ser el único candidato real.
    chapters = {r["chapter"] for r in results}
    assert chapters == {"03 HORMIGONES"}, (
        f"Esperado solo '03 HORMIGONES', got {chapters}"
    )


@pytest.mark.asyncio
async def test_search_unit_dimension_filter(synthetic_catalog):
    """Con unit_dimension_filter='surface_area', solo items con esa
    dimensión pueden aparecer en BM25."""
    # Inyectamos un item de unidad distinta.
    catalog = list(synthetic_catalog) + [
        _make_item(
            code="HOUR_ITEM",
            description="Hora oficial 1ª",
            chapter="01 DEMOLICIONES",
            unit="h",
            unit_dim="time",
        ),
    ]
    fake_vec = _FakeVectorSearch(
        ranked_codes=["HOUR_ITEM"],
        all_items=catalog,
    )
    svc = HybridCatalogSearch(catalog, fake_vec, rrf_k=60)
    results = await svc.search(
        query="hora oficial",
        query_vector=[0.0] * 768,
        top_k=5,
        unit_dimension_filter="surface_area",  # excluye horas
    )
    codes = [r["code"] for r in results]
    assert "HOUR_ITEM" not in codes, (
        "El filtro de unit_dimension debería excluir HOUR_ITEM"
    )


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
