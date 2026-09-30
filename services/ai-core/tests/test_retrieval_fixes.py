"""Arreglos de recuperación (2026-09) — búsqueda de candidatos del libro.

Cubre:
  - `tokenize_es`: plegado de tildes + singular/plural ligero (índice = consulta).
  - `dimension_mismatch`: penalización blanda de unidad (puenteables / pa-%-h).
  - `build_retrieval_query`: consulta cruda limpia (resumen ~C o descripción
    recortada); el Judge sigue viendo la descripción completa.
  - `_analyze_and_deconstruct`: sin LLM en descripciones cortas, fallback a la
    consulta cruda si el LLM falla, máx. 3 sub-consultas.
  - `_firestore_vector_swarm`: fusión RRF multi-consulta con la cruda ×2.
  - `retrieve_candidates`: código primero (exacto + unidad compatible), pool
    deduplicado y cortado a 15.
  - `evaluate_batch`: semáforo de recuperaciones, telemetría `retrieval_debug`
    y el prompt del Judge sin `origen_swam`.
  - BC3 → `RestructuredItem.summary` + `unit_dimension`.
"""
from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional

import pytest

from src.budget.application.ports.ports import (
    IGenerationEmitter,
    ILLMProvider,
    IVectorSearch,
)
from src.budget.application.services.pdf_extractor_service import RestructuredItem
from src.budget.application.services.swarm_pricing_service import (
    BatchPricedItemV3,
    BatchPricingEvaluatorResultV3,
    DeconstructResult,
    PricingFinalResultDB,
    SwarmPricingService,
    build_retrieval_query,
)
from src.budget.bc3_parser.entities import (
    Bc3Concept,
    Bc3ConceptKind,
    Bc3Decomposition,
    Bc3Measurement,
    Bc3Tree,
)
from src.budget.bc3_parser.to_restructured import bc3_tree_to_restructured_items
from src.budget.catalog.application.services.hybrid_catalog_search import (
    HybridCatalogSearch,
    light_singular_es,
    tokenize_es,
)
from src.budget.catalog.domain.price_book_entry import PriceBookItemEntry
from src.budget.catalog.domain.unit import dimension_mismatch


# ---- tokenize_es ------------------------------------------------------------


@pytest.mark.parametrize("plural,singular", [
    ("paredes", "pared"),
    ("tablones", "tablon"),
    ("interiores", "interior"),
    ("tabiques", "tabique"),
    ("baldosas", "baldosa"),
    ("morteros", "mortero"),
    ("ladrillos", "ladrillo"),
])
def test_light_singular_plural_collapses(plural, singular):
    assert light_singular_es(plural) == singular
    assert light_singular_es(singular) == singular


@pytest.mark.parametrize("token", ["cross", "mas", "gas", "hm", "pared", "tablon"])
def test_light_singular_leaves_short_or_ss_tokens(token):
    # len<4 / termina en "ss" / ya singular → sin cambios.
    assert light_singular_es(token) == token


def test_tokenize_folds_accents_and_drops_stopwords():
    assert tokenize_es("Tabiques de Ladrillo cerámico") == ["tabique", "ladrillo", "ceramico"]
    assert tokenize_es("HORMIGÓN armado") == ["hormigon", "armado"]
    assert tokenize_es("Tablones y paredes") == ["tablon", "pared"]
    # ñ se pliega igual en índice y consulta.
    assert tokenize_es("Baño") == tokenize_es("bano")


def test_bm25_matches_plural_query_against_singular_index():
    # Relleno: con un corpus de 2 docs el IDF de BM25Okapi sale 0.
    items = [_entry(f"F{i}", f"Relleno genérico número {i}") for i in range(6)] + [
        _entry("P1", "Pared de ladrillo hueco", unit="m2", dim="superficie"),
        _entry("P2", "Pintura plástica lisa", unit="m2", dim="superficie"),
    ]
    svc = HybridCatalogSearch(items, _ListVectorSearch([]))
    ranked = svc._bm25_search(tokenize_es("paredes de ladrillos"), limit=5)
    assert ranked[0] == "P1"


# ---- dimension_mismatch ------------------------------------------------------


