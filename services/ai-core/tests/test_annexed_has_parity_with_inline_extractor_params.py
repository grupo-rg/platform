"""Fase 5.D — paridad de parámetros del `AnnexedPdfExtractorService` con INLINE.

Antecedentes: el flujo ANNEXED corría con `temperature=0.0` y `max_output_tokens`
por defecto, mientras que INLINE (tras Fase 5.A) opera a `0.15` + `16384`. La
diferencia provocaba truncamientos en páginas anexadas densas y loops de retry
que nunca rompían el determinismo del primer intento. Además `semaphore=15`
saturaba el quota de Gemini cuando varias páginas densas concurrían.

Este test fija los tres parámetros como constantes de clase accesibles desde
fuera del método `extract()`, para que regresiones futuras queden claras en el
diff de clase, no enterradas en kwargs de llamadas.
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional, Type
from unittest.mock import MagicMock

from pydantic import BaseModel

from src.budget.application.ports.ports import ILLMProvider
from src.budget.application.services.pdf_extractor_service import (
    AnnexedPdfExtractorService,
    InlinePdfExtractorService,
    Phase1Result,
    Phase2Result,
)


class _RecordingLLM(ILLMProvider):
    """Captura los kwargs de cada llamada a `generate_structured` para que
    el test pueda aseverar sobre temperature + max_output_tokens."""

    def __init__(self):
        self.calls: List[Dict[str, Any]] = []

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
        self.calls.append(
            {
                "schema": response_schema.__name__,
                "temperature": temperature,
                "max_output_tokens": max_output_tokens,
            }
        )
        if response_schema is Phase1Result:
            return Phase1Result(items=[], has_more_items=False), {
                "promptTokenCount": 0,
                "candidatesTokenCount": 0,
                "totalTokenCount": 0,
            }
        if response_schema is Phase2Result:
            return Phase2Result(items=[]), {
                "promptTokenCount": 0,
                "candidatesTokenCount": 0,
                "totalTokenCount": 0,
            }
        raise AssertionError(f"Schema inesperado: {response_schema.__name__}")

    async def get_embedding(self, text: str):  # pragma: no cover
        return [0.0] * 768


# -------- Constantes de clase expuestas para inspecci\u00f3n externa ----------


def test_annexed_declares_concurrency_equal_to_inline() -> None:
    """El semáforo del ANNEXED (8) debe coincidir con el semáforo del INLINE.
    Lo verificamos vía constante de clase para desacoplar el test del hilo
    de ejecución interno."""
    assert AnnexedPdfExtractorService.CONCURRENCY == 8


def test_annexed_declares_temperature_equal_to_inline() -> None:
    """La misma temperatura 0.15 que INLINE rompe el determinismo del
    truncamiento en retries sin comprometer la precisión."""
    assert AnnexedPdfExtractorService.TEMPERATURE == 0.15


def test_annexed_declares_max_output_tokens_equal_to_inline() -> None:
    """16384 tokens de output (doble del default) mitigan truncamiento
    en páginas densas de descripciones/sumatorios."""
    assert AnnexedPdfExtractorService.MAX_OUTPUT_TOKENS == 16384


# -------- Los valores se propagan al LLM en ambas fases map -----------------


def test_annexed_passes_params_to_llm_in_both_map_phases() -> None:
    """Asserción funcional: la llamada a `generate_structured` en las fases
    Phase1 (descripciones) y Phase2 (sumatorios) recibe los tres parámetros
    alineados con las constantes de clase."""
    llm = _RecordingLLM()
    svc = AnnexedPdfExtractorService(llm_provider=llm)

    pages = [
        {"image_base64": "desc1", "is_summatory": False},
        {"image_base64": "sum1", "is_summatory": True},
    ]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    asyncio.run(svc.extract(pages, budget_id="t-5d", metrics=metrics))

    assert any(
        c["schema"] == "Phase1Result"
        and c["temperature"] == AnnexedPdfExtractorService.TEMPERATURE
        and c["max_output_tokens"] == AnnexedPdfExtractorService.MAX_OUTPUT_TOKENS
        for c in llm.calls
    ), f"Phase1 no recibió los params alineados. Llamadas: {llm.calls}"

    assert any(
        c["schema"] == "Phase2Result"
        and c["temperature"] == AnnexedPdfExtractorService.TEMPERATURE
        and c["max_output_tokens"] == AnnexedPdfExtractorService.MAX_OUTPUT_TOKENS
        for c in llm.calls
    ), f"Phase2 no recibió los params alineados. Llamadas: {llm.calls}"
