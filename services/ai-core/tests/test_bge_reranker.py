"""S1-A-03 — Cross-encoder reranker (BAAI/bge-reranker-v2-m3) local.

Sustituye al reranker actual con Gemini Flash (~$0.01/partida) por un
cross-encoder local (~$0/partida, ~50-200ms/batch en CPU).

Estos tests NO bajan el modelo (~280MB) — usan un fake `_CrossEncoderLike`
inyectable. La integración real con `sentence-transformers` se valida con
un smoke test cuando se carga la dependencia.

Tests:
  1. ``rerank`` aplica el modelo a pairs (query, candidate.description) y
     devuelve top-N por score descendente.
  2. ``rerank`` con menos candidatos que top_n devuelve todos.
  3. ``rerank`` con lista vacía devuelve vacío.
  4. Singleton (``BgeReranker.get()``) no recarga el modelo en llamadas
     repetidas.
  5. Lazy loading: importar el módulo NO instancia `sentence_transformers`.

S2-A-00 (sprint 2):
  6. ``pre_warm`` ejecuta un dummy predict y marca `_warmed=True`.
  7. ``rerank`` con max_input_candidates trunca el input al cross-encoder.
  8. ``batch_rerank`` acumula pairs y los procesa en un solo predict.
  9. ``is_enabled`` devuelve False con ENABLE_BGE_RERANK=false.
"""
from __future__ import annotations

from typing import List, Sequence

import pytest

from src.budget.infrastructure.adapters.reranking.bge_reranker import (
    BgeReranker,
    is_enabled,
)


class _CrossEncoderLike:
    """Fake del `sentence_transformers.CrossEncoder` para tests sin instalar
    el modelo de ~280MB. Devuelve scores predecibles según la posición.

    S2-A-00 — el fake acepta `batch_size` kwarg como hace el real
    CrossEncoder. Lo ignora pero lo registra para que el test verifique
    que se pasa.
    """

    def __init__(self, scores_per_call: List[List[float]]):
        self._scores = scores_per_call
        self.predict_calls: List[List[tuple[str, str]]] = []
        self.batch_sizes_seen: List[int] = []

    def predict(self, pairs: Sequence[tuple[str, str]], batch_size: int = 0):
        self.predict_calls.append(list(pairs))
        if batch_size:
            self.batch_sizes_seen.append(batch_size)
        # Devuelve los scores en orden.
        return self._scores.pop(0)


# Helper para construir un candidato dict como el que vendría del catálogo.
def _cand(id_, description, **kwargs):
    return {"id": id_, "code": id_, "description": description, **kwargs}


def test_rerank_returns_top_n_by_score():
    """El reranker debe devolver los top_n candidatos ordenados por score."""
    ce = _CrossEncoderLike([[0.1, 0.9, 0.5]])
    reranker = BgeReranker(model=ce)
    cands = [
        _cand("A", "Pintura plástica"),
        _cand("B", "Solera hormigón HM-20"),
        _cand("C", "Pavimento cerámico"),
    ]
    ranked = reranker.rerank(
        query="hormigón fratasado HM-20",
        candidates=cands,
        top_n=2,
    )
    ids = [c["id"] for c, _ in ranked]
    assert ids == ["B", "C"]
    # Scores preservados.
    assert ranked[0][1] == pytest.approx(0.9)
    assert ranked[1][1] == pytest.approx(0.5)


def test_rerank_passes_query_and_description_pairs():
    """Cada pair pasado al CrossEncoder es (query, candidate.description)."""
    ce = _CrossEncoderLike([[0.5, 0.5]])
    reranker = BgeReranker(model=ce)
    reranker.rerank(
        query="Q1",
        candidates=[_cand("A", "Desc A"), _cand("B", "Desc B")],
        top_n=2,
    )
    assert ce.predict_calls == [[("Q1", "Desc A"), ("Q1", "Desc B")]]


def test_rerank_with_fewer_candidates_than_top_n():
    """Si hay menos candidates que top_n, devuelve todos."""
    ce = _CrossEncoderLike([[0.3, 0.7]])
    reranker = BgeReranker(model=ce)
    cands = [_cand("A", "a"), _cand("B", "b")]
    ranked = reranker.rerank(query="q", candidates=cands, top_n=10)
    assert len(ranked) == 2