@pytest.mark.parametrize("partida,cand,expected", [
    ("superficie", "tiempo", True),
    ("superficie", "lineal", True),
    ("superficie", "superficie", False),
    ("superficie", "volumen", False),   # puenteable
    ("volumen", "superficie", False),   # puenteable
    ("lineal", "discreto", False),      # puenteable
    ("discreto", "lineal", False),      # puenteable
    ("importe", "superficie", False),   # pa
    ("porcentaje", "discreto", False),  # %
    ("tiempo", "volumen", False),       # h
    (None, "volumen", False),           # partida desconocida
    ("superficie", None, False),        # candidato desconocido
    ("rarezas", "volumen", False),      # dimensión no reconocida
    ("surface_area", "time", True),     # alias legacy en inglés
    ("longitud", "unidad", False),      # alias → lineal/discreto (puenteable)
])
def test_dimension_mismatch(partida, cand, expected):
    assert dimension_mismatch(partida, cand) is expected


# ---- build_retrieval_query --------------------------------------------------


def test_retrieval_query_with_summary_uses_summary_unit_and_long_snippet():
    long_text = "Fábrica de ladrillo cerámico hueco doble de 7 cm, recibido con mortero M-5. " * 20
    item = RestructuredItem(
        code="FAB010", description=f"Tabique LHD 7 cm. {long_text}", unit="m2",
        summary="Tabique LHD 7 cm",
    )
    q = build_retrieval_query(item)
    assert q.startswith("Tabique LHD 7 cm m2 Fábrica de ladrillo")
    assert q.count("Tabique LHD 7 cm") == 1, "el resumen no se repite"
    assert len(q) <= len("Tabique LHD 7 cm m2 ") + 300


def test_retrieval_query_without_summary_truncates_description():
    desc = ("Solera de hormigón armado HA-25 de 15 cm de espesor " * 40).strip()
    item = RestructuredItem(code="X", description=desc, unit="m2")
    q = build_retrieval_query(item)
    assert q.endswith(" m2")
    assert len(q) <= 600 + 3
    assert q.startswith("Solera de hormigón armado")


def test_retrieval_query_short_description_is_description_plus_unit():
    item = RestructuredItem(code="X", description="Pintura plástica", unit="m2")
    assert build_retrieval_query(item) == "Pintura plástica m2"


def test_retrieval_query_summary_only():
    item = RestructuredItem(code="X", description="Punto de luz", unit="ud", summary="Punto de luz")
    assert build_retrieval_query(item) == "Punto de luz ud"


# ---- Fakes -------------------------------------------------------------------


def _entry(code: str, desc: str, *, unit: str = "m2", dim: Optional[str] = "superficie",
           chapter: str = "HORMIGONES") -> PriceBookItemEntry:
    return PriceBookItemEntry(
        code=code, chapter=chapter, section="", description=desc,
        unit_raw=unit, unit_normalized=unit, unit_dimension=dim,
        priceTotal=10.0, breakdown_ids=[],
    )


class _ListVectorSearch(IVectorSearch):
    """Devuelve, por texto de consulta, una lista de códigos predefinida."""

    def __init__(self, default: List[str], by_query: Optional[Dict[str, List[str]]] = None):
        self.default = default
        self.by_query = by_query or {}
        self.calls: List[str] = []

    def search_similar_items(self, query_vector, query_text="", limit=3, **kwargs):
        self.calls.append(query_text)
        codes = self.by_query.get(query_text, self.default)
        return [
            {"id": c, "code": c, "matchScore": 0.9 - i * 0.01, "_cosine_raw": 0.9 - i * 0.01,
             "description": c, "unit": "m2"}
            for i, c in enumerate(codes[:limit])
        ]


