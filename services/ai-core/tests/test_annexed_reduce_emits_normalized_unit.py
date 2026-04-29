"""Fase 5.D — el Reduce del `AnnexedPdfExtractorService` normaliza la unidad y
propaga `unit_conversion_hints` al ensamblar el `RestructuredItem` final.

El Reduce de ANNEXED cruza:
  - `DescriptionItem` de la Phase1 (code, description, unit, chapter)
  - `SummatoryItem` de la Phase2 (code, total_quantity)
y construye el `RestructuredItem` que entra al Swarm. Para paridad con el
flujo INLINE (5.B), aquí también aplicamos `Unit.normalize()` + `Unit.dimension_of()`
y propagamos los hints que la Phase1 haya emitido.

Decisión: los hints viven en `DescriptionItem` (Phase1), no en `Phase2Result`.
Phase2 es puramente numérica (totales por código); los puentes físicos
(espesor, densidad, tamaño unitario) sólo aparecen en el texto descriptivo,
por lo que el único lugar coherente para capturarlos es Phase1.
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional, Type

from pydantic import BaseModel

from src.budget.application.ports.ports import ILLMProvider
from src.budget.application.services.pdf_extractor_service import (
    AnnexedPdfExtractorService,
    DescriptionItem,
    Phase1Result,
    Phase2Result,
    SummatoryItem,
)


class _FakeLLM(ILLMProvider):
    """Devuelve un Phase1 y Phase2 pre-cocinados según el schema pedido."""

    def __init__(self, phase1: Phase1Result, phase2: Phase2Result):
        self.phase1 = phase1
        self.phase2 = phase2

    async def generate_structured(
        self,
        system_prompt: str,
        user_prompt: str,
        response_schema: Type[BaseModel],
        temperature: float = 0.2,
        model: str = "gemini-2.5-flash",
        image_base64: Optional[str] = None,
        max_output_tokens: int = 8192,
    ) -> tuple[BaseModel, Dict[str, int]]:
        usage = {"promptTokenCount": 0, "candidatesTokenCount": 0, "totalTokenCount": 0}
        if response_schema is Phase1Result:
            return self.phase1, usage
        if response_schema is Phase2Result:
            return self.phase2, usage
        raise AssertionError(f"Schema inesperado: {response_schema.__name__}")

    async def get_embedding(self, text: str):  # pragma: no cover
        return [0.0] * 768


def _run(phase1: Phase1Result, phase2: Phase2Result):
    svc = AnnexedPdfExtractorService(llm_provider=_FakeLLM(phase1, phase2))
    pages = [
        {"image_base64": "desc1", "is_summatory": False},
        {"image_base64": "sum1", "is_summatory": True},
    ]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    return asyncio.run(svc.extract(pages, budget_id="t-5d-reduce", metrics=metrics))


def test_reduce_normalizes_unit_and_derives_dimension() -> None:
    phase1 = Phase1Result(
        items=[
            DescriptionItem(
                code="1.1",
                description="Tabique de ladrillo cerámico hueco doble.",
                unit="M²",
                chapter="C01 FABRICAS Y TABIQUES",
            )
        ],
        has_more_items=False,
    )
    phase2 = Phase2Result(items=[SummatoryItem(code="1.1", total_quantity=45.0)])

    result = _run(phase1, phase2)

    assert len(result) == 1
    assert result[0].unit == "M²"  # unit original preservada
    assert result[0].unit_normalized == "m2"
    assert result[0].unit_dimension == "superficie"
    assert result[0].quantity == 45.0


def test_reduce_propagates_unit_conversion_hints_from_phase1() -> None:
    phase1 = Phase1Result(
        items=[
            DescriptionItem(
                code="2.1",
                description="Capa de grava 10 cm sobre explanada, 50 m2.",
                unit="m2",
                chapter="C02 MOVIMIENTO DE TIERRAS",
                unit_conversion_hints={"thickness_m": 0.10},
            )
        ],
        has_more_items=False,
    )
    phase2 = Phase2Result(items=[SummatoryItem(code="2.1", total_quantity=50.0)])

    result = _run(phase1, phase2)

    assert result[0].unit_conversion_hints == {"thickness_m": 0.10}


def test_reduce_leaves_hints_none_when_phase1_does_not_emit() -> None:
    phase1 = Phase1Result(
        items=[
            DescriptionItem(
                code="3.1",
                description="Excavación en zanja, medios mecánicos.",
                unit="m3",
                chapter="C02 MOVIMIENTO DE TIERRAS",
            )
        ],
        has_more_items=False,
    )
    phase2 = Phase2Result(items=[SummatoryItem(code="3.1", total_quantity=12.0)])

    result = _run(phase1, phase2)

    assert result[0].unit_conversion_hints is None


def test_reduce_handles_unknown_unit_without_crashing() -> None:
    phase1 = Phase1Result(
        items=[
            DescriptionItem(
                code="4.1",
                description="Partida rara.",
                unit="xyz",
                chapter="VARIOS",
            )
        ],
        has_more_items=False,
    )
    phase2 = Phase2Result(items=[SummatoryItem(code="4.1", total_quantity=1.0)])

    result = _run(phase1, phase2)

    assert result[0].unit_normalized is None
    assert result[0].unit_dimension is None