def test_rerank_with_empty_candidates_returns_empty():
    """Lista vacía → vacío sin llamar al modelo."""
    ce = _CrossEncoderLike([])  # no scores wired — si se llamara, IndexError
    reranker = BgeReranker(model=ce)
    out = reranker.rerank(query="q", candidates=[], top_n=3)
    assert out == []
    # No se llamó al modelo.
    assert ce.predict_calls == []


def test_rerank_ignores_candidates_without_description():
    """Un candidato sin description se descarta (no se evalúa con el modelo)."""
    ce = _CrossEncoderLike([[0.5]])  # solo un pair esperado
    reranker = BgeReranker(model=ce)
    cands = [
        _cand("A", "Solera"),
        {"id": "B", "code": "B"},  # sin description
    ]
    ranked = reranker.rerank(query="q", candidates=cands, top_n=5)
    assert len(ranked) == 1
    assert ranked[0][0]["id"] == "A"


def test_singleton_reuses_model():
    """`BgeReranker.get()` devuelve la misma instancia en llamadas repetidas."""
    BgeReranker._reset_singleton_for_tests()  # internal helper
    ce = _CrossEncoderLike([[0.5]])
    inst1 = BgeReranker.get(model=ce)
    inst2 = BgeReranker.get(model=ce)
    assert inst1 is inst2


def test_import_does_not_load_sentence_transformers(monkeypatch):
    """Solo importar el módulo NO debe hacer `from sentence_transformers ...`
    El import del modelo es lazy y vive en `_create_default_model`."""
    import sys

    # Si sentence_transformers está cargado ya por otro test, no podemos
    # validar el lazy-load aquí. Skip safely.
    if "sentence_transformers" in sys.modules:
        pytest.skip("sentence_transformers ya está importado por otro test")

    # Re-importamos limpio.
    if "src.budget.infrastructure.adapters.reranking.bge_reranker" in sys.modules:
        del sys.modules["src.budget.infrastructure.adapters.reranking.bge_reranker"]
    import importlib

    importlib.import_module("src.budget.infrastructure.adapters.reranking.bge_reranker")
    assert "sentence_transformers" not in sys.modules


def test_rerank_preserves_other_candidate_fields():
    """Los dicts de candidate (con priceTotal, unit, etc.) se devuelven intactos."""
    ce = _CrossEncoderLike([[0.8]])
    reranker = BgeReranker(model=ce)
    cands = [
        _cand("A", "Solera", priceTotal=42.5, unit="m2", chapter="03 HORMIGONES"),
    ]
    ranked = reranker.rerank(query="q", candidates=cands, top_n=1)
    cand_back, score = ranked[0]
    assert cand_back["priceTotal"] == 42.5
    assert cand_back["unit"] == "m2"
    assert cand_back["chapter"] == "03 HORMIGONES"
    assert score == pytest.approx(0.8)


def test_rerank_handles_model_exception_gracefully():
    """Si el cross-encoder revienta, no propagamos: devolvemos input en orden."""
    class _BoomModel:
        def predict(self, pairs):
            raise RuntimeError("oops")

    reranker = BgeReranker(model=_BoomModel())
    cands = [_cand("A", "a"), _cand("B", "b")]
    out = reranker.rerank(query="q", candidates=cands, top_n=5)
    assert len(out) == 2
    assert [c["id"] for c, _ in out] == ["A", "B"]
    # Score por defecto en fallback es 0.0.
    assert all(s == 0.0 for _, s in out)


# ---- Integration: SwarmPricingService uses BGE when injected -------------


