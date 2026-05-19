"""S2-A-01 — Cooperative cancellation real (asyncio.Event propagation).

El runner crea un `asyncio.Event` y un poller que lo flipea cuando
Firestore tiene `cancellation_requested=true`. Entre partidas, el swarm
checkea `cancellation_event.is_set()` y, si está set, levanta
`asyncio.CancelledError` para que:
  - El use case marque el job `canceled`.
  - El worker_main exit 143 (SIGTERM convention).
  - No se quemen tokens adicionales del LLM.

Criterio:
  - Una cancel a los 5s materializa < 10s (no espera a que todas las
    partidas terminen).
  - El evento `cancellation_acknowledged` se emite con el stage en
    que se detectó.
"""
from __future__ import annotations

import asyncio
import time
from typing import Any, Dict, List

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
    PricingFinalResultDB,
    SwarmPricingService,
)


class _SlowLLM(ILLMProvider):
    """LLM mock que duerme 1s por llamada de pricing. Útil para simular
    una carga lo bastante larga para que la cancellation pueda intervenir.
    """
    def __init__(self):
        self.pricing_calls = 0

    async def generate_structured(self, system_prompt, user_prompt, response_schema, **kwargs):
        name = response_schema.__name__
        if name == "DeconstructResult":
            return response_schema(is_complex=False, queries=["q"]), {}
        if name == "BatchPricingEvaluatorResultV3":
            self.pricing_calls += 1
            await asyncio.sleep(1.0)  # simula latency real del Pro
            # Recuperamos el code del prompt para mantener el assembly correcto.
            import re
            m = re.search(r"PARTIDA CÓDIGO: (\S+)", user_prompt)
            code = m.group(1) if m else "X.0"
            return (
                BatchPricingEvaluatorResultV3(results=[
                    BatchPricedItemV3(
                        item_code=code,
                        valuation=PricingFinalResultDB(
                            pensamiento_calculista="ok",
                            calculated_unit_price=10.0,
                            needs_human_review=False,
                            match_kind="1:1",
                        ),
                    ),
                ]),
                {"promptTokenCount": 10, "candidatesTokenCount": 5, "totalTokenCount": 15},
            )
        raise AssertionError(name)

    async def get_embedding(self, text: str):
        return [0.0] * 768


class _StubVS(IVectorSearch):
    def search_similar_items(self, query_vector, query_text, limit=4, **kwargs):
        return [{"id": "C1", "code": "C1", "description": "X", "matchScore": 0.9, "unit": "m2", "priceTotal": 10.0}]


class _SpyEmitter(IGenerationEmitter):
    def __init__(self):
        self.events: List[Dict[str, Any]] = []

    def emit_event(self, budget_id, event_type, data):
        self.events.append({"type": event_type, "data": data})


@pytest.mark.asyncio
async def test_cancellation_event_already_set_aborts_before_llm(monkeypatch):
    """Si `cancellation_event` ya está set al entrar a `evaluate_batch`,
    el swarm raisea CancelledError inmediatamente sin tocar el LLM."""
    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", kwargs.get("batch_items", "")),
    )

    llm = _SlowLLM()
    emitter = _SpyEmitter()
    svc = SwarmPricingService(
        llm_provider=llm,
        vector_search=_StubVS(),
        emitter=emitter,
    )

    items = [RestructuredItem(
        code=f"X.{i}", description="x", quantity=1.0, unit="m2", chapter="C",
    ) for i in range(5)]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}

    event = asyncio.Event()
    event.set()  # set BEFORE the call

    with pytest.raises(asyncio.CancelledError):
        await svc.evaluate_batch(
            items, budget_id="b-cancel-early", metrics=metrics,
            cancellation_event=event,
        )

    # El LLM no se invocó.
    assert llm.pricing_calls == 0
    # El evento `cancellation_acknowledged` se emitió con stage 'pricing_start'.
    acks = [e for e in emitter.events if e["type"] == "cancellation_acknowledged"]
    assert acks, "Debe emitir cancellation_acknowledged"
    assert acks[0]["data"]["stage"] == "pricing_start"


