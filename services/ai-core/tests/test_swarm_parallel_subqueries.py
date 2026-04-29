"""Fase 9.6 — Paralelizar subqueries dentro de `_firestore_vector_swarm`.

Hoy una partida con 3 sub-queries hace 3 embeddings + 3 vector searches
SECUENCIALES. Con asyncio.gather los 3 corren en paralelo → ~3× speedup
en el path del swarm vectorial cuando el deconstructor genera múltiples
sub-queries (caso típico para partidas 1:N).
"""
from __future__ import annotations

import asyncio
import time
from typing import Any, Dict, List

from src.budget.application.ports.ports import ILLMProvider, IVectorSearch
from src.budget.application.services.swarm_pricing_service import (
    SwarmPricingService,
)


class _SlowLLM(ILLMProvider):
    """Embedding que tarda 100ms — para medir paralelismo."""

    def __init__(self):
        self.embed_calls = 0

    async def generate_structured(self, *args, **kwargs):
        raise AssertionError("Not used in this test")

    async def get_embedding(self, text: str):
        self.embed_calls += 1
        await asyncio.sleep(0.10)
        return [0.0] * 768


class _SlowVectorSearch(IVectorSearch):
    """Vector search que devuelve 1 candidato por query, también con 100ms."""

    def __init__(self):
        self.search_calls = 0

    async def search_similar_items(self, query_vector, query_text, limit=4, **kwargs):
        self.search_calls += 1
        await asyncio.sleep(0.10)
        return [{"id": f"C-{query_text[:8]}", "description": query_text, "matchScore": 0.9, "unit": "m2"}]


def test_subqueries_run_in_parallel_not_serial():
    """Con 3 queries: si fueran serial → 3×(100+100)=600ms; en paralelo → ~200ms."""
    llm = _SlowLLM()
    vs = _SlowVectorSearch()
    svc = SwarmPricingService(llm_provider=llm, vector_search=vs)

    queries = ["query_A", "query_B", "query_C"]
    t0 = time.perf_counter()
    candidates = asyncio.run(svc._firestore_vector_swarm(queries))
    elapsed_ms = (time.perf_counter() - t0) * 1000

    # Serial: 3*(100+100) = 600ms. Parallel: ~200ms (max de cada par embed+search).
    # Margen de holgura para latencia del runner (200ms ± 150).
    assert elapsed_ms < 400, f"Esperado < 400ms (paralelo), real: {elapsed_ms:.0f}ms"
    assert llm.embed_calls == 3
    assert vs.search_calls == 3
    # Los 3 candidatos vuelven dedupeados (diferentes ids).
    assert len(candidates) == 3
    assert all(c["id"].startswith("C-") for c in candidates)


def test_partial_subquery_failure_does_not_break_swarm():
    """Si una de las subqueries falla, el resto sigue."""

    class _PartiallyFailingLLM(ILLMProvider):
        def __init__(self):
            self.calls = 0

        async def generate_structured(self, *args, **kwargs):
            raise AssertionError("not used")

        async def get_embedding(self, text: str):
            self.calls += 1
            if "BAD" in text:
                raise RuntimeError("simulated embedding failure")
            return [0.0] * 768

    llm = _PartiallyFailingLLM()
    vs = _SlowVectorSearch()
    svc = SwarmPricingService(llm_provider=llm, vector_search=vs)
    candidates = asyncio.run(svc._firestore_vector_swarm(
        ["good_query", "BAD_query", "another_good"]
    ))
    # 2 buenas → 2 candidatos sobreviven.
    assert len(candidates) == 2


def test_dedupes_candidates_across_subqueries():
    """Si dos subqueries devuelven el mismo `id`, solo aparece una vez."""

    class _DupeVS(IVectorSearch):
        async def search_similar_items(self, query_vector, query_text, limit=4, **kwargs):
            # Siempre devuelve el mismo candidato → debe dedupar.
            return [{"id": "DUPE", "description": "x", "matchScore": 0.9, "unit": "m2"}]

    llm = _SlowLLM()
    svc = SwarmPricingService(llm_provider=llm, vector_search=_DupeVS())
    candidates = asyncio.run(svc._firestore_vector_swarm(["q1", "q2", "q3"]))
    assert len(candidates) == 1
    assert candidates[0]["id"] == "DUPE"
