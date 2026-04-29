"""Fase 5.B — el `InlinePdfExtractorService` propaga `unit_conversion_hints`
emitidos por el LLM sin tocarlos.

La detección del puente físico ("10 cm de grava", "densidad 2400 kg/m³",
"piezas de 3 m") se delega al LLM de visión porque exige leer la descripción
en lenguaje natural. La regla nueva en `restructure_image_vision.prompt`
(#24) le dice cómo emitirlos. ESTE test NO valida la detección del LLM — eso
es verificación manual con el prompt real contra imágenes. Valida sólo que
**el pipeline del extractor propaga el campo aguas abajo sin tocarlo**.

Casos cubiertos:
  1. LLM emite un hint de espesor → llega intacto al Swarm.
  2. LLM NO emite hints → el campo queda en `None`, sin crash.
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional, Type

from pydantic import BaseModel

from src.budget.application.ports.ports import ILLMProvider
from src.budget.application.services.pdf_extractor_service import (
    InlinePdfExtractorService,
    RestructureChunkResult,
    RestructuredItem,
)


class _FakeLLM(ILLMProvider):
    def __init__(self, items: List[RestructuredItem]):
        self._items = items

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
        return (
            RestructureChunkResult(
                items=self._items,
                has_more_items=False,
                last_extracted_code="",
            ),
            usage,
        )

    async def get_embedding(self, text: str):  # pragma: no cover
        return [0.0] * 768


def _run_extractor(items: List[RestructuredItem]) -> List[RestructuredItem]:
    svc = InlinePdfExtractorService(llm_provider=_FakeLLM(items))
    raw_pages = [{"image_base64": "fake"}]
    metrics: Dict[str, float] = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    return asyncio.run(svc.extract(raw_pages, budget_id="t-5b-hints", metrics=metrics))


def test_extractor_propagates_thickness_hint_from_llm() -> None:
    items = [
        RestructuredItem(
            code="1.1",
            description="Meter 10 cm de grava, 40-60mm, 50 m2",
            quantity=50.0,
            unit="m2",
            chapter="C01 MOVIMIENTO DE TIERRAS",
            unit_conversion_hints={"thickness_m": 0.10},
        )
    ]
    result = _run_extractor(items)

    assert len(result) == 1
    assert result[0].unit_conversion_hints == {"thickness_m": 0.10}


def test_extractor_leaves_hints_none_when_llm_does_not_emit() -> None:
    items = [
        RestructuredItem(
            code="2.1",
            description="Excavación en zanja, medios mecánicos.",
            quantity=12.0,
            unit="m3",
            chapter="C01 MOVIMIENTO DE TIERRAS",
            # unit_conversion_hints no se especifica → default None.
        )
    ]
    result = _run_extractor(items)

    assert len(result) == 1
    assert result[0].unit_conversion_hints is None


def test_extractor_propagates_density_hint() -> None:
    items = [
        RestructuredItem(
            code="3.1",
            description="Hormigón HA-25, densidad 2400 kg/m³.",
            quantity=8.0,
            unit="m3",
            chapter="C02 HORMIGONES",
            unit_conversion_hints={"density_kg_m3": 2400.0},
        )
    ]
    result = _run_extractor(items)

    assert result[0].unit_conversion_hints == {"density_kg_m3": 2400.0}


def test_extractor_propagates_piece_length_hint() -> None:
    items = [
        RestructuredItem(
            code="4.1",
            description="Tubería PVC Ø110, tubos de 3.00 m.",
            quantity=24.0,
            unit="ml",
            chapter="C03 FONTANERIA",
            unit_conversion_hints={"piece_length_m": 3.0},
        )
    ]
    result = _run_extractor(items)

    assert result[0].unit_conversion_hints == {"piece_length_m": 3.0}