class _FakeLLM(ILLMProvider):
    def __init__(self, *, deconstruct: Optional[DeconstructResult] = None,
                 raise_on_deconstruct: Optional[Exception] = None):
        self.deconstruct = deconstruct
        self.raise_on_deconstruct = raise_on_deconstruct
        self.deconstruct_calls = 0
        self.judge_prompts: List[str] = []

    async def generate_structured(self, system_prompt, user_prompt, response_schema, **kwargs):
        name = response_schema.__name__
        if name == "DeconstructResult":
            self.deconstruct_calls += 1
            if self.raise_on_deconstruct is not None:
                raise self.raise_on_deconstruct
            return (self.deconstruct or DeconstructResult(is_complex=False, queries=[])), {}
        if name == "BatchPricingEvaluatorResultV3":
            self.judge_prompts.append(user_prompt)
            codes = [
                line.split(":", 1)[1].strip().rstrip("-").strip()
                for line in user_prompt.splitlines()
                if line.startswith("--- PARTIDA CÓDIGO:")
            ]
            return BatchPricingEvaluatorResultV3(results=[
                BatchPricedItemV3(item_code=c, valuation=PricingFinalResultDB(
                    pensamiento_calculista="r", calculated_unit_price=10.0,
                    needs_human_review=False, match_kind="1:1",
                )) for c in codes
            ]), {}
        if name == "CandidateRerankResult":
            return response_schema(selected_ids=[]), {}
        raise AssertionError(name)

    async def get_embedding(self, text: str):
        return [0.0] * 768


class _SpyEmitter(IGenerationEmitter):
    def __init__(self):
        self.events: List[Dict[str, Any]] = []

    def emit_event(self, budget_id, event_type, data):
        self.events.append({"type": event_type, "data": data})


def _metrics() -> Dict[str, Any]:
    return {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}


_LONG_DESC = (
    "Recrecido de mortero autonivelante de 5 cm de espesor medio, incluso imprimación, "
    "maestreado, juntas perimetrales y curado, totalmente terminado según planos."
)
assert len(_LONG_DESC) >= 120


# ---- _analyze_and_deconstruct ------------------------------------------------


def test_short_description_does_not_call_llm():
    llm = _FakeLLM(deconstruct=DeconstructResult(is_complex=True, queries=["a", "b"]))
    svc = SwarmPricingService(llm_provider=llm, vector_search=_ListVectorSearch([]))
    item = RestructuredItem(code="X", description="Pintura plástica", unit="m2")
    queries = asyncio.run(svc._analyze_and_deconstruct(item, _metrics()))
    assert queries == ["Pintura plástica m2"]
    assert llm.deconstruct_calls == 0


def test_llm_failure_falls_back_to_raw_query():
    llm = _FakeLLM(raise_on_deconstruct=RuntimeError("429 RESOURCE_EXHAUSTED"))
    svc = SwarmPricingService(llm_provider=llm, vector_search=_ListVectorSearch([]))
    item = RestructuredItem(code="X", description=_LONG_DESC, unit="m2")
    queries = asyncio.run(svc._analyze_and_deconstruct(item, _metrics()))
    assert queries == [build_retrieval_query(item)]
    assert llm.deconstruct_calls == 1


def test_supplementary_queries_capped_at_three_and_raw_first():
    llm = _FakeLLM(deconstruct=DeconstructResult(
        is_complex=True, queries=["q1", "q2", "q2", "q3", "q4", "q5"],
    ))
    svc = SwarmPricingService(llm_provider=llm, vector_search=_ListVectorSearch([]))
    item = RestructuredItem(code="X", description=_LONG_DESC, unit="m2")
    queries = asyncio.run(svc._analyze_and_deconstruct(item, _metrics()))
    assert queries == [build_retrieval_query(item), "q1", "q2", "q3"]


# ---- _firestore_vector_swarm: RRF multi-consulta ------------------------------


def test_swarm_fuses_queries_by_rrf_with_raw_query_double_weight():
    """Dos sub-consultas empujan SUB (rank 0 en ambas → 2/60) pero la cruda
    pone RAW en rank 0 con peso 2 (2/60) + rank 1 en una sub (1/61) → RAW gana.
    Antes se ordenaba por matchScore (idéntico) → decidía el orden de llegada."""
    vs = _ListVectorSearch(default=[], by_query={
        "raw": ["RAW", "OTHER"],
        "s1": ["SUB", "RAW"],
        "s2": ["SUB"],
    })
    svc = SwarmPricingService(llm_provider=_FakeLLM(), vector_search=vs)
    cands = asyncio.run(svc._firestore_vector_swarm(["raw", "s1", "s2"]))
    ids = [c["id"] for c in cands]
    assert ids[0] == "RAW"
    assert set(ids) == {"RAW", "SUB", "OTHER"}
    assert cands[0]["__query_origin"] == "raw"
    assert next(c for c in cands if c["id"] == "SUB")["__query_origin"] in {"s1", "s2"}
    assert all("_swarm_rrf_score" in c for c in cands)


