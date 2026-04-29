"""Fase 5.B — el `InlinePdfExtractorService` normaliza la unidad aguas abajo.

El LLM de visión escribe la unidad como la ve en el papel ("Ud", "M²", "mts",
"M3"). El Swarm necesita el canonical ("ud", "m2", "ml", "m3") + la dimensión
física ("discreto", "superficie", "lineal", "volumen") para filtrar candidatos
dimensionalmente compatibles. Este test fija que la normalización ocurre en el
post-processing del extractor (server-side, determinista) y no se delega al LLM.

Caso borde: si el LLM escribe una unidad irreconocible ("xyz"), el extractor
NO debe crashear — `unit_normalized` y `unit_dimension` quedan en `None` y el
Swarm lo verá como "dimensión desconocida" (la rama de degradación ya existe).
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional, Type

import pytest
from pydantic import BaseModel

from src.budget.application.ports.ports import ILLMProvider
from src.budget.application.services.pdf_extractor_service import (
    InlinePdfExtractorService,
    RestructureChunkResult,
    RestructuredItem,
)


class _FakeLLM(ILLMProvider):
    """Devuelve un `RestructureChunkResult` pre-cocinado con las unidades que
    el test quiera probar. Ignora completamente la imagen y el prompt."""

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

    async def get_embedding(self, text: str):  # pragma: no cover — no usado aquí
        return [0.0] * 768


def _run_extractor(items: List[RestructuredItem]) -> List[RestructuredItem]:
    svc = InlinePdfExtractorService(llm_provider=_FakeLLM(items))
    raw_pages = [{"image_base64": "fake"}]
    metrics: Dict[str, float] = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    return asyncio.run(svc.extract(raw_pages, budget_id="t-5b", metrics=metrics))


@pytest.mark.parametrize(
    "raw_unit, expected_canonical, expected_dimension",
    [
        ("Ud", "ud", "discreto"),
        ("UD", "ud", "discreto"),
        ("u", "ud", "discreto"),
        ("m²", "m2", "superficie"),
        ("M2", "m2", "superficie"),
        ("m³", "m3", "volumen"),
        ("mts", "ml", "lineal"),
        ("Kg", "kg", "masa"),
        ("Hora", "h", "tiempo"),
    ],
)
def test_extractor_sets_unit_normalized_and_dimension(
    raw_unit: str, expected_canonical: str, expected_dimension: str
) -> None:
    items = [
        RestructuredItem(
            code="1.1",
            description="Partida con unidad en jerga.",
            quantity=1.0,
            unit=raw_unit,
            chapter="C01 PRUEBA",
        )
    ]
    result = _run_extractor(items)

    assert len(result) == 1, "el filtro anti-fantasmas debe preservar el item con code"
    assert result[0].unit_normalized == expected_canonical
    assert result[0].unit_dimension == expected_dimension


def test_extractor_handles_unknown_unit_without_crashing() -> None:
    """Unidad no registrada en `Unit.SYNONYMS` → campos en None, sin excepción.
    El Swarm decidirá qué hacer (degradar, marcar review)."""
    items = [
        RestructuredItem(
            code="1.2",
            description="Partida con unidad rara.",
            quantity=1.0,
            unit="xyz",
            chapter="C01 PRUEBA",
        )
    ]
    result = _run_extractor(items)

    assert len(result) == 1
    assert result[0].unit_normalized is None
    assert result[0].unit_dimension is None


def test_extractor_is_idempotent_when_llm_already_emitted_normalized_fields() -> None:
    """Si en el futuro el prompt pide al LLM rellenar los campos, el extractor
    NO debe sobrescribirlos (guarda `if ... is None`). Este test fija ese contrato."""
    items = [
        RestructuredItem(
            code="1.3",
            description="Partida con normalización pre-hecha.",
            quantity=1.0,
            unit="Ud",
            chapter="C01 PRUEBA",
            unit_normalized="ud",
            unit_dimension="discreto",
        )
    ]
    result = _run_extractor(items)

    assert result[0].unit_normalized == "ud"
    assert result[0].unit_dimension == "discreto"
