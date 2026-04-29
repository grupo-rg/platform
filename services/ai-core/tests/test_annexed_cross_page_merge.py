"""Fase 7.B — cross-page merge en el reduce del `AnnexedPdfExtractorService`.

Invariantes:
  1. Si la página N tiene `last_item_truncated=True` y la última partida
     termina con descripción corta, y la página N+1 tiene `orphan_tail_text`
     con texto real, el reduce fusiona el tail a la descripción de esa última
     partida.
  2. Si N no marca `last_item_truncated`, aunque N+1 tenga `orphan_tail_text`,
     el texto huérfano se IGNORA (la señal autoritativa es N, no N+1 — evita
     fusiones falsas si el LLM se equivoca).
  3. Una vez consumido, `orphan_tail_text` de N+1 se vacía para evitar
     fusiones cascada.
  4. Se emite un evento SSE `cross_page_merge_annexed` con metadata del merge.
  5. Caso real (SANITAS C04.02): título "SOLADO GRES PORCELÁNICO 120 x 20 CM"
     + tail "Suministro y colocación... criterio de medición..." → descripción
     final ≥ 200 chars reconocible.
"""
from __future__ import annotations

import asyncio
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


def _build_fake_llm(
    *,
    page_a: Phase1Result,
    page_b: Phase1Result,
    summ: Phase2Result,
) -> ILLMProvider:
    """Fake LLM que devuelve Phase1Result por páginas descriptivas según el
    orden de llegada y Phase2Result para la página sumatoria."""
    call_state = {"desc_calls": 0}

    class _FakeLLM(ILLMProvider):
        async def generate_structured(
            self, system_prompt, user_prompt, response_schema, **kwargs
        ):
            name = response_schema.__name__
            if name == "Phase1Result":
                idx = call_state["desc_calls"]
                call_state["desc_calls"] += 1
                # asumimos 2 páginas descriptivas en los tests de merge
                return (page_a if idx == 0 else page_b), {}
            if name == "Phase2Result":
                return summ, {}
            raise AssertionError(f"Schema inesperado: {name}")

        async def get_embedding(self, text: str):
            return [0.0] * 768

    return _FakeLLM()


def _make_page(image: str, is_summatory: bool = False) -> Dict[str, Any]:
    return {"image_base64": image, "is_summatory": is_summatory}


# -------- Invariante 1: merge cuando N truncated + N+1 orphan -------------


def test_merges_orphan_tail_into_truncated_last_item_description() -> None:
    short_title = "SOLADO GRES PORCELÁNICO 120 x 20 CM"
    long_tail = (
        "Suministro y colocación de solado de gres porcelánico CIFRE - MODELO "
        "BAVARO MIEL MATE, CLASE 1, en baldosas de 120 x 20 cm, recibido con "
        "cemento cola. Criterio de medición: superficie útil a ejecutar."
    )
    page_a = Phase1Result(
        items=[DescriptionItem(
            code="C04.02",
            description=short_title,
            unit="m2",
            chapter="C04 ALICATADOS",
        )],
        last_item_truncated=True,
    )
    page_b = Phase1Result(
        items=[],
        orphan_tail_text=long_tail,
    )
    summ = Phase2Result(items=[SummatoryItem(code="0402", total_quantity=108.46)])

    svc = AnnexedPdfExtractorService(
        llm_provider=_build_fake_llm(page_a=page_a, page_b=page_b, summ=summ),
        emitter=_SpyEmitter(),
    )
    pages = [
        _make_page("img-desc-a"),
        _make_page("img-desc-b"),
        _make_page("img-summ", is_summatory=True),
    ]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}

    result = asyncio.run(svc.extract(pages, budget_id="b-7b", metrics=metrics))

    assert len(result) == 1
    merged = result[0].description
    assert short_title in merged
    assert "BAVARO" in merged
    assert "cemento cola" in merged
    assert len(merged) >= 200


# -------- Invariante 2: sin flag, no merge -------------------------------