def test_swarm_pool_is_cut_to_15():
    vs = _ListVectorSearch(default=[], by_query={
        "raw": [f"A{i}" for i in range(4)],
        "s1": [f"B{i}" for i in range(4)],
        "s2": [f"C{i}" for i in range(4)],
        "s3": [f"D{i}" for i in range(4)],
    })
    svc = SwarmPricingService(llm_provider=_FakeLLM(), vector_search=vs)
    cands = asyncio.run(svc._firestore_vector_swarm(["raw", "s1", "s2", "s3"]))
    assert len(cands) == 15


# ---- retrieve_candidates ----------------------------------------------------


def _catalog() -> List[PriceBookItemEntry]:
    items = [_entry(f"SOL{i:03d}", f"Solera de hormigón variante {i}") for i in range(20)]
    items += [
        _entry("RSF010", "Recrecido de mortero autonivelante", unit="m2", dim="superficie"),
        _entry("HOR010", "Hora de oficial primera", unit="h", dim="tiempo"),
        _entry("CAV010", "Viga de atado de hormigón armado", unit="m3", dim="volumen"),
    ]
    return items


def _svc_with_hybrid(vs: IVectorSearch, llm: Optional[_FakeLLM] = None) -> SwarmPricingService:
    items = _catalog()
    return SwarmPricingService(
        llm_provider=llm or _FakeLLM(),
        vector_search=vs,
        hybrid_search=HybridCatalogSearch(items, vs),
    )


def test_retrieve_candidates_returns_queries_and_top15_pool():
    vs = _ListVectorSearch(default=[f"SOL{i:03d}" for i in range(20)])
    svc = _svc_with_hybrid(vs)
    item = RestructuredItem(code="1.1", description="Solera de hormigón", unit="m2")
    queries, pool = asyncio.run(svc.retrieve_candidates(item, _metrics()))
    assert queries == ["Solera de hormigón m2"]
    assert len(pool) == 15
    ids = [c["id"] for c in pool]
    assert len(set(ids)) == 15


def test_retrieve_candidates_code_first_exact_goes_first_and_dedupes():
    vs = _ListVectorSearch(default=["SOL000", "RSF010", "SOL001"])
    svc = _svc_with_hybrid(vs)
    item = RestructuredItem(code="rsf010", description="Recrecido autonivelante", unit="m2")
    _, pool = asyncio.run(svc.retrieve_candidates(item, _metrics()))
    ids = [c["id"] for c in pool]
    assert ids[0] == "RSF010"
    assert ids.count("RSF010") == 1
    assert pool[0]["__query_origin"] == "code_first"


def test_retrieve_candidates_code_first_skips_base_code_matches():
    vs = _ListVectorSearch(default=["SOL000"])
    svc = _svc_with_hybrid(vs)
    # CAV010M2 → casa CAV010 solo por código BASE → no entra por código primero.
    item = RestructuredItem(code="CAV010M2", description="Viga de atado", unit="m3")
    _, pool = asyncio.run(svc.retrieve_candidates(item, _metrics()))
    assert not pool or pool[0].get("__query_origin") != "code_first"


def test_retrieve_candidates_code_first_requires_compatible_unit():
    vs = _ListVectorSearch(default=["SOL000"])
    svc = _svc_with_hybrid(vs)
    # HOR010 es "h" (tiempo); la partida es m2 (superficie) → incompatible.
    item = RestructuredItem(code="HOR010", description="Solera", unit="m2")
    _, pool = asyncio.run(svc.retrieve_candidates(item, _metrics()))
    assert all(c.get("__query_origin") != "code_first" for c in pool)


def test_retrieve_candidates_survives_deconstruct_failure():
    vs = _ListVectorSearch(default=["RSF010"])
    llm = _FakeLLM(raise_on_deconstruct=RuntimeError("circuit breaker open"))
    svc = _svc_with_hybrid(vs, llm)
    item = RestructuredItem(code="9.9", description=_LONG_DESC, unit="m2")
    queries, pool = asyncio.run(svc.retrieve_candidates(item, _metrics()))
    assert queries == [build_retrieval_query(item)]
    assert pool and pool[0]["id"] == "RSF010"


# ---- evaluate_batch: semáforo, telemetría y prompt del Judge -----------------