def test_swarm_uses_bge_when_injected(monkeypatch):
    """Con `reranker=` inyectado, el swarm llama a BGE y NO a Flash rerank."""
    import asyncio
    from src.budget.application.services.swarm_pricing_service import (
        BatchPricedItemV3,
        BatchPricingEvaluatorResultV3,
        PricingFinalResultDB,
        SwarmPricingService,
    )
    from src.budget.application.services.pdf_extractor_service import RestructuredItem
    from src.budget.application.ports.ports import (
        IGenerationEmitter,
        ILLMProvider,
        IVectorSearch,
    )

    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", kwargs.get("batch_items", "")),
    )

    flash_rerank_invocations = []

    class _LLM(ILLMProvider):
        async def generate_structured(self, system_prompt, user_prompt, response_schema, **kwargs):
            name = response_schema.__name__
            if name == "DeconstructResult":
                return response_schema(is_complex=False, queries=["q"]), {}
            if name == "CandidateRerankResult":
                # Si el swarm llega aquí, NO está usando BGE.
                flash_rerank_invocations.append(kwargs)
                return response_schema(selected_ids=["C1"]), {}
            if name == "BatchPricingEvaluatorResultV3":
                return (
                    BatchPricingEvaluatorResultV3(results=[
                        BatchPricedItemV3(
                            item_code="X.1",
                            valuation=PricingFinalResultDB(
                                pensamiento_calculista="r",
                                calculated_unit_price=10.0,
                                needs_human_review=False,
                                match_kind="1:1",
                            ),
                        ),
                    ]),
                    {},
                )
            raise AssertionError(name)

        async def get_embedding(self, text: str):
            return [0.0] * 768

    class _VS(IVectorSearch):
        def search_similar_items(self, query_vector, query_text="", limit=4, **kwargs):
            # Devolvemos 5 candidates para forzar el rerank (>3).
            return [
                {"id": f"C{i}", "code": f"C{i}", "description": f"desc {i}",
                 "matchScore": 0.9 - 0.1 * i, "unit": "m2", "priceTotal": 10.0 + i}
                for i in range(1, 6)
            ]

    class _SpyEmitter(IGenerationEmitter):
        def __init__(self):
            self.events = []
        def emit_event(self, b, t, d):
            self.events.append({"type": t, "data": d})

    # BGE fake: ordena por longitud de la descripción para que sea determinístico.
    class _BgeModel:
        def predict(self, pairs):
            # Score = longitud del candidate description.
            return [len(d) for _, d in pairs]

    BgeReranker._reset_singleton_for_tests()
    svc = SwarmPricingService(
        llm_provider=_LLM(),
        vector_search=_VS(),
        emitter=_SpyEmitter(),
        reranker=BgeReranker(model=_BgeModel()),
    )
    items = [RestructuredItem(
        code="X.1", description="d", quantity=10.0, unit="m2",
        chapter="03 HORMIGONES",
    )]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    asyncio.run(svc.evaluate_batch(items, budget_id="b-bge", metrics=metrics))

    # No deberían haberse llamado al rerank Flash.
    assert flash_rerank_invocations == [], (
        f"Se esperaba 0 llamadas Flash rerank con BGE inyectado, got {len(flash_rerank_invocations)}"
    )


# ---- S2-A-00 — Optimizations: pre-warm, top-k, batching, kill-switch -----


def test_pre_warm_runs_dummy_predict_and_marks_warmed():
    """`pre_warm()` invokes model.predict once with a dummy pair."""
    ce = _CrossEncoderLike([[0.1]])  # one warmup result
    reranker = BgeReranker(model=ce)
    assert reranker._warmed is False
    reranker.pre_warm()
    assert reranker._warmed is True
    # El dummy pair llegó al modelo.
    assert len(ce.predict_calls) == 1
    assert ce.predict_calls[0] == [("warmup", "warmup")]


def test_pre_warm_is_idempotent():
    """Llamar `pre_warm()` dos veces no ejecuta predict dos veces."""
    ce = _CrossEncoderLike([[0.1]])
    reranker = BgeReranker(model=ce)
    reranker.pre_warm()
    reranker.pre_warm()
    # Solo se llamó al modelo una vez.
    assert len(ce.predict_calls) == 1


def test_pre_warm_handles_model_exception_gracefully():
    """Si el modelo revienta en pre_warm, no propagamos."""
    class _BoomModel:
        def predict(self, pairs, batch_size=0):
            raise RuntimeError("torch not ready")

    reranker = BgeReranker(model=_BoomModel())
    # No raise — el boot del worker debe continuar.
    reranker.pre_warm()
    assert reranker._warmed is False


def test_pre_warm_with_no_model_is_noop():
    """`pre_warm` con `model=None` es no-op."""
    reranker = BgeReranker(model=None)
    reranker.pre_warm()  # no raise
    assert reranker._warmed is False