def test_does_not_merge_when_not_flagged_truncated() -> None:
    page_a = Phase1Result(
        items=[DescriptionItem(
            code="C01.05",
            description="DEMOLICIÓN DE MAMPARAS",
            unit="m2",
            chapter="C01 DEMOLICIONES",
        )],
        last_item_truncated=False,  # explícito
    )
    page_b = Phase1Result(
        items=[],
        orphan_tail_text="Este texto NO debe fusionarse porque N no flaggeó truncate.",
    )
    summ = Phase2Result(items=[SummatoryItem(code="0105", total_quantity=2.0)])

    svc = AnnexedPdfExtractorService(
        llm_provider=_build_fake_llm(page_a=page_a, page_b=page_b, summ=summ),
        emitter=_SpyEmitter(),
    )
    pages = [
        _make_page("img-a"),
        _make_page("img-b"),
        _make_page("img-summ", is_summatory=True),
    ]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}

    result = asyncio.run(svc.extract(pages, budget_id="b-7b-nf", metrics=metrics))

    assert len(result) == 1
    assert result[0].description == "DEMOLICIÓN DE MAMPARAS"
    assert "NO debe fusionarse" not in result[0].description


# -------- Invariante 3: evento SSE emitido con metadata correcta ---------


def test_emits_cross_page_merge_event() -> None:
    page_a = Phase1Result(
        items=[DescriptionItem(
            code="C04.02",
            description="SOLADO GRES PORCELÁNICO 120 x 20 CM",
            unit="m2",
            chapter="C04 ALICATADOS",
        )],
        last_item_truncated=True,
    )
    page_b = Phase1Result(
        items=[],
        orphan_tail_text="Suministro y colocación...",
    )
    summ = Phase2Result(items=[SummatoryItem(code="0402", total_quantity=108.46)])
    emitter = _SpyEmitter()
    svc = AnnexedPdfExtractorService(
        llm_provider=_build_fake_llm(page_a=page_a, page_b=page_b, summ=summ),
        emitter=emitter,
    )
    pages = [
        _make_page("img-a"),
        _make_page("img-b"),
        _make_page("img-summ", is_summatory=True),
    ]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}

    asyncio.run(svc.extract(pages, budget_id="b-evt", metrics=metrics))

    merge_events = [e for e in emitter.events if e["type"] == "cross_page_merge_annexed"]
    assert len(merge_events) == 1
    data = merge_events[0]["data"]
    assert data["partida_code"] == "C04.02"
    assert data["from_page"] == 1
    assert data["to_page"] == 2
    assert data["tail_chars"] > 0


# -------- Invariante 4: orphan_tail_text se consume (no re-uso) ----------


def test_orphan_tail_is_consumed_after_merge() -> None:
    """Invariante: tras fusionar, la cola queda vaciada en N+1. Si hubiera una
    cadena larga de merges, esto evita que el mismo texto se propague."""
    page_a = Phase1Result(
        items=[DescriptionItem(
            code="C04.02",
            description="TITULO BREVE",
            unit="m2",
            chapter="C04 ALICATADOS",
        )],
        last_item_truncated=True,
    )
    page_b = Phase1Result(
        items=[DescriptionItem(
            code="C04.03",
            description="OTRA PARTIDA COMPLETA",
            unit="m2",
            chapter="C04 ALICATADOS",
        )],
        orphan_tail_text="descripción continuación de C04.02",
    )
    summ = Phase2Result(items=[
        SummatoryItem(code="0402", total_quantity=10.0),
        SummatoryItem(code="0403", total_quantity=20.0),
    ])
    svc = AnnexedPdfExtractorService(
        llm_provider=_build_fake_llm(page_a=page_a, page_b=page_b, summ=summ),
        emitter=_SpyEmitter(),
    )
    pages = [
        _make_page("img-a"),
        _make_page("img-b"),
        _make_page("img-summ", is_summatory=True),
    ]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}

    result = asyncio.run(svc.extract(pages, budget_id="b-consume", metrics=metrics))

    by_code = {r.code: r for r in result}
    # C04.02 debe tener la continuación fusionada.
    assert "descripción continuación" in by_code["C04.02"].description
    # C04.03 debe mantener su propia descripción intacta, SIN la cola de C04.02.
    assert by_code["C04.03"].description == "OTRA PARTIDA COMPLETA"
    assert "continuación de C04.02" not in by_code["C04.03"].description