def _patch_prompt(monkeypatch):
    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", kwargs.get("batch_items", "")),
    )


def test_judge_prompt_has_no_origen_swam_but_candidates_keep_origin(monkeypatch):
    _patch_prompt(monkeypatch)
    vs = _ListVectorSearch(default=["RSF010", "SOL000"])
    llm = _FakeLLM()
    emitter = _SpyEmitter()
    svc = SwarmPricingService(
        llm_provider=llm, vector_search=vs, emitter=emitter,
        hybrid_search=HybridCatalogSearch(_catalog(), vs),
    )
    items = [RestructuredItem(code="1.1", description="Recrecido autonivelante", unit="m2")]
    asyncio.run(svc.evaluate_batch(items, budget_id="b1", metrics=_metrics()))
    assert llm.judge_prompts, "el Judge debió recibir el prompt"
    assert all("origen_swam" not in p for p in llm.judge_prompts)
    dbg = [e["data"] for e in emitter.events if e["type"] == "retrieval_debug"]
    assert dbg and dbg[0]["code"] == "1.1"
    assert dbg[0]["queries"] == ["Recrecido autonivelante m2"]
    assert dbg[0]["top_codes"][0] == "RSF010"


def test_retrieval_concurrency_is_bounded(monkeypatch):
    _patch_prompt(monkeypatch)
    monkeypatch.setenv("SWARM_RETRIEVAL_CONCURRENCY", "2")
    svc = SwarmPricingService(
        llm_provider=_FakeLLM(), vector_search=_ListVectorSearch([]), emitter=_SpyEmitter(),
    )
    state = {"active": 0, "peak": 0, "calls": 0}

    async def _fake_retrieve(item, metrics):
        state["active"] += 1
        state["calls"] += 1
        state["peak"] = max(state["peak"], state["active"])
        await asyncio.sleep(0.02)
        state["active"] -= 1
        return ["q"], []

    monkeypatch.setattr(svc, "retrieve_candidates", _fake_retrieve)
    items = [
        RestructuredItem(code=f"I{i}", description=f"partida {i}", unit="m2") for i in range(6)
    ]
    asyncio.run(svc.evaluate_batch(items, budget_id="b2", metrics=_metrics()))
    assert state["calls"] == 6
    assert state["peak"] <= 2


# ---- BC3 → summary + unit_dimension -------------------------------------------


def test_bc3_items_carry_summary_and_unit_dimension():
    tree = Bc3Tree(version="FIEBDC-3/2020")
    tree.concepts["01#"] = Bc3Concept(code="01#", description="DEMOLICIONES", kind=Bc3ConceptKind.CHAPTER)
    tree.concepts["P1"] = Bc3Concept(
        code="P1", unit="m²", description="Demolición de tabique",
        long_description="Demolición de tabique de ladrillo hueco, con medios manuales.",
        kind=Bc3ConceptKind.PARTIDA,
    )
    tree.concepts["P2"] = Bc3Concept(
        code="P2", unit="ud.", description="",  # punto final típico de BC3 long_description="Retirada de sanitario.",
        kind=Bc3ConceptKind.PARTIDA,
    )
    tree.decompositions["01#"] = Bc3Decomposition(parent_code="01#", children=[("P1", 1.0), ("P2", 1.0)])
    tree.measurements["P1"] = Bc3Measurement(parent_code="01#", code="P1", total_quantity=12.0)
    tree.measurements["P2"] = Bc3Measurement(parent_code="01#", code="P2", total_quantity=2.0)

    items = {it.code: it for it in bc3_tree_to_restructured_items(tree)}
    p1 = items["P1"]
    assert p1.summary == "Demolición de tabique"
    assert p1.unit_dimension == "superficie"
    # El Judge sigue recibiendo la descripción completa (resumen + texto largo).
    assert "medios manuales" in p1.description
    assert build_retrieval_query(p1).startswith("Demolición de tabique m² Demolición de tabique de ladrillo")

    p2 = items["P2"]
    assert p2.summary is None
    assert p2.unit_dimension == "discreto"


def test_summary_is_not_in_llm_response_schema():
    """RestructuredItem también es response_schema del extractor LLM: el
    campo `summary` no debe exponerse al modelo."""
    schema = RestructuredItem.model_json_schema()
    assert "summary" not in schema.get("properties", {})
