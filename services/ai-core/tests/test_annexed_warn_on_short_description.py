"""Fase 7.C — guard rail: WARNING cuando una descripción queda corta tras reduce.

Si 7.B falla en un layout raro (p.ej. el LLM no emite `orphan_tail_text` aunque
el bloque existe), el item llega al Swarm con descripción pobre y el Judge
aluciná un precio. Este guard no ARREGLA el caso — pero emite una señal
explícita (log + evento SSE `partida_description_short`) para que el operador
la vea y pueda intervenir.

Política: NO se filtra el item ni se aborta el pipeline. Mejor un item dudoso
con señal que un pipeline roto.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List

from src.budget.application.ports.ports import (
    IGenerationEmitter,
    ILLMProvider,
    IVectorSearch,
)
from src.budget.application.services.pdf_extractor_service import (
    AnnexedPdfExtractorService,
    DescriptionItem,
    Phase1Result,
    Phase2Result,
    SummatoryItem,
)


class _SpyEmitter(IGenerationEmitter):
    def __init__(self):
        self.events: List[Dict[str, Any]] = []

    def emit_event(self, budget_id: str, event_type: str, data: Dict[str, Any]) -> None:
        self.events.append({"budget_id": budget_id, "type": event_type, "data": data})


def _build_fake_llm(phase1: Phase1Result, phase2: Phase2Result) -> ILLMProvider:
    class _FakeLLM(ILLMProvider):
        async def generate_structured(
            self, system_prompt, user_prompt, response_schema, **kwargs
        ):
            name = response_schema.__name__
            if name == "Phase1Result":
                return phase1, {}
            if name == "Phase2Result":
                return phase2, {}
            raise AssertionError(f"Schema inesperado: {name}")

        async def get_embedding(self, text: str):
            return [0.0] * 768

    return _FakeLLM()


def _page(image: str, is_summatory: bool = False) -> Dict[str, Any]:
    return {"image_base64": image, "is_summatory": is_summatory}


def test_emits_short_description_event_when_under_threshold() -> None:
    """Una partida con descripción < 50 chars post-reduce dispara el guard."""
    phase1 = Phase1Result(
        items=[DescriptionItem(
            code="C04.02",
            description="SOLADO GRES",  # 11 chars, muy por debajo del umbral
            unit="m2",
            chapter="C04 ALICATADOS",
        )],
    )
    phase2 = Phase2Result(items=[SummatoryItem(code="0402", total_quantity=100.0)])
    emitter = _SpyEmitter()
    svc = AnnexedPdfExtractorService(
        llm_provider=_build_fake_llm(phase1, phase2),
        emitter=emitter,
    )
    pages = [_page("a"), _page("b", is_summatory=True)]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}

    result = asyncio.run(svc.extract(pages, budget_id="b-short", metrics=metrics))

    assert len(result) == 1  # el item sigue — la política es log, no filtrar
    short_events = [e for e in emitter.events if e["type"] == "partida_description_short"]
    assert len(short_events) == 1
    data = short_events[0]["data"]
    assert data["code"] == "C04.02"
    assert data["chars"] == 11
    assert data["chapter"] == "C04 ALICATADOS"


def test_does_not_emit_when_description_is_long_enough() -> None:
    phase1 = Phase1Result(
        items=[DescriptionItem(
            code="C01.05",
            description=(
                "Demolición de mamparas de vidrio, madera o metálicas con sus "
                "estructuras. Se incluyen todos los trabajos de recogida de "
                "escombros, materiales, carga sobre camión y transporte a "
                "vertedero autorizado."
            ),
            unit="m2",
            chapter="C01 DEMOLICIONES",
        )],
    )
    phase2 = Phase2Result(items=[SummatoryItem(code="0105", total_quantity=2.0)])
    emitter = _SpyEmitter()
    svc = AnnexedPdfExtractorService(
        llm_provider=_build_fake_llm(phase1, phase2),
        emitter=emitter,
    )
    pages = [_page("a"), _page("b", is_summatory=True)]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}

    asyncio.run(svc.extract(pages, budget_id="b-ok", metrics=metrics))

    short_events = [e for e in emitter.events if e["type"] == "partida_description_short"]
    assert short_events == []


def test_logs_warning_with_code_and_chars(caplog) -> None:
    phase1 = Phase1Result(
        items=[DescriptionItem(
            code="C04.02",
            description="MUY CORTO",  # 9 chars
            unit="m2",
            chapter="C04 ALICATADOS",
        )],
    )
    phase2 = Phase2Result(items=[SummatoryItem(code="0402", total_quantity=10.0)])
    svc = AnnexedPdfExtractorService(
        llm_provider=_build_fake_llm(phase1, phase2),
        emitter=_SpyEmitter(),
    )
    pages = [_page("a"), _page("b", is_summatory=True)]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}

    with caplog.at_level(logging.WARNING):
        asyncio.run(svc.extract(pages, budget_id="b-log", metrics=metrics))

    warnings_about_short = [
        r for r in caplog.records
        if r.levelname == "WARNING" and "C04.02" in r.getMessage()
    ]
    assert len(warnings_about_short) >= 1
    # El log debe incluir la longitud efectiva de la descripción.
    assert any("9" in r.getMessage() for r in warnings_about_short)