def test_rerank_truncates_input_to_max_input_candidates():
    """S2-A-00 — `max_input_candidates` limita los pairs al cross-encoder."""
    # Pasamos 10 candidates pero limitamos a 3. El predict debe recibir
    # solo 3 pairs.
    ce = _CrossEncoderLike([[0.9, 0.7, 0.5]])
    reranker = BgeReranker(model=ce)
    cands = [_cand(f"C{i}", f"desc {i}") for i in range(10)]
    ranked = reranker.rerank(
        query="q", candidates=cands, top_n=3, max_input_candidates=3
    )
    assert len(ranked) == 3
    # El predict recibió solo 3 pairs (los primeros 3 candidates).
    assert len(ce.predict_calls[0]) == 3
    assert [p[1] for p in ce.predict_calls[0]] == ["desc 0", "desc 1", "desc 2"]


def test_rerank_default_max_input_is_5():
    """`DEFAULT_TOP_N=5` — sin pasar el kwarg, se limita a 5."""
    ce = _CrossEncoderLike([[0.9, 0.8, 0.7, 0.6, 0.5]])
    reranker = BgeReranker(model=ce)
    cands = [_cand(f"C{i}", f"desc {i}") for i in range(10)]
    ranked = reranker.rerank(query="q", candidates=cands, top_n=3)
    # El predict recibió 5 pairs (no 10) y devolvió 3.
    assert len(ce.predict_calls[0]) == 5
    assert len(ranked) == 3


def test_rerank_passes_batch_size_kwarg():
    """El reranker pasa `batch_size` al `model.predict` cuando el modelo lo soporta."""
    ce = _CrossEncoderLike([[0.1, 0.2]])
    reranker = BgeReranker(model=ce, batch_size=8)
    cands = [_cand("A", "a"), _cand("B", "b")]
    reranker.rerank(query="q", candidates=cands, top_n=2)
    # El fake registró que recibió batch_size=8.
    assert ce.batch_sizes_seen == [8]


def test_batch_rerank_single_predict_call():
    """S2-A-00 — `batch_rerank` colapsa todas las queries en un solo predict."""
    # 3 queries × 2 candidates = 6 pairs en un único predict call.
    ce = _CrossEncoderLike([[0.5, 0.1, 0.9, 0.2, 0.3, 0.7]])
    reranker = BgeReranker(model=ce)

    queries_with_cands = [
        ("q1", [_cand("A1", "a1"), _cand("A2", "a2")]),
        ("q2", [_cand("B1", "b1"), _cand("B2", "b2")]),
        ("q3", [_cand("C1", "c1"), _cand("C2", "c2")]),
    ]
    results = reranker.batch_rerank(queries_with_cands, top_n=2)

    # Un solo call al modelo.
    assert len(ce.predict_calls) == 1
    # Los 6 pairs llegan en orden.
    assert ce.predict_calls[0] == [
        ("q1", "a1"), ("q1", "a2"),
        ("q2", "b1"), ("q2", "b2"),
        ("q3", "c1"), ("q3", "c2"),
    ]

    # Resultados por query, ordenados por score descendente.
    assert len(results) == 3
    # q1: A1=0.5, A2=0.1 → orden A1, A2
    assert [c["id"] for c, _ in results[0]] == ["A1", "A2"]
    assert results[0][0][1] == pytest.approx(0.5)
    # q2: B1=0.9, B2=0.2 → B1, B2
    assert [c["id"] for c, _ in results[1]] == ["B1", "B2"]
    # q3: C1=0.3, C2=0.7 → C2, C1
    assert [c["id"] for c, _ in results[2]] == ["C2", "C1"]


def test_batch_rerank_respects_top_n_per_query():
    """`batch_rerank` aplica top_n por cada query individualmente."""
    # 2 queries × 3 candidates → 6 pairs.
    ce = _CrossEncoderLike([[0.1, 0.9, 0.5, 0.2, 0.8, 0.3]])
    reranker = BgeReranker(model=ce)
    qc = [
        ("q1", [_cand("A", "a"), _cand("B", "b"), _cand("C", "c")]),
        ("q2", [_cand("D", "d"), _cand("E", "e"), _cand("F", "f")]),
    ]
    results = reranker.batch_rerank(qc, top_n=1)
    assert len(results) == 2
    # q1 top1: B (0.9). q2 top1: E (0.8).
    assert results[0][0][0]["id"] == "B"
    assert results[1][0][0]["id"] == "E"