@pytest.mark.asyncio
async def test_cancellation_during_processing_stops_within_seconds(monkeypatch):
    """Set el evento a los 0.5s; el swarm debe responder en < 5s (no
    esperar a que las 8 partidas concurrentes terminen).
    """
    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", kwargs.get("batch_items", "")),
    )

    # Reducimos concurrencia a 1 para que se procesen secuencialmente y la
    # cancellation pueda intervenir antes de que todas terminen.
    monkeypatch.setenv("SWARM_CONCURRENCY", "1")

    llm = _SlowLLM()
    emitter = _SpyEmitter()
    svc = SwarmPricingService(
        llm_provider=llm,
        vector_search=_StubVS(),
        emitter=emitter,
    )

    # 20 partidas × 1s/partida = 20s sin cancellation. Si cancellation
    # funciona, debería parar en < 5s.
    items = [RestructuredItem(
        code=f"X.{i}", description=f"x{i}", quantity=1.0, unit="m2", chapter="C",
    ) for i in range(20)]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}

    event = asyncio.Event()

    async def _trigger_cancel():
        await asyncio.sleep(0.5)
        event.set()

    start = time.monotonic()
    cancel_task = asyncio.create_task(_trigger_cancel())
    with pytest.raises(asyncio.CancelledError):
        await svc.evaluate_batch(
            items, budget_id="b-cancel-mid", metrics=metrics,
            cancellation_event=event,
        )
    elapsed = time.monotonic() - start
    await cancel_task

    # Debería haber parado mucho antes de los 20s teóricos.
    assert elapsed < 10.0, f"Cancellation tardó demasiado: {elapsed:.2f}s"
    # Pero al menos una partida pudo empezar (vs early-out).
    assert llm.pricing_calls >= 1
    # Y NO terminamos las 20 partidas (cancellation tuvo efecto).
    assert llm.pricing_calls < 20, (
        f"Cancellation falló: se ejecutaron {llm.pricing_calls}/20 partidas"
    )

    # El emit de acknowledgement debe estar presente.
    acks = [e for e in emitter.events if e["type"] == "cancellation_acknowledged"]
    assert acks


@pytest.mark.asyncio
async def test_no_cancellation_event_does_not_break_pipeline(monkeypatch):
    """Llamar a `evaluate_batch` sin pasar `cancellation_event` (legacy
    path) sigue funcionando — el kwarg es opcional con default None.
    """
    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", kwargs.get("batch_items", "")),
    )

    llm = _SlowLLM()
    svc = SwarmPricingService(
        llm_provider=llm,
        vector_search=_StubVS(),
        emitter=_SpyEmitter(),
    )

    items = [RestructuredItem(
        code="X.1", description="x", quantity=1.0, unit="m2", chapter="C",
    )]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}

    # Sin cancellation_event — debe funcionar.
    priced = await svc.evaluate_batch(
        items, budget_id="b-no-cancel", metrics=metrics,
    )
    assert len(priced) == 1
    assert llm.pricing_calls == 1


@pytest.mark.asyncio
async def test_cancellation_event_unset_processes_all_items(monkeypatch):
    """Pasar `cancellation_event` pero NO setearlo nunca → procesamiento
    completo (sanity).
    """
    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", kwargs.get("batch_items", "")),
    )

    llm = _SlowLLM()
    svc = SwarmPricingService(
        llm_provider=llm,
        vector_search=_StubVS(),
        emitter=_SpyEmitter(),
    )

    items = [RestructuredItem(
        code="X.1", description="x", quantity=1.0, unit="m2", chapter="C",
    )]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}

    event = asyncio.Event()  # nunca se setea

    priced = await svc.evaluate_batch(
        items, budget_id="b-unset", metrics=metrics,
        cancellation_event=event,
    )
    assert len(priced) == 1
    assert llm.pricing_calls == 1