def test_batch_rerank_truncates_input_per_query():
    """`batch_rerank` aplica `max_input_candidates` por query."""
    # 2 queries × 10 candidates → limitamos a 3 por query → 6 pairs.
    ce = _CrossEncoderLike([[0.1, 0.2, 0.3, 0.4, 0.5, 0.6]])
    reranker = BgeReranker(model=ce)
    qc = [
        ("q1", [_cand(f"A{i}", f"a{i}") for i in range(10)]),
        ("q2", [_cand(f"B{i}", f"b{i}") for i in range(10)]),
    ]
    reranker.batch_rerank(qc, top_n=3, max_input_candidates=3)
    # Solo 6 pairs llegaron al modelo (2 × 3).
    assert len(ce.predict_calls[0]) == 6


def test_batch_rerank_handles_empty_input():
    """`batch_rerank` con lista vacía devuelve lista vacía sin llamar al modelo."""
    ce = _CrossEncoderLike([])
    reranker = BgeReranker(model=ce)
    out = reranker.batch_rerank([], top_n=3)
    assert out == []
    assert ce.predict_calls == []


def test_batch_rerank_handles_query_with_empty_candidates():
    """Una query con candidates vacíos devuelve `[]` para esa posición."""
    # 2 queries; la primera sin candidates, la segunda con 2.
    ce = _CrossEncoderLike([[0.5, 0.7]])
    reranker = BgeReranker(model=ce)
    qc = [
        ("q1", []),  # sin candidates
        ("q2", [_cand("A", "a"), _cand("B", "b")]),
    ]
    results = reranker.batch_rerank(qc, top_n=2)
    assert results[0] == []
    assert len(results[1]) == 2


def test_batch_rerank_handles_predict_exception_with_fallback():
    """Si el predict revienta, devolvemos top_n por query con score=0."""
    class _BoomModel:
        def predict(self, pairs, batch_size=0):
            raise RuntimeError("oom")

    reranker = BgeReranker(model=_BoomModel())
    qc = [
        ("q1", [_cand("A", "a"), _cand("B", "b")]),
        ("q2", [_cand("C", "c")]),
    ]
    results = reranker.batch_rerank(qc, top_n=2)
    assert len(results) == 2
    assert [c["id"] for c, _ in results[0]] == ["A", "B"]
    assert [c["id"] for c, _ in results[1]] == ["C"]
    # Todos los scores fallback son 0.
    assert all(s == 0.0 for _, s in results[0])


def test_is_enabled_default_true():
    """`is_enabled()` devuelve True por defecto."""
    assert is_enabled(env={}) is True


def test_is_enabled_false_with_explicit_falsy():
    """`is_enabled()` devuelve False con valores falsy explícitos."""
    for val in ["false", "False", "FALSE", "0", "no", "NO", "off", "OFF"]:
        assert is_enabled(env={"ENABLE_BGE_RERANK": val}) is False, val


def test_is_enabled_true_with_truthy_or_unrecognized():
    """`is_enabled()` devuelve True con valores no falsy."""
    for val in ["true", "1", "yes", "on", "anything", ""]:
        # Empty string también True (defaults a habilitado).
        result = is_enabled(env={"ENABLE_BGE_RERANK": val})
        if val == "":
            # Empty falls through to default = True.
            assert result is True, val
        else:
            assert result is True, val


def test_batch_rerank_speedup_over_sequential():
    """Sanity: con N queries, `batch_rerank` hace 1 call vs N calls."""
    # 8 queries × 5 candidates = 40 pairs.
    ce = _CrossEncoderLike([[float(i) for i in range(40)]])
    reranker = BgeReranker(model=ce)
    qc = [
        (f"q{q}", [_cand(f"C{q}_{i}", f"desc {q}_{i}") for i in range(5)])
        for q in range(8)
    ]
    reranker.batch_rerank(qc, top_n=3)
    # Asserción crítica: UN SOLO predict call (no 8).
    assert len(ce.predict_calls) == 1
    # 40 pairs en ese único call.
    assert len(ce.predict_calls[0]) == 40
